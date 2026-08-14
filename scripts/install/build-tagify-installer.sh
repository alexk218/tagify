#!/bin/bash

set -e # Exit on any error

# Clean previous builds
rm -rf package Tagify.pkg
mkdir -p package/scripts

# Create the postinstall script
cat >package/scripts/postinstall <<'ENDOFSCRIPT'
#!/bin/bash

#####################################
# Tagify Installer - Post Install
# Version: 1.0
#####################################

# Strict error handling
set -euo pipefail

#####################################
# Configuration
#####################################

REPO_OWNER="alexk218"
REPO_NAME="tagify"
LOG_DIR="/tmp/tagify-installer"
LOG_FILE="$LOG_DIR/install.log"
USER_LOG=""  # Will be set after user detection
INSTALLATION_FAILED=0  # Track if installation failed
TAGIFY_TEMP_DIR=""

#####################################
# Utility Functions
#####################################

# Initialize logging
init_logging() {
    mkdir -p "$LOG_DIR"
    exec 1> >(tee -a "$LOG_FILE")
    exec 2>&1
    echo "=========================================="
    echo "Tagify Installer Log"
    echo "Date: $(date)"
    echo "=========================================="
}

# Log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Log error and exit
error_exit() {
    INSTALLATION_FAILED=1  # Set flag for finalize_log
    log "❌ ERROR: $1"
    log "=========================================="
    log "Installation failed! See error above."
    log "=========================================="
    
    notify_user "Installation Failed" "Error: $1"
    
    exit 1
}

# Show notification
notify_user() {
    local title="$1"
    local message="$2"
    if [ -n "${ACTUAL_USER:-}" ]; then
        sudo -u "$ACTUAL_USER" osascript -e "display notification \"$message\" with title \"$title\"" 2>/dev/null || true
    fi
}

# Show dialog
show_dialog() {
    local message="$1"
    if [ -n "${ACTUAL_USER:-}" ]; then
        sudo -u "$ACTUAL_USER" osascript -e "display dialog \"$message\" buttons {\"OK\"} default button \"OK\" with title \"Tagify Installer\"" 2>/dev/null || true
    fi
}

# Copy log to user-accessible location (called on success OR failure)
finalize_log() {
    # Accept exit code as parameter
    local exit_code=${1:-0}
    
    log "Finalizing log file..."
    
    # If user was detected, copy to their Desktop
    if [ -n "${USER_HOME:-}" ] && [ -n "${ACTUAL_USER:-}" ]; then
        USER_LOG="$USER_HOME/Desktop/tagify-install.log"
        
        if cp "$LOG_FILE" "$USER_LOG" 2>/dev/null; then
            chown "$ACTUAL_USER:staff" "$USER_LOG" 2>/dev/null || true
            log "✓ Log file saved to: $USER_LOG"
            
            # Add exit status to log - Check if we're in error state
            if [ $exit_code -eq 0 ] && [ "${INSTALLATION_FAILED:-0}" -eq 0 ]; then
                echo "" >> "$USER_LOG"
                echo "Installation completed successfully." >> "$USER_LOG"
            else
                echo "" >> "$USER_LOG"
                echo "Installation FAILED. See errors above." >> "$USER_LOG"
            fi
        else
            log "⚠ Could not copy log to Desktop, attempting Downloads folder..."
            USER_LOG="$USER_HOME/Downloads/tagify-install.log"
            
            if cp "$LOG_FILE" "$USER_LOG" 2>/dev/null; then
                chown "$ACTUAL_USER:staff" "$USER_LOG" 2>/dev/null || true
                log "✓ Log file saved to: $USER_LOG"
            else
                log "⚠ Could not copy log to user directories"
                USER_LOG="$LOG_FILE"
            fi
        fi
    else
        # User not detected, keep in /tmp
        log "⚠ User not detected, log remains at: $LOG_FILE"
        USER_LOG="$LOG_FILE"
    fi
}

# Cleanup temporary files
cleanup_temp_files() {
    log "Cleaning up temporary files..."
    rm -rf /tmp/tagify-download-* 2>/dev/null || true
    rm -rf /tmp/spicetify-install-* 2>/dev/null || true
    log "✓ Cleanup complete"
}

