#!/usr/bin/env node

const path = require("path");
const { execSync } = require("child_process");
const fs = require("fs");

if (process.platform !== "darwin") {
  console.error("This launcher is macOS-only (uses AppleScript).");
  process.exit(1);
}

const projectDir = path.resolve(__dirname, "..");

// Parse flags like --network localhost or --network=localhost
const args = process.argv.slice(2);
function getArgValue(name, fallback) {
  const prefix = `--${name}=`;
  for (const a of args) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return process.env[name.toUpperCase()] || fallback;
}

const network = getArgValue("network", "localhost");

// Read package.json to determine available npm scripts
let pkgScripts = {};
try {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(projectDir, "package.json"), "utf8")
  );
  pkgScripts = pkg.scripts || {};
} catch (_) {}

const hasScript = (name) => Boolean(pkgScripts[name]);

// Build deploy command (prefer npm script, else fallback to npx)
const deployScriptName = `deploy:${network}`;
const deployCmd = hasScript(deployScriptName)
  ? `npm run ${deployScriptName}`
  : `npx hardhat run scripts/deploy.js --network ${network}`;

// Build trade command (prefer npm script, else fallback to npx)
let tradeCmd;
if (network === "localhost" && hasScript("trade")) {
  tradeCmd = "npm run trade";
} else if (hasScript(`trade:${network}`)) {
  tradeCmd = `npm run trade:${network}`;
} else {
  tradeCmd = `npx hardhat run scripts/interactive-trader.js --network ${network}`;
}

// Some deployments may write to unknown-deployment.json; wait for either
const deploymentFilePreferred = path.join(
  projectDir,
  "deployments",
  `${network}-deployment.json`
);
const deploymentFileFallback = path.join(
  projectDir,
  "deployments",
  "unknown-deployment.json"
);

const cdProject = `cd '${projectDir}'`;

const deployWindowCmd = `${cdProject} && ${deployCmd}`;
const waitAndTradeWindowCmd = `${cdProject} && while [ ! -f '${deploymentFilePreferred}' ] && [ ! -f '${deploymentFileFallback}' ]; do echo '⏳ Waiting for ${network} deployment to complete...'; sleep 2; done; ${tradeCmd}`;

function escapeForAppleScript(str) {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const appleScript = `
tell application "Terminal"
  activate
  do script "${escapeForAppleScript(deployWindowCmd)}"
  delay 1
  do script "${escapeForAppleScript(waitAndTradeWindowCmd)}"
end tell
`;

try {
  execSync("osascript -", { input: appleScript, stdio: "inherit" });
} catch (err) {
  console.error("Failed to launch Terminal windows:", err?.message || err);
  process.exit(1);
}

