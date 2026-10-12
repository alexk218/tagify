#!/usr/bin/env bash

set -e  # Exit on any error

# Mac setup is handled by the verified, recoverable native manager. Keep this
# compatibility entry point harmless for users following older instructions.
if [ "$(uname -s)" = "Darwin" ]; then
    printf '%s\n' 'Install or repair Tagify with Tagify Manager for Mac:' \
        'https://tagify.fm/download/mac' \
        'Download the newest Mac DMG, open it, and move Tagify Manager to Applications.' \
        'Your current Spotify and Tagify setup has not been changed.'
    exit 0
fi

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}Installing Tagify...${NC}"

# Define variables
CUSTOM_APPS_DIR="$HOME/.config/spicetify/CustomApps"
NAME="tagify"
CUSTOM_APP_DIR="$CUSTOM_APPS_DIR/$NAME"
TAGIFY_STATE_DIR="$HOME/.config/tagify"
INSTALL_RECOVERY_KEY_FILE="$TAGIFY_STATE_DIR/install-recovery-key"
TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/tagify-install.XXXXXX")
trap 'rm -rf "$TEMP_DIR"' EXIT
curl -fsSL --max-time 30 https://tagify.fm/releases/client/latest.json -o "$TEMP_DIR/release.json"
LATEST_TAG=$(sed -n 's/.*"tag_name": *"\(v[0-9]*\.[0-9]*\.[0-9]*\)".*/\1/p' "$TEMP_DIR/release.json")
EXPECTED_SHA=$(sed -n 's/.*"digest": *"sha256:\([a-f0-9]*\)".*/\1/p' "$TEMP_DIR/release.json")
[[ "$LATEST_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] && [[ "$EXPECTED_SHA" =~ ^[a-f0-9]{64}$ ]] || { echo 'Update information could not be verified.'; exit 1; }
ZIP_URL="https://tagify.fm/releases/client/$LATEST_TAG/tagify-$LATEST_TAG.zip"
ZIP_FILE="$TEMP_DIR/tagify.zip"

install_recovery_bootstrap() {
    mkdir -p "$TAGIFY_STATE_DIR"
    chmod 700 "$TAGIFY_STATE_DIR"
    if [ ! -s "$INSTALL_RECOVERY_KEY_FILE" ] || ! grep -Eq '^tgfy_install_[A-Za-z0-9_-]{43}$' "$INSTALL_RECOVERY_KEY_FILE"; then
        local random_value
        random_value=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')
        printf 'tgfy_install_%s\n' "$random_value" > "$INSTALL_RECOVERY_KEY_FILE"
        chmod 600 "$INSTALL_RECOVERY_KEY_FILE"
    fi

    local recovery_key
    recovery_key=$(tr -d '\r\n' < "$INSTALL_RECOVERY_KEY_FILE")
    if [ ! -f "$CUSTOM_APP_DIR/extension.js" ]; then
        echo -e "${RED}❌ Tagify extension.js is missing; automatic Community reconnection could not be installed.${NC}"
        exit 1
    fi
    {
        printf 'globalThis.__tagifyInstallRecoveryKey="%s";\n' "$recovery_key"
        cat "$CUSTOM_APP_DIR/extension.js"
    } > "$CUSTOM_APP_DIR/extension.js.recovery"
    mv "$CUSTOM_APP_DIR/extension.js.recovery" "$CUSTOM_APP_DIR/extension.js"
}

# Check if Spicetify is installed
if ! command -v spicetify &> /dev/null; then
    echo -e "${RED}❌ Spicetify not found! Please install Spicetify first.${NC}"
    echo "Visit: https://spicetify.app/docs/getting-started"
    exit 1
fi

echo -e "${CYAN}✅ Spicetify found${NC}"

# Create CustomApps directory if it doesn't exist
mkdir -p "$CUSTOM_APPS_DIR"

# Download the zip file
echo -e "${CYAN}📥 Downloading Tagify...${NC}"
if ! curl -fL --max-time 120 -o "$ZIP_FILE" "$ZIP_URL"; then
    echo -e "${RED}❌ Failed to download Tagify${NC}"
    echo "URL: $ZIP_URL"
    exit 1
fi

# Check if download was successful
if [ ! -f "$ZIP_FILE" ] || [ ! -s "$ZIP_FILE" ]; then
    echo -e "${RED}❌ Downloaded file is empty or missing${NC}"
    exit 1
fi

echo -e "${CYAN}✅ Download completed ($(du -h "$ZIP_FILE" | cut -f1))${NC}"

printf '%s  %s\n' "$EXPECTED_SHA" "$ZIP_FILE" | sha256sum -c -
# Extract files
echo -e "${CYAN}📦 Extracting files...${NC}"
if ! unzip -o -q "$ZIP_FILE" -d "$TEMP_DIR"; then
    echo -e "${RED}❌ Failed to extract files${NC}"
    exit 1
fi

# Only verified runtime files may replace an existing installation.
for required in manifest.json package.json index.js extension.js style.css; do
    test -s "$TEMP_DIR/tagify/$required" || { echo 'The download is incomplete.'; exit 1; }
done
if [ -e "$CUSTOM_APP_DIR" ]; then
    cp -a "$CUSTOM_APP_DIR" "$CUSTOM_APP_DIR.backup-$(date +%Y%m%d-%H%M%S)"
    rm -rf "$CUSTOM_APP_DIR"
fi
mv "$TEMP_DIR/tagify" "$CUSTOM_APP_DIR"

install_recovery_bootstrap

# Apply Spicetify configuration
echo -e "${CYAN}⚙️  Configuring Spicetify...${NC}"
spicetify config custom_apps "$NAME"
spicetify apply

# Clean up
rm -f "$ZIP_FILE"

echo -e "${GREEN}Tagify installation complete!

Next steps:
1. Restart Spotify completely
2. Look for 'Tagify' in your Spotify top navigation bar
3. Start tagging your tracks!${NC}"