# Comprehensive cleanup on exit (success or failure)
cleanup_on_exit() {
    # Capture exit code IMMEDIATELY before anything else
    local exit_code=$?
    
    # Clean up temp files
    cleanup_temp_files
    
    # Pass exit code to finalize_log
    finalize_log $exit_code
    
    # If we failed, show where the log is
    if [ $exit_code -ne 0 ] || [ "${INSTALLATION_FAILED:-0}" -eq 1 ]; then
        log "=========================================="
        log "❌ Installation failed!"
        log "Log file location: $USER_LOG"
        log "=========================================="
    fi
}

# Detect actual user (not root)
detect_user() {
    log "Detecting user..."
    
    ACTUAL_USER=$(/usr/bin/stat -f%Su /dev/console)
    USER_HOME=$(eval echo ~$ACTUAL_USER)
    USER_ID=$(id -u "$ACTUAL_USER")
    
    log "User: $ACTUAL_USER"
    log "Home: $USER_HOME"
    log "UID: $USER_ID"
    
    if [ -z "$ACTUAL_USER" ] || [ "$ACTUAL_USER" = "root" ]; then
        error_exit "Could not detect actual user"
    fi
    
    # Set the user log location now that we know the user
    USER_LOG="$USER_HOME/Desktop/tagify-install.log"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check for required commands
    local required_commands="curl unzip"
    for cmd in $required_commands; do
        if ! command -v $cmd &> /dev/null; then
            error_exit "$cmd is not installed"
        fi
        log "✓ $cmd found"
    done
    
    # Check internet connectivity
    log "Checking internet connection..."
    if ! curl -s --connect-timeout 5 https://api.github.com > /dev/null; then
        error_exit "No internet connection. Please connect to the internet and try again."
    fi
    log "✓ Internet connection OK"
}

# Install Spicetify
install_spicetify() {
    log "Checking Spicetify installation..."
    
    # Define spicetify paths
    local spicetify_dir="$USER_HOME/.spicetify"
    local spicetify_bin="$spicetify_dir/spicetify"
    
    # Check if already installed
    if [ -f "$spicetify_bin" ]; then
        local spicetify_version=$("$spicetify_bin" -v 2>/dev/null || echo "unknown")
        log "✓ Spicetify already installed (version: $spicetify_version)"
        return 0
    fi
    
    log "Installing Spicetify..."
    notify_user "Tagify Installer" "Installing Spicetify..."
    
    # Create a temp file for capturing output (with proper permissions)
    local spicetify_log="/tmp/spicetify-install-$$.log"
    touch "$spicetify_log"
    chmod 666 "$spicetify_log"
    
    # Install as actual user, not root
    # Note: We ignore exit code (|| true) because Spicetify's installer may fail on 
    # the Marketplace prompt but still install successfully. We verify afterwards.
    log "Running Spicetify installer script..."
    sudo -u "$ACTUAL_USER" bash -c "cd '$USER_HOME' && echo 'n' | curl -fsSL https://raw.githubusercontent.com/spicetify/cli/main/install.sh | sh" > "$spicetify_log" 2>&1 || true
    
    # Copy output to main log
    cat "$spicetify_log" >> "$LOG_FILE"
    rm -f "$spicetify_log"
    
    # Check if installation was successful by looking for success message
    if grep -q "was installed successfully" "$LOG_FILE"; then
        log "✓ Spicetify installer completed"
    else
        error_exit "Spicetify installer did not complete successfully"
    fi
    
    # Verify installation by checking if binary exists at expected location
    if [ ! -f "$spicetify_bin" ]; then
        error_exit "Spicetify binary not found at $spicetify_bin after installation"
    fi
    
    # Make sure it's executable
    chmod +x "$spicetify_bin"
    chown "$ACTUAL_USER:staff" "$spicetify_bin" 2>/dev/null || true
    
    local spicetify_version=$("$spicetify_bin" -v 2>/dev/null || echo "unknown")
    log "✓ Spicetify verified (version: $spicetify_version)"
}

