const { existsSync, copyFileSync } = require("fs");
const { join } = require("path");
const { platform, homedir } = require("os");

// Determine Spicetify config path based on OS
let spicetifyPath;

if (platform() === "win32") {
  spicetifyPath = join(
    homedir(),
    "AppData",
    "Roaming",
    "spicetify",
    "CustomApps",
    "tagify"
  );
} else {
  spicetifyPath = join(
    homedir(),
    ".config",
    "spicetify",
    "CustomApps",
    "tagify"
  );
}

// copy package.json to spicetify build path
const packageJsonSource = join(__dirname, "..", "..", "package.json");
const packageJsonDest = join(spicetifyPath, "package.json");

if (existsSync(spicetifyPath)) {
  copyFileSync(packageJsonSource, packageJsonDest);
  console.log("✓ package.json copied to Spicetify directory");
} else {
  console.warn("⚠ Spicetify directory not found:", spicetifyPath);
}
