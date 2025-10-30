# Installing Spicetify - Complete Beginner's Guide

### For Windows Users

1. **Open PowerShell**

   - Press `Windows key + R`
   - Type "powershell" - press Enter

2. Run this command:

   ```powershell
   iwr -useb https://raw.githubusercontent.com/spicetify/spicetify-cli/main/install.ps1 | iex
   ```

3. (Optional) Run this command to install Spicetify marketplace:

   ```
   iwr -useb https://raw.githubusercontent.com/spicetify/marketplace/main/resources/install.ps1 | iex
   ```

### For Mac Users

1. **Open Terminal**

   - Press `Cmd + Space` to open Spotlight
   - Type "Terminal" - press Enter

2. Run this command:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/spicetify/spicetify-cli/main/install.sh | sh
   ```

3. (Optional) Run this command to install Spicetify marketplace:

   ```
   curl -fsSL https://raw.githubusercontent.com/spicetify/marketplace/main/resources/install.sh | sh
   ```

## Verify Installation

1. **Close Spotify completely** (make sure it's not running in the background)
2. **Reopen Spotify**
3. **Look for changes** in the interface - it should look slightly different
4. **Test command**: Open PowerShell/Terminal again and type:
   ```
   spicetify --version
   ```
   You should see a version number if installed correctly.

## Next Steps - Tagify 🕺🏷️

Once Spicetify is installed and working:

1. **Go back to the [main Tagify README](README.md)**
2. **Follow the Tagify installation instructions**
3. **Start organizing your music!**
