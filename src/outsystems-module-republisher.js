const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
require('dotenv').config({ path: path.resolve(__dirname, './.env') });

// Add environment variable validation
if (!process.env.WODIFY_USERNAME || !process.env.WODIFY_PASSWORD || !process.env.WODIFY_ENV) {
    console.error('Environment variables not loaded. Checking .env file location...');
    const envPath = path.resolve(__dirname, './.env');
    console.error(`Expected .env path: ${envPath}`);
    console.error('Please ensure the .env file exists and contains WODIFY_USERNAME, WODIFY_PASSWORD, and WODIFY_ENV');
    throw new Error('Missing required environment variables');
}

// Configuration
const BASE_DOMAIN = "wodify.com"; // Base domain for all subdomains
const ENV = process.env.WODIFY_ENV; // Environment configuration
const SUBDOMAINS = [`${ENV}`, `${ENV}-coreap`, `${ENV}-clientapp`, `${ENV}-coreos`, `${ENV}sc`]; // List of subdomains
const OUTPUT_FILE = "sorted-modules.json"; // Input JSON file
//const OUTPUT_FILE = "sorted-modules-WodifyClient.json"; // Input JSON file
const HEADLESS_MODE = true; // Toggle headless mode
const NAVIGATION_TIMEOUT = 180000; // Timeout in milliseconds (3 minutes)
const RETRY_LIMIT = 3; // Retry limit for failed navigations
const TABS_PER_SUBDOMAIN = 2; // Number of tabs per subdomain
const WARNING_CHECK_TIMEOUT = 1000; // Timeout for checking warning status in milliseconds

// Define processing hierarchy (same as in the scanner script)
const PROCESSING_HIERARCHY = ["IS", "LS", "TH", "CS", "BL", "SBL", "OS", "API", "AP", "CW", "UI"];

// Add usage information
const USAGE = `
Usage: node RepublishURLtesting.js [layers]

Parameters:
  layers    Optional comma-separated list of module layers to process
            If omitted, all layers will be processed

Examples:
  node RepublishURLtesting.js                  # Process all layers
  node RepublishURLtesting.js OS               # Process only OS modules
  node RepublishURLtesting.js OS,UI            # Process OS and UI modules
  node RepublishURLtesting.js BL,SBL,OS        # Process BL, SBL and OS modules

Available layers: ${PROCESSING_HIERARCHY.join(', ')}
`;

// Parse command-line arguments for layer filtering
const args = process.argv.slice(2);

// Show usage if help is requested
if (args.includes('-h') || args.includes('--help')) {
    console.log(USAGE);
    process.exit(0);
}

const requestedLayers = parseRequestedLayers(args);

// Get credentials from environment variables
const USERNAME = process.env.WODIFY_USERNAME;
const PASSWORD = process.env.WODIFY_PASSWORD;

// Validate credentials
if (!USERNAME || !PASSWORD) {
    throw new Error('Missing credentials in environment variables. Please check your .env file.');
}

/**
 * Parse command-line arguments to extract requested layers
 * @param {string[]} args - Command-line arguments
 * @returns {string[]|null} - Array of requested layers or null if all layers should be processed
 */
function parseRequestedLayers(args) {
    if (args.length === 0) {
        return null; // No filtering, process all layers
    }
    
    // Parse the first argument as a list of layers separated by comma
    const layersArg = args[0];
    
    // Create a map of uppercase layer names to their original case for lookup
    const layerMap = {};
    PROCESSING_HIERARCHY.forEach(layer => {
        layerMap[layer.toUpperCase()] = layer;
    });
    
    // Split by comma and filter valid layers case-insensitively
    const layers = layersArg.split(',')
        .map(layer => layer.trim())
        .filter(layer => layerMap[layer.toUpperCase()])
        .map(layer => layerMap[layer.toUpperCase()]); // Convert to original case
    
    if (layers.length === 0) {
        console.warn(`Warning: No valid layers found in input "${layersArg}". Will process all layers.`);
        console.log(`Available layers: ${PROCESSING_HIERARCHY.join(', ')}`);
        return null;
    }
    
    console.log(`Will process only these layers: ${layers.join(', ')}`);
    return layers;
}