# Download Tagify
download_tagify() {
    log "Downloading Tagify..."
    notify_user "Tagify Installer" "Downloading Tagify..."
    
    local api_url="https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/latest"
    TAGIFY_TEMP_DIR="/tmp/tagify-download-$$"
    
    mkdir -p "$TAGIFY_TEMP_DIR"
    
    # Get latest release info
    log "Fetching release information from GitHub..."
    local release_info=$(curl -s "$api_url")
    
    if [ -z "$release_info" ]; then
        error_exit "Failed to fetch release information from GitHub"
    fi
    
    # Parse download URL
    local download_url=$(echo "$release_info" | grep '"browser_download_url"' | grep 'tagify.*\.zip' | grep -v 'source' | head -n 1 | sed -E 's/.*"browser_download_url": "([^"]+)".*/\1/')
    
    # Fallback URL
    if [ -z "$download_url" ]; then
        log "⚠ Could not parse download URL, using fallback"
        download_url="https://github.com/$REPO_OWNER/$REPO_NAME/releases/latest/download/tagify.zip"
    fi
    
    log "Download URL: $download_url"
    
    # Download with progress
    log "Downloading from GitHub..."
    if ! curl -L --progress-bar "$download_url" -o "$TAGIFY_TEMP_DIR/tagify.zip" 2>&1 | tee -a "$LOG_FILE"; then
        rm -rf "$TAGIFY_TEMP_DIR"
        error_exit "Failed to download Tagify"
    fi
    
    # Verify download
    if [ ! -f "$TAGIFY_TEMP_DIR/tagify.zip" ] || [ ! -s "$TAGIFY_TEMP_DIR/tagify.zip" ]; then
        rm -rf "$TAGIFY_TEMP_DIR"
        error_exit "Downloaded file is missing or empty"
    fi
    
    local file_size=$(du -h "$TAGIFY_TEMP_DIR/tagify.zip" | cut -f1)
    log "✓ Downloaded tagify.zip ($file_size)"
    
    # Extract
    log "Extracting archive..."
    if ! unzip -q "$TAGIFY_TEMP_DIR/tagify.zip" -d "$TAGIFY_TEMP_DIR" 2>&1 | tee -a "$LOG_FILE"; then
        rm -rf "$TAGIFY_TEMP_DIR"
        error_exit "Failed to extract Tagify archive"
    fi
    
    # Remove the zip file after extraction
    rm -f "$TAGIFY_TEMP_DIR/tagify.zip"
    
    log "✓ Archive extracted"
}

