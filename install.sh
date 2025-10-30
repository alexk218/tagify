#!/usr/bin/env bash

set -e  # Exit on any error

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
LATEST_TAG=$(curl -s https://api.github.com/repos/alexk218/tagify/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
ZIP_URL="https://github.com/alexk218/tagify/releases/download/$LATEST_TAG/tagify-$LATEST_TAG.zip"
ZIP_FILE="/tmp/tagify.zip"
TEMP_DIR="/tmp/tagify-install"

# Check if Spicetify is installed
if ! command -v spicetify &> /dev/null; then
    echo -e "${RED}❌ Spicetify not found! Please install Spicetify first.${NC}"
    echo "Visit: https://spicetify.app/docs/getting-started"
    exit 1
fi

echo -e "${CYAN}✅ Spicetify found${NC}"

# Create CustomApps directory if it doesn't exist
mkdir -p "$CUSTOM_APPS_DIR"

# Remove existing installation
if [ -e "$CUSTOM_APP_DIR" ]; then
    echo -e "${CYAN}🔄 Removing existing installation...${NC}"
    rm -rf "$CUSTOM_APP_DIR"
fi

# Clean and create temp directory
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

# Download the zip file
echo -e "${CYAN}📥 Downloading Tagify...${NC}"
if ! curl -L -o "$ZIP_FILE" "$ZIP_URL"; then
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

# Extract files
echo -e "${CYAN}📦 Extracting files...${NC}"
if ! unzip -o -q "$ZIP_FILE" -d "$TEMP_DIR"; then
    echo -e "${RED}❌ Failed to extract files${NC}"
    exit 1
fi

# Find what was extracted and move it properly
cd "$TEMP_DIR"
EXTRACTED_ITEMS=(*)

if [ ${#EXTRACTED_ITEMS[@]} -eq 1 ] && [ -d "${EXTRACTED_ITEMS[0]}" ]; then
    # Single directory extracted - move it to the target location
    mv "${EXTRACTED_ITEMS[0]}" "$CUSTOM_APP_DIR"
else
    # Multiple items or files - create target dir and move everything into it
    mkdir -p "$CUSTOM_APP_DIR"
    mv * "$CUSTOM_APP_DIR/"
fi

# Apply Spicetify configuration
echo -e "${CYAN}⚙️  Configuring Spicetify...${NC}"
spicetify config custom_apps "$NAME"
spicetify apply

# Clean up
rm -rf "$ZIP_FILE" "$TEMP_DIR"

echo -e "${GREEN}Tagify installation complete!

Next steps:
1. Restart Spotify completely
2. Look for 'Tagify' in your Spotify top navigation bar
3. Start tagging your tracks!${NC}"