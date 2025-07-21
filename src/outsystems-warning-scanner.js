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
const ENV = process.env.WODIFY_ENV; // Environment configuration
const SERVICE_CENTER_URL = `https://${ENV}sc.wodify.com/ServiceCenter/`;
const ESPACES_LIST_URL = `${SERVICE_CENTER_URL}eSpaces_List.aspx`;
const OUTPUT_FILE = "sorted-modules.json"; // Output JSON file
const HEADLESS_MODE = true; // Toggle headless mode
const NAVIGATION_TIMEOUT = 180000; // Timeout in milliseconds (3 minutes)
const REFRESH_DELAY = 1000; // Delay in milliseconds before re-checking the table
const TABLE_SELECTOR = "table#wt150_wtContentMain_wt45_wtListPlacholder_wtListEspaces"; // Add this with other constants at the top

// Define processing hierarchy first before using it
const PROCESSING_HIERARCHY = ["IS", "LS", "TH", "CS", "BL", "SBL", "OS", "API", "AP", "CW", "UI"]; // Updated list

// Add usage information
const USAGE = `
Usage: node EspacesList_Scanner.js [layers]

Parameters:
  layers    Optional comma-separated list of module layers to process
            If omitted, all layers will be processed

Examples:
  node EspacesList_Scanner.js                  # Process all layers
  node EspacesList_Scanner.js OS               # Process only OS modules
  node EspacesList_Scanner.js OS,UI            # Process OS and UI modules
  node EspacesList_Scanner.js BL,SBL,OS        # Process BL, SBL and OS modules

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

// Login to Service Center
async function login(page) {
    console.log("Logging into Service Center...");
    await page.goto(SERVICE_CENTER_URL, { waitUntil: "networkidle2" });

    // Input username and password
    await page.type("#wt89_wtContentRight_wtInput1", USERNAME);
    await page.type("#wt89_wtContentRight_wtInputPass1", PASSWORD);

    // Click login button and wait for navigation
    await Promise.all([
        page.click("#wt89_wtContentRight_wt59_wtColumnsItems_wt33_wtContent_wtButton1"),
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT }),
    ]);

    console.log("Login successful!");
}

// Update the applyWarningFilter function
async function applyWarningFilter(page) {
    try {
        console.log("Applying warning filter...");
        
        // Define selectors
        const dropdownBoxSelector = '#wt150_wtContentMain_wtFilters_wt7_wtColumnsItems_wt8_wtContent_wtContentColumn3_wtStatusComboBox';
        const optionSelector = '#choices-wt150_wtContentMain_wtFilters_wt7_wtColumnsItems_wt8_wtContent_wtContentColumn3_wtSelectStatus_WithDeploy-item-choice-3';
        const filterButtonSelector = '#wt150_wtContentMain_wtFilters_wt7_wtColumnsItems_wt1_wtContent_wtContentColumn5_wtButton1';

        // Wait for and click the dropdown
        await page.waitForSelector(dropdownBoxSelector, { visible: true, timeout: NAVIGATION_TIMEOUT });
        await page.click(dropdownBoxSelector);
        console.log("Clicked dropdown");

        // Wait for and click the option
        await page.waitForSelector(optionSelector, { visible: true, timeout: NAVIGATION_TIMEOUT });
        await page.click(optionSelector);
        console.log("Selected 'with errors and warnings' option");

        // Small delay to ensure UI updates
        await page.waitForTimeout(1000);

        // Click filter and wait for response
        await Promise.all([
            page.click(filterButtonSelector),
            page.waitForResponse(response => response.url().includes('eSpaces_List.aspx')),
            page.waitForSelector(TABLE_SELECTOR)
        ]);
        
        // Verify the selection was made by checking the select element's value
        const selectedValue = await page.$eval(
            '#wt150_wtContentMain_wtFilters_wt7_wtColumnsItems_wt8_wtContent_wtContentColumn3_wtSelectStatus_WithDeploy',
            select => ({
                value: select.value,
                selectedText: select.options[select.selectedIndex].text
            })
        );
        
        console.log(`Selected filter value: "${selectedValue.value}", text: "${selectedValue.selectedText}"`);
        
        if (selectedValue.value !== '__ossli_2' || !selectedValue.selectedText.includes('with errors and warnings')) {
            throw new Error(`Filter not properly set. Current selection: ${selectedValue.selectedText}`);
        }

        console.log("Filter applied successfully");

    } catch (error) {
        console.error("Error applying warning filter:", error.message);
        throw new Error(`Failed to apply warning filter: ${error.message}`);
    }
}

// Update the reference in scrapeModulesWithWarnings
async function scrapeModulesWithWarnings(page) {
    console.log("Scraping outdated modules...");
    const modules = new Map();

    let previousFirstRowText = null;

    while (true) {
        console.log("Scanning the current page...");

        // Check if the table contains "No Modules to show"
        const noModulesText = await page.evaluate(() => {
            const noModulesElement = document.querySelector("#wt150_wtContentMain_wt101_wtTitle");
            return noModulesElement && noModulesElement.innerText.includes("No Modules to show");
        });
        if (noModulesText) {
            console.log("No Modules to show. Stopping scan.");
            break;
        }

        const rows = await page.$$("table tbody tr");

        for (let row of rows) {
            try {
                // Check for the warning icon in the row
                const warningIcon = await row.$("img[src*='Icon_Warning.svg']");
                if (warningIcon) {
                    // Extract the module URL and name
                    const moduleLink = await row.$eval("a.link", (a) => a.href);
                    const moduleName = await row.$eval("a.link span[data-name='espaceedit']", (span) => span.innerText);

                    // Skip modules with "Sandbox" in the name (case-insensitive) or starting with "Z" or "z"
                    if (moduleName.toLowerCase().includes("sandbox") /*|| /^[Zz]/.test(moduleName)*/) {
                        console.log(`Skipping excluded module: ${moduleName}`);
                        continue;
                    }

                    // Extract the suffix (e.g., `CS`, `BL`) from the module name
                    let suffix = moduleName.split("_").pop();
                    if (!PROCESSING_HIERARCHY.includes(suffix)) {
                        console.log(`Unknown suffix '${suffix}' for module '${moduleName}'. Defaulting to 'UI'.`);
                        suffix = "UI";
                    }

                    if (!modules.has(moduleLink)) {
                        modules.set(moduleLink, { url: moduleLink, name: moduleName, suffix });
                        console.log(`Found outdated module: ${moduleName} (${suffix}) -> ${moduleLink}`);
                    }
                }
            } catch (err) {
                console.error("Error processing row:", err.message);
            }
        }

        // Check if the Next button is present and not disabled
        const nextButton = await page.$("a#wt150_wtContentMain_wt45_wtTopLinksPlaceholderRight_wtLink9");
        const nextButtonDisabled = nextButton && await page.evaluate(button => button.hasAttribute("disabled"), nextButton);

        if (!nextButton || nextButtonDisabled) {
            console.log("Next button is not present or disabled. Finished scanning.");
            break;
        }

        console.log("Clicking Next button for AJAX refresh...");
        await page.click("a#wt150_wtContentMain_wt45_wtTopLinksPlaceholderRight_wtLink9");

        // Wait for the table to refresh
        await page.waitForFunction(
            (selector, prevText) => {
                const table = document.querySelector(selector);
                const firstRowText = table?.querySelector("tbody tr")?.innerText || "";
                return table && firstRowText !== prevText; // Ensure the first row text has changed
            },
            { timeout: NAVIGATION_TIMEOUT },
            TABLE_SELECTOR,
            previousFirstRowText
        );

        // Update the previous first row text
        previousFirstRowText = await page.evaluate((selector) => {
            const table = document.querySelector(selector);
            return table?.querySelector("tbody tr")?.innerText || "";
        }, TABLE_SELECTOR);

        // Delay before continuing to the next iteration
        await page.waitForTimeout(REFRESH_DELAY);
    }

    // Ensure all modules are processed even if no pagination
    if (modules.size === 0) {
        console.log("No modules found in the initial scan. Re-checking the table...");
        const rows = await page.$$("table tbody tr");

        for (let row of rows) {
            try {
                // Check for the warning icon in the row
                const warningIcon = await row.$("img[src*='Icon_Warning.svg']");
                if (warningIcon) {
                    // Extract the module URL and name
                    const moduleLink = await row.$eval("a.link", (a) => a.href);
                    const moduleName = await row.$eval("a.link span[data-name='espaceedit']", (span) => span.innerText);

                    // Skip modules with "Sandbox" in the name (case-insensitive) or starting with "Z" or "z"
                    if (moduleName.toLowerCase().includes("sandbox") /*|| /^[Zz]/.test(moduleName)*/) {
                        console.log(`Skipping excluded module: ${moduleName}`);
                        continue;
                    }

                    // Extract the suffix (e.g., `CS`, `BL`) from the module name
                    let suffix = moduleName.split("_").pop();
                    if (!PROCESSING_HIERARCHY.includes(suffix)) {
                        console.log(`Unknown suffix '${suffix}' for module '${moduleName}'. Defaulting to 'UI'.`);
                        suffix = "UI";
                    }

                    if (!modules.has(moduleLink)) {
                        modules.set(moduleLink, { url: moduleLink, name: moduleName, suffix });
                        console.log(`Found outdated module: ${moduleName} (${suffix}) -> ${moduleLink}`);
                    }
                }
            } catch (err) {
                console.error("Error processing row:", err.message);
            }
        }
    }

    console.log(`Finished scraping. Found ${modules.size} unique outdated modules (excluding Sandbox and Z-prefixed modules).`);
    return Array.from(modules.values()); // Convert Map to an array
}

function sortModulesByHierarchy(modules) {
    return modules.sort((a, b) => {
        const rankA = PROCESSING_HIERARCHY.indexOf(a.suffix) !== -1 ? PROCESSING_HIERARCHY.indexOf(a.suffix) : Infinity;
        const rankB = PROCESSING_HIERARCHY.indexOf(b.suffix) !== -1 ? PROCESSING_HIERARCHY.indexOf(b.suffix) : Infinity;

        // Place unknown suffixes second-to-last and UI last
        if (rankA === Infinity && a.suffix === "UI") rankA = Infinity + 1; // UI is last
        if (rankB === Infinity && b.suffix === "UI") rankB = Infinity + 1; // UI is last

        if (rankA === rankB) {
            return a.name.localeCompare(b.name); // Sort alphabetically as a secondary criterion
        }
        return rankA - rankB;
    });
}

async function saveToFile(sortedModules) {
    console.log(`Saving ${sortedModules.length} modules to ${OUTPUT_FILE}...`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(sortedModules, null, 2), "utf-8");
    console.log("Modules saved successfully.");
}

async function scanModules() {
    const browser = await puppeteer.launch({ headless: HEADLESS_MODE ? "new" : false });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);

    let modules = [];
    try {
        // Perform login
        await login(page);

        // Navigate to eSpaces list page
        await page.goto(ESPACES_LIST_URL, { waitUntil: "networkidle2" });

        // Apply warning filter before scanning
        await applyWarningFilter(page);

        // Scrape outdated modules
        modules = await scrapeModulesWithWarnings(page);

        // Sort modules by dependency hierarchy
        const sortedModules = sortModulesByHierarchy(modules);
        
        // Filter modules by requested layers (if specified)
        const filteredModules = filterModulesByRequestedLayers(sortedModules, requestedLayers);

        // Save filtered modules to a JSON file
        await saveToFile(filteredModules);

        console.log("Sorted and filtered modules for processing:");
        //console.table(filteredModules);

        return filteredModules;
    } catch (err) {
        console.error("Error during scanning:", err.message);

        // Save whatever was scraped before the error
        if (modules.length > 0) {
            const filteredModules = filterModulesByRequestedLayers(modules, requestedLayers);
            await saveToFile(filteredModules);
            console.log("Saved partially scraped modules due to error.");
        }
    } finally {
        await browser.close();
    }
}

// Run the scanner
scanModules().then((modules) => {
    if (!modules) {
        console.log("Scanning finished with errors or no modules found.");
        return;
    }
    console.log("Modules ready for processing:");
    console.log(`Total modules: ${modules.length}`);
    if (requestedLayers) {
        console.log(`Filtered to layers: ${requestedLayers.join(', ')}`);
    } else {
        console.log("Processing all layers");
    }
    console.table(modules);
});
