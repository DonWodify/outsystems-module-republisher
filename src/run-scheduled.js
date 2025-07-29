const { exec } = require('child_process');
const path = require('path');
const cron = require('node-cron');

// Adjust schedule as needed (here: every 15 minutes)
const SCHEDULE = '*/15 * * * *';

// FIX: Remove extra 'src' from script paths
const scannerScript = path.join(__dirname, 'outsystems-warning-scanner.js');
const republisherScript = path.join(__dirname, 'outsystems-module-republisher.js');

function runScript(scriptPath, name, callback) {
    console.log(`[${new Date().toISOString()}] Starting ${name}...`);
    exec(`node "${scriptPath}"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`[${name}] Error:`, error.message);
        }
        if (stdout) {
            console.log(`[${name}] Output:\n${stdout}`);
        }
        if (stderr) {
            console.error(`[${name}] Stderr:\n${stderr}`);
        }
        console.log(`[${new Date().toISOString()}] Finished ${name}.`);
        if (callback) callback();
    });
}

// Run immediately on startup
runScript(scannerScript, 'Warning Scanner', () => {
    runScript(republisherScript, 'Module Republisher');
});

cron.schedule(SCHEDULE, () => {
    runScript(scannerScript, 'Warning Scanner', () => {
        runScript(republisherScript, 'Module Republisher');
    });
});

console.log(`Scheduled scripts to run at: "${SCHEDULE}" (cron format).`);
console.log('To test immediately, run: node src/outsystems-warning-scanner.js && node src/outsystems-module-republisher.js');
console.log('To test immediately, run: node src/outsystems-warning-scanner.js && node src/outsystems-module-republisher.js');