# Install Tagify
install_tagify() {
    log "Installing Tagify..."
    notify_user "Tagify Installer" "Installing Tagify..."
    
    # Download Tagify (sets TAGIFY_TEMP_DIR global)
    download_tagify
    
    local custom_apps_dir="$USER_HOME/.config/spicetify/CustomApps"
    local tagify_dir="$custom_apps_dir/tagify"
    
    # Create CustomApps directory
    log "Creating CustomApps directory..."
    sudo -u "$ACTUAL_USER" mkdir -p "$custom_apps_dir"
    
    # Remove old installation - FIX PERMISSIONS FIRST
    if [ -d "$tagify_dir" ]; then
        log "Removing previous Tagify installation..."
        
        # Fix ownership of old files (they might be owned by root from previous install)
        chown -R "$ACTUAL_USER:staff" "$tagify_dir" 2>/dev/null || true
        
        # Now remove as user
        sudo -u "$ACTUAL_USER" rm -rf "$tagify_dir"
    fi
    
    # Debug: show what's in temp directory
    log "Contents of temp directory:"
    ls -la "$TAGIFY_TEMP_DIR" | tee -a "$LOG_FILE" || log "Could not list temp directory"
    
    # Find extracted folder
    local extracted_folder=$(find "$TAGIFY_TEMP_DIR" -mindepth 1 -maxdepth 1 -type d -name "tagify" 2>/dev/null | head -n 1)
    
    log "Moving Tagify to CustomApps..."
    log "Extracted folder: ${extracted_folder:-none found}"
    
    if [ -n "$extracted_folder" ] && [ -d "$extracted_folder" ]; then
        log "Moving from: $extracted_folder"
        log "Moving to: $tagify_dir"
        
        # FIX: Change ownership BEFORE moving, OR move as root then fix ownership
        # Moving as root, then fixing ownership:
        mv "$extracted_folder" "$tagify_dir"
        chown -R "$ACTUAL_USER:staff" "$tagify_dir"
    else
        # No subfolder named "tagify", check for any directory
        extracted_folder=$(find "$TAGIFY_TEMP_DIR" -mindepth 1 -maxdepth 1 -type d ! -name "__MACOSX" 2>/dev/null | head -n 1)
        
        if [ -n "$extracted_folder" ] && [ -d "$extracted_folder" ]; then
            log "Found alternate folder: $extracted_folder"
            mv "$extracted_folder" "$tagify_dir"
            chown -R "$ACTUAL_USER:staff" "$tagify_dir"
        else
            # No subfolder at all, check if there are files directly in temp dir
            local file_count=$(find "$TAGIFY_TEMP_DIR" -mindepth 1 -type f ! -path "*__MACOSX*" 2>/dev/null | wc -l)
            log "Files found in temp dir: $file_count"
            
            if [ "$file_count" -gt 0 ]; then
                mkdir -p "$tagify_dir"
                cp -R "$TAGIFY_TEMP_DIR"/* "$tagify_dir/" 2>/dev/null || true
                chown -R "$ACTUAL_USER:staff" "$tagify_dir"
            else
                rm -rf "$TAGIFY_TEMP_DIR"
                error_exit "No files found in downloaded archive"
            fi
        fi
    fi
    
    # Cleanup temp files
    rm -rf "$TAGIFY_TEMP_DIR"
    
    # Verify installation
    if [ ! -d "$tagify_dir" ]; then
        error_exit "Tagify directory not found after installation"
    fi
    
    # Check if directory has files
    local installed_file_count=$(find "$tagify_dir" -type f 2>/dev/null | wc -l)
    log "Files installed: $installed_file_count"
    
    if [ "$installed_file_count" -eq 0 ]; then
        error_exit "Tagify directory is empty after installation"
    fi
    
    # Final ownership fix (just to be sure)
    chown -R "$ACTUAL_USER:staff" "$tagify_dir"
    
    log "✓ Tagify files installed to: $tagify_dir"
    
    # Show what was installed
    log "Installed files:"
    ls -la "$tagify_dir" | tee -a "$LOG_FILE"
}

configure_spicetify() {
    log "Configuring Spicetify..."
    notify_user "Tagify Installer" "Configuring Spicetify..."
    
    local spicetify_bin="$USER_HOME/.spicetify/spicetify"
    local config_file="$USER_HOME/.config/spicetify/config-xpui.ini"
    
    # Fix permissions
    log "Fixing Spicetify permissions..."
    if [ -d "$USER_HOME/.config/spicetify" ]; then
        chown -R "$ACTUAL_USER:staff" "$USER_HOME/.config/spicetify" 2>/dev/null || true
    fi
    if [ -d "$USER_HOME/.spicetify" ]; then
        chown -R "$ACTUAL_USER:staff" "$USER_HOME/.spicetify" 2>/dev/null || true
    fi
    
    # Check if tagify is already in config
    if [ -f "$config_file" ] && grep -q "custom_apps.*tagify" "$config_file"; then
        log "✓ Tagify already in config, skipping"
        return 0
    fi
    
    # Append tagify to custom_apps (preserves existing apps)
    log "Adding Tagify to custom_apps list..."
    
    # Get current custom_apps value
    local current_apps=""
    if [ -f "$config_file" ]; then
        current_apps=$(grep "^custom_apps" "$config_file" | sed 's/custom_apps *= *//' || echo "")
    fi
    
    # Append tagify if not already present
    if [ -z "$current_apps" ]; then
        # No custom apps yet
        sudo -u "$ACTUAL_USER" "$spicetify_bin" config custom_apps tagify
    else
        # Append to existing list
        if ! echo "$current_apps" | grep -q "tagify"; then
            sudo -u "$ACTUAL_USER" "$spicetify_bin" config custom_apps "${current_apps}|tagify"
        fi
    fi
    
    log "✓ Tagify added to config"

		# Apply changes
		log "Applying Spicetify configuration..."
		if sudo -u "$ACTUAL_USER" "$spicetify_bin" backup apply 2>&1 | tee -a "$LOG_FILE"; then
				log "✓ Spicetify configuration applied successfully"
		else
				error_exit "Failed to apply Spicetify configuration"
		fi
				
    log "✓ Configuration completed"
}

