// update-addresses.js - Helper for deployment scripts to update contract addresses
//
// 🎯 PURPOSE:
//   - Programmatically update contract addresses after deployment
//   - Used by deployment scripts to automatically update config
//   - Provides validation and logging
//
// 🔄 USAGE:
//   const { updateConfigAddresses } = require('./config/update-addresses');
//   await updateConfigAddresses({
//     TRADING_ROUTER: '0x1234...',
//     CENTRALIZED_VAULT: '0x5678...'
//   });

const fs = require("fs");
const path = require("path");

/**
 * Update contract addresses in the config file
 * @param {object} newAddresses - Object with contract keys and new addresses
 * @param {boolean} validate - Whether to validate addresses after update
 * @returns {Promise<boolean>} Success status
 */
async function updateConfigAddresses(newAddresses, validate = true) {
  try {
    console.log(
      `\n🔄 Updating ${Object.keys(newAddresses).length} contract addresses...`
    );

    // Read current config file
    const configPath = path.join(__dirname, "contracts.js");
    let configContent = fs.readFileSync(configPath, "utf8");

    // Update each address in the file
    for (const [key, address] of Object.entries(newAddresses)) {
      // Find and replace the address line
      const regex = new RegExp(`(${key}:\\s*")[^"]*(")`);
      const replacement = `$1${address}$2`;

      if (configContent.match(regex)) {
        configContent = configContent.replace(regex, replacement);
        console.log(`✅ Updated ${key}: ${address}`);
      } else {
        console.warn(`⚠️  Could not find ${key} in config file`);
      }
    }

    // Write updated config back to file
    fs.writeFileSync(configPath, configContent);
    console.log("📝 Config file updated successfully");

    // Validate if requested
    if (validate) {
      console.log("\n🔍 Validating updated configuration...");
      // Clear require cache to get fresh config
      delete require.cache[require.resolve("./contracts.js")];
      const { validateAddresses } = require("./contracts.js");
      const isValid = validateAddresses();

      if (!isValid) {
        console.error("❌ Validation failed after update");
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error("❌ Failed to update config addresses:", error.message);
    return false;
  }
}

/**
 * Display deployment summary with copy-paste ready addresses
 * @param {object} addresses - Deployed contract addresses
 */
function displayDeploymentSummary(addresses) {
  console.log("\n📋 DEPLOYMENT SUMMARY");
  console.log("═".repeat(60));

  for (const [key, address] of Object.entries(addresses)) {
    console.log(`${key.padEnd(25)} │ ${address}`);
  }

  console.log("═".repeat(60));
  console.log("✅ Addresses automatically updated in config/contracts.js");
  console.log("💡 Run: node update-config.js --validate to verify");
}

/**
 * Helper to extract addresses from deployed contracts
 * @param {object} contracts - Object with deployed contract instances
 * @returns {object} Object with contract keys and addresses
 */
function extractAddresses(contracts) {
  const addresses = {};

  for (const [key, contract] of Object.entries(contracts)) {
    if (contract && contract.address) {
      // Convert key to match config format (e.g., tradingRouter -> TRADING_ROUTER)
      const configKey = key
        .replace(/([A-Z])/g, "_$1")
        .toUpperCase()
        .replace(/^_/, "");

      addresses[configKey] = contract.address;
    }
  }

  return addresses;
}

module.exports = {
  updateConfigAddresses,
  displayDeploymentSummary,
  extractAddresses,
};