/**
 * Filter modules to include only those from requested layers
 * @param {Array} modules - List of modules to filter
 * @param {string[]|null} requestedLayers - List of layers to include
 * @returns {Array} - Filtered list of modules
 */
function filterModulesByRequestedLayers(modules, requestedLayers) {
    if (!requestedLayers) {
        return modules; // No filtering
    }
    
    const filtered = modules.filter(module => requestedLayers.includes(module.suffix));
    console.log(`Filtered from ${modules.length} modules to ${filtered.length} modules in layers: ${requestedLayers.join(', ')}`);
    return filtered;
}

// Task queue to manage URLs
const taskQueue = [];
let taskIndex = 0;

// Function to get the next URL from the task queue
function getNextTask() {
    if (taskIndex < taskQueue.length) {
        return taskQueue[taskIndex++];
    }
    return null;
}

// Login to a subdomain
async function login(page, subdomain) {
    const loginUrl = `https://${subdomain}.${BASE_DOMAIN}/ServiceCenter/`;
    console.log(`Logging into Service Center on subdomain: ${subdomain}`);
    await page.goto(loginUrl, { waitUntil: "networkidle2" });

    // Input username and password
    await page.type("#wt89_wtContentRight_wtInput1", USERNAME);
    await page.type("#wt89_wtContentRight_wtInputPass1", PASSWORD);

    // Click login button and wait for navigation
    await Promise.all([
        page.click("#wt89_wtContentRight_wt59_wtColumnsItems_wt33_wtContent_wtButton1"),
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT }),
    ]);

    console.log(`Login successful on subdomain: ${subdomain}`);
}

// Navigate to a URL with retries
async function navigateWithRetries(page, url) {
    let retries = 0;
    while (retries < RETRY_LIMIT) {
        try {
            console.log(`Navigating to URL: ${url} (Attempt ${retries + 1})`);
            await page.goto(url, { waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT });
            console.log(`Successfully loaded: ${url}`);
            return true;
        } catch (error) {
            retries++;
            console.error(`Error navigating to ${url}: ${error.message}`);
            if (retries === RETRY_LIMIT) {
                console.error(`Failed to load ${url} after ${RETRY_LIMIT} attempts. Skipping.`);
                return false;
            }
        }
    }
}

async function processPublishPage(page, url) {
    let retries = 0;

    while (retries < RETRY_LIMIT) {
        try {
            console.log(`[Thread] Navigating to URL: ${url} (Attempt ${retries + 1})`);
            await page.goto(url, { waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT });

            console.log(`[Thread] Successfully loaded: ${url}`);

            const tableSelector = "#wt1482_wtContentMain_wt908_wtTabs_Content_wt1152_wtContent_wt1120_wtListPlacholder";
            await page.waitForSelector(tableSelector, { timeout: NAVIGATION_TIMEOUT });

            const rows = await page.$$("table tbody tr");
            for (let row of rows) {
                const publishedCell = await row.$("td:nth-child(4) .osicon-tick.text-success-4");
                if (publishedCell) {
                    console.log("Found the published version. Looking for the Publish button...");

                    const publishButton = await row.$("input[value='Publish']");
                    if (publishButton) {
                        console.log("Clicking the Publish button...");

                        // Attach dialog listener
                        const handleDialog = async (dialog) => {
                            console.log(`Dialog message: ${dialog.message()}`);
                            try {
                                await dialog.accept();
                                console.log("Dialog accepted.");
                            } catch (error) {
                                console.error("Error accepting dialog:", error.message);
                            }
                            page.off("dialog", handleDialog); // Clean up listener
                        };
                        page.once("dialog", handleDialog);

                        // Click the button
                        await publishButton.click();
                        console.log("Publish button clicked. Waiting for progress indicators...");

                        // Wait for progress bar or progression table
                        await page.waitForFunction(() => {
                            const progressBar = document.querySelector("#wt29_wtContentMain_wtProgressBarBlock_wtProgress");
                            const progressionTable = document.querySelector("tr.steps-item-current");
                            return progressBar || progressionTable;
                        }, { timeout: NAVIGATION_TIMEOUT });

                        console.log("Progress indicators detected. Waiting for 15 seconds before exiting...");
                        await page.waitForTimeout(15000);

                        console.log("Publish action started successfully. Exiting...");
                        return;
                    }
                }
            }

            console.log("No published version found or no Publish button available.");
            return; // Exit function if successful
        } catch (err) {
            retries++;
            console.error(`Error processing ${url}: ${err.message}. Retrying (${retries}/${RETRY_LIMIT})...`);

            if (retries === RETRY_LIMIT) {
                console.error(`Max retries reached for ${url}. Skipping.`);
                return; // Exit after max retries
            }
        }
    }
}

