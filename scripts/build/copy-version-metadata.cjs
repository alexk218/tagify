const { existsSync, copyFileSync, readFileSync } = require("fs");
const { execFileSync } = require("child_process");
const { dirname, join } = require("path");
const { platform, homedir } = require("os");

const packageRoot = join(__dirname, "..", "..");

function readSpicetifyConfigPath() {
  return execFileSync("spicetify", ["-c"], { encoding: "utf8" });
}

function defaultSpicetifyDirectory(os, home) {
  return os === "win32"
    ? join(home, "AppData", "Roaming", "spicetify")
    : join(home, ".config", "spicetify");
}

// spicetify-creator builds into dirname(`spicetify -c`)/CustomApps/<nameId>, so
// resolve the same way to keep package.json beside the bundle for any config
// selected with SPICETIFY_CONFIG. The default folder is only a fallback when
// spicetify is not installed; any other failure stops rather than writing to
// a different install than the one that received the bundle.
function resolveCustomAppDirectory({
  nameId,
  readConfigPath = readSpicetifyConfigPath,
  os = platform(),
  home = homedir(),
}) {
  let configPath;
  try {
    configPath = readConfigPath().trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      directory: join(defaultSpicetifyDirectory(os, home), "CustomApps", nameId),
      usedFallback: true,
    };
  }
  if (!configPath) throw new Error("`spicetify -c` did not print a config path");
  return {
    directory: join(dirname(configPath), "CustomApps", nameId),
    usedFallback: false,
  };
}

function main() {
  const { nameId } = JSON.parse(
    readFileSync(join(packageRoot, "src", "settings.json"), "utf8")
  );
  const { directory, usedFallback } = resolveCustomAppDirectory({ nameId });
  if (usedFallback) {
    console.warn("⚠ spicetify not found; using the default Spicetify directory");
  }

  // copy package.json to spicetify build path
  if (existsSync(directory)) {
    copyFileSync(join(packageRoot, "package.json"), join(directory, "package.json"));
    console.log("✓ package.json copied to Spicetify directory:", directory);
  } else {
    console.warn("⚠ Spicetify directory not found:", directory);
  }
}

if (require.main === module) {
  main();
}

module.exports = { resolveCustomAppDirectory };