# Verify installation
verify_installation() {
    log "Verifying installation..."
    
    local tagify_dir="$USER_HOME/.config/spicetify/CustomApps/tagify"
    local config_file="$USER_HOME/.config/spicetify/config-xpui.ini"
    
    # Check Tagify directory
    if [ ! -d "$tagify_dir" ]; then
        error_exit "Verification failed: Tagify directory not found"
    fi
    log "✓ Tagify directory exists"
    
    # Check config file
    if [ -f "$config_file" ]; then
        if grep -q "tagify" "$config_file"; then
            log "✓ Tagify found in Spicetify config"
        else
            log "⚠ Warning: Tagify not found in config file"
        fi
    else
        log "⚠ Warning: Spicetify config file not found"
    fi
    
    log "✓ Installation verified"
}

# Kill Spotify process
kill_spotify() {
    log "Checking if Spotify is running..."
    
    if pgrep -x "Spotify" > /dev/null; then
        log "Spotify is running - terminating it..."
        notify_user "Tagify Installer" "Closing Spotify..."
        
        # Kill Spotify gracefully
        killall "Spotify" 2>/dev/null || true
        
        # Wait for it to fully terminate
        local count=0
        while pgrep -x "Spotify" > /dev/null && [ $count -lt 10 ]; do
            sleep 0.5
            count=$((count + 1))
        done
        
        # Force kill if still running
        if pgrep -x "Spotify" > /dev/null; then
            log "Force killing Spotify..."
            killall -9 "Spotify" 2>/dev/null || true
            sleep 1
        fi
        
        log "✓ Spotify terminated"
    else
        log "✓ Spotify is not running"
    fi
}

#####################################
# Main Installation Flow
#####################################

main() {
    # Set up trap to ALWAYS finalize log and cleanup, even on failure
    trap cleanup_on_exit EXIT
    
    # Initialize
    init_logging
    log "Starting Tagify installation..."
    
    # Detect user
    detect_user || error_exit "User detection failed"
    
    # Show starting notification
    notify_user "Tagify Installer" "Installation starting..."
    
    # Run installation steps
    check_prerequisites || error_exit "Prerequisites check failed"
    install_spicetify || error_exit "Spicetify installation failed"
    kill_spotify || error_exit "Failed to terminate Spotify"
    configure_spicetify || error_exit "Spicetify configuration failed"
    install_tagify || error_exit "Tagify installation failed"
    verify_installation || error_exit "Installation verification failed"

		# Apply Spicetify configuration one final time
    local spicetify_bin="$USER_HOME/.spicetify/spicetify"
    log "Applying Spicetify configuration..."
    if sudo -u "$ACTUAL_USER" "$spicetify_bin" apply 2>&1 | tee -a "$LOG_FILE"; then
        log "✓ Spicetify applied successfully"
    else
        log "⚠ Warning: Spicetify apply had issues"
    fi

    # Success!
    log "=========================================="
    log "✅ Installation completed successfully!"
    log "=========================================="
    
    # Show success notification
    notify_user "Tagify Installed" "Installation complete! Please restart Spotify."
    # show_dialog "Tagify has been installed successfully!\n\nPlease restart Spotify to use Tagify."
}

# Run main installation
main

ENDOFSCRIPT

# Make postinstall executable
chmod +x package/scripts/postinstall

# Build the package
echo "Building package..."
pkgbuild --nopayload \
	--identifier com.tagify.installer \
	--version 1.0 \
	--scripts package/scripts \
	Tagify.pkg

echo ""
echo "=========================================="
echo "      Package created successfully!"
echo "=========================================="
echo "Output: Tagify.pkg"
echo ""
echo "Installation logs will be saved to:"
echo "  - /tmp/tagify-installer/install.log (during install)"
echo "  - ~/Desktop/tagify-install.log (after install)"
echo ""