// Check if the module status is in warning
async function isModuleInWarning(page) {
    try {
        const warningSelector = "img[src*='Icon_Warning.svg']";
        const statusLabel = await page.$("label#wt1482_wtContentTop_wt65_wtColumnsItems_wt858_wtContent_wtStatus");
        if (statusLabel) {
            const warningElement = await page.waitForSelector(warningSelector, { timeout: WARNING_CHECK_TIMEOUT });
            return !!warningElement;
        }
        return false;
    } catch (err) {
        return false;
    }
}


// Process URLs in a single tab
async function processTab(subdomain, browser) {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);

    try {
        while (true) {
            const task = getNextTask();
            if (!task) break;

            const url = task.replace(/^https:\/\/[^.]+/, `https://${subdomain}`);
            console.log(`[${subdomain}] Processing module at URL: ${url}`);
            await page.goto(url, { waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT });

            if (await isModuleInWarning(page)) {
                await processPublishPage(page, url);
            } else {
                console.log(`[${subdomain}] Module at URL: ${url} does not need republishing. Skipping.`);
            }
        }
    } catch (err) {
        console.error(`[${subdomain}] Error during processing:`, err.message);
    } finally {
        console.log(`[${subdomain}] Finished processing URLs.`);
        await page.close();
    }
}

// Process URLs in a single thread with multiple tabs for a specific subdomain
async function processThread(subdomain) {
    // Use the new headless mode if HEADLESS_MODE is true, otherwise run non-headless
    const browser = await puppeteer.launch({ headless: HEADLESS_MODE ? "new" : false });
    const loginPage = await browser.newPage();
    loginPage.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);

    try {
        // Login to the assigned subdomain
        await login(loginPage, subdomain);
        await loginPage.close();

        // Create multiple tabs for the subdomain
        const tabPromises = [];
        for (let i = 0; i < TABS_PER_SUBDOMAIN; i++) {
            tabPromises.push(processTab(subdomain, browser));
        }

        // Wait for all tabs to finish processing
        await Promise.all(tabPromises);
    } catch (err) {
        console.error(`[${subdomain}] Error during processing:`, err.message);
    } finally {
        console.log(`[${subdomain}] Finished processing URLs.`);
        await browser.close();
    }
}

// Main function to process URLs with multi-threading
async function processURLs() {
    try {
        // Read URLs from the JSON file
        const filePath = path.resolve(__dirname, OUTPUT_FILE);
        if (!fs.existsSync(filePath)) {
            console.error(`File not found: ${OUTPUT_FILE}`);
            return;
        }

        // Read all modules from the JSON file
        const moduleData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        
        // Apply layer filtering if specified
        const filteredModules = filterModulesByRequestedLayers(moduleData, requestedLayers);
        
        // Update the task queue with filtered modules
        taskQueue.push(...filteredModules.map((module) => module.url));
        
        console.log(`Loaded ${taskQueue.length} URLs from ${OUTPUT_FILE}`);
        if (requestedLayers) {
            console.log(`Filtered to layers: ${requestedLayers.join(', ')}`);
        }

        // Run threads concurrently
        await Promise.all(
            SUBDOMAINS.map((subdomain) => processThread(subdomain))
        );
    } catch (err) {
        console.error("Error during processing:", err.message);
    }
}

// Run the republishing script
processURLs().then(() => {
    console.log("Republishing process complete.");
    if (requestedLayers) {
        console.log(`Processed layers: ${requestedLayers.join(', ')}`);
    } else {
        console.log("Processed all layers");
    }
});
