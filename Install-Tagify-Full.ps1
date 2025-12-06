<#
.SYNOPSIS
    Tagify Installer for Windows - Full installation of Spicetify & Tagify

.VERSION
    1.0.0

.DESCRIPTION
    Automates installation and updates for Spicetify CLI and Tagify custom app.
#>

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

#region Variables
$REPO_OWNER = "alexk218"
$REPO_NAME = "tagify"
$script:LOG_DIR = ""
$script:LOG_FILE = ""
$script:USER_LOG = ""
$script:INSTALLATION_FAILED = $false
$spicetifyFolderPath = "$env:LOCALAPPDATA\spicetify"
$spicetifyOldFolderPath = "$HOME\spicetify-cli"
#endregion Variables

#region Logging
function Initialize-Logging {
    # Unique directory name
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $script:LOG_DIR = "$env:TEMP\tagify-installer-$timestamp-$PID"
    $script:LOG_FILE = "$LOG_DIR\install.log"

    if (-not (Test-Path $LOG_DIR)) {
        New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null
    }
    
    "==========================================" | Out-File -FilePath $LOG_FILE -Encoding UTF8
    "Tagify Installer Log " | Out-File -FilePath $LOG_FILE -Append -Encoding UTF8
    "Date: $(Get-Date)" | Out-File -FilePath $LOG_FILE -Append -Encoding UTF8
    "==========================================" | Out-File -FilePath $LOG_FILE -Append -Encoding UTF8
}

function Write-Log {
    param(
        [string]$Message, 
        [System.ConsoleColor]$ForegroundColor = [System.ConsoleColor]::White
    )

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] $Message"
    Write-Host $logMessage -ForegroundColor $ForegroundColor
    $logMessage | Out-File -FilePath $LOG_FILE -Append -Encoding UTF8
}


function Write-ErrorAndExit {
    param([string]$Message)
    
    $script:INSTALLATION_FAILED = $true
    Write-Log "ERROR: $Message" -ForegroundColor Red
    Write-Log "==========================================" -ForegroundColor Red
    Write-Log "Operation failed! See error above." -ForegroundColor Red
    Write-Log "==========================================" -ForegroundColor Red
    
    Show-Notification "Tagify Installer - Error" "Error: $Message"
    
    Finalize-Log 1
    exit 1
}

function Show-Notification {
    param([string]$Title, [string]$Message)
    
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $notification = New-Object System.Windows.Forms.NotifyIcon
        $notification.Icon = [System.Drawing.SystemIcons]::Information
        $notification.BalloonTipTitle = $Title
        $notification.BalloonTipText = $Message
        $notification.Visible = $true
        $notification.ShowBalloonTip(3000)
        Start-Sleep -Seconds 1
        $notification.Dispose()
    }
    catch {
        Write-Log "Could not show notification: $_"
    }
}

function Finalize-Log {
    param([int]$ExitCode = 0)
    
    Write-Log "Finalizing log file..." -ForegroundColor DarkMagenta
    
    # TODO: remove this... we don't want logs on user's desktop
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $script:USER_LOG = Join-Path $desktopPath "tagify-install.log"
    
    try {
        Copy-Item -Path $LOG_FILE -Destination $USER_LOG -Force
        Write-Log "Log file saved to: $USER_LOG"
        
        if ($ExitCode -eq 0 -and -not $script:INSTALLATION_FAILED) {
            "" | Out-File -FilePath $USER_LOG -Append -Encoding UTF8
            "Operation completed successfully." | Out-File -FilePath $USER_LOG -Append -Encoding UTF8
        }
        else {
            "" | Out-File -FilePath $USER_LOG -Append -Encoding UTF8
            "Operation FAILED. See errors above." | Out-File -FilePath $USER_LOG -Append -Encoding UTF8
            exit 1
        }
    }
    catch {
        Write-Log "Could not copy log to Desktop: $_"
        $script:USER_LOG = $LOG_FILE
    }
}

function Cleanup-TempFiles {
    Write-Log "Cleaning up temporary files..." -ForegroundColor DarkMagenta
    Remove-Item -Path "$env:TEMP\tagify-download-*" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "$env:TEMP\spicetify-install-*" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Log "Cleanup complete"
}
#endregion Logging

#region Prerequisites and Validation
function Test-Prerequisites {
    [CmdletBinding()]
    param()

    Write-Log "Checking prerequisites..." -ForegroundColor DarkMagenta

    # Check PowerShell version
    $PSMinVersion = [version]'5.1'
    if ($PSVersionTable.PSVersion -lt $PSMinVersion) {
        Write-ErrorAndExit "PowerShell 5.1 or higher is required. You have PowerShell $($PSVersionTable.PSVersion).`n`nInstall:`nhttps://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows"
    }
    Write-Log "PowerShell $($PSVersionTable.PSVersion) is compatible"
    
    # Check admin privileges
    $currentUser = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    $isAdmin = $currentUser.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    
    if ($isAdmin) {
        Write-ErrorAndExit "This script is running as Administrator, which will cause permission issues with Spicetify.`n`nPlease run this script as a normal user (without 'Run as Administrator')."
    }
    Write-Log "Running as normal user (not Administrator)"
    
    
    # Test internet connection
    try {
        Invoke-WebRequest -Uri "https://api.github.com" -UseBasicParsing -TimeoutSec 10 | Out-Null
        Write-Log "Internet connection OK"
    }
    catch {
        Write-ErrorAndExit "No internet connection. Please connect to the internet and try again."
    }

    # Check Spotify installation
    Write-Log "Verifying Spotify installation..."
    $spotifyPath = "$env:LOCALAPPDATA\Spotify"
    
    if (-not (Test-Path $spotifyPath)) {
        Write-ErrorAndExit "Spotify not found at: $spotifyPath`nPlease install Spotify first from: https://www.spotify.com/download"
    }
    
    Write-Log "Spotify found at: $spotifyPath"

    $compatCheck = Test-SpotifyCompatibility
    
    if (-not $compatCheck.CanProceed) {
        Handle-SpotifyIncompatibility `
            -CurrentVersion $compatCheck.SpotifyVersion `
            -RequiredVersion $compatCheck.RecommendedVersion `
            -IsTooNew $compatCheck.IsTooNew
    }
    elseif ($compatCheck.Warning) {
        Write-Log "⚠️  $($compatCheck.Warning)" -ForegroundColor Yellow
    }
    
    Write-Log "All prerequisites met"
}

function Test-SpicetifyState {
    [CmdletBinding()]
    param()
    
    $state = @{
        IsInstalled        = $false
        IsPatched          = $true
        HasBackup          = $true
        NeedsUpdate        = $false
        SpotifyVersion     = $null
        SpicetifyVersion   = $null
        ConfigExists       = $false
        BackupVersionMatch = $true
        ErrorDetails       = @()
        StatusOutput       = ""
    }
    
    try {
        # Check if Spicetify is installed
        $spicetifyExe = Get-SpicetifyPath
        if (-not $spicetifyExe) {
            # Spicetify not found, return uninstalled state
            $state.IsInstalled = $false
            $state.ErrorDetails += "Spicetify not found"
            return $state
        }
        
        $state.IsInstalled = $true
        $state.SpicetifyVersion = Get-SpicetifyVersion
        Write-Log "Spicetify version: $($state.SpicetifyVersion)"

        $configFile = Get-SpicetifyConfigPath
        if (Test-Path $configFile) {
            $state.ConfigExists = $true
        }

        # Check if Spicetify needs update
        try {
            $latestRelease = Invoke-RestMethod -Uri 'https://api.github.com/repos/spicetify/cli/releases/latest' -TimeoutSec 10
            $latestVersion = $latestRelease.tag_name -replace 'v', ''
            $currentVersion = $state.SpicetifyVersion -replace 'spicetify version ', '' -replace 'v', ''
            
            if ([version]$latestVersion -gt [version]$currentVersion) {
                $state.NeedsUpdate = $true
                Write-Log "Spicetify update available: $currentVersion -> $latestVersion"
            }
        }
        catch {
            Write-Log "Could not check for Spicetify updates: $_"
        }
    }
    catch {
        $state.ErrorDetails += "Spicetify not found or not functional: $_"
    }
    
    return $state
}
#endregion Prerequisites and Validation

#region Spotify Version Control
function Get-SpotifyVersion {
    try {
        Write-Log "Detecting Spotify version..." -ForegroundColor DarkMagenta
        
        $spotifyPaths = @(
            "$env:APPDATA\Spotify\Spotify.exe",
            "$env:LOCALAPPDATA\Microsoft\WindowsApps\Spotify.exe" # todo: remove this - microsoft store ?
        )
        
        # Method 1: Check Spotify.exe version info
        foreach ($path in $spotifyPaths) {
            if (Test-Path $path) {
                $versionInfo = (Get-Item $path).VersionInfo
                if ($versionInfo.FileVersion) {
                    # Extract semantic version (1.2.77.0 -> 1.2.77)
                    $version = $versionInfo.FileVersion -replace '^(\d+\.\d+\.\d+).*', '$1'
                    Write-Log "Found Spotify at: $path (version: $version)"
                    return $version
                }
            }
        }
        
        # Method 2: Check prefs file (fallback)
        $prefsPath = "$env:APPDATA\Spotify\prefs"
        if (Test-Path $prefsPath) {
            $prefs = Get-Content $prefsPath -Raw
            
            # Match: app.last-launched-version="1.2.77.358.g4339a634"
            if ($prefs -match 'app\.last-launched-version="([\d.]+)') {
                $fullVersion = $matches[1]
                
                # Extract just the semantic version (1.2.77) from 1.2.77.358.g4339a634
                if ($fullVersion -match '^(\d+\.\d+\.\d+)') {
                    $version = $matches[1]
                    Write-Log "Found Spotify version: $version (full: $fullVersion)"
                    return $version
                }
            }
        }

        Write-Log "Could not detect Spotify version"
        return $null
    }
    catch {
        Write-Log "Error detecting Spotify version: $_"
        return $null
    }
}

function Get-SystemArchitecture {
    $arch = $env:PROCESSOR_ARCHITECTURE
    
    switch ($arch) {
        "AMD64" { 
            return @{
                Type        = "x64"
                DisplayName = "64-bit (x64)"
            }
        }
        "ARM64" { 
            return @{
                Type        = "ARM64"
                DisplayName = "ARM64"
            }
        }
        default { 
            return @{
                Type        = "x86"
                DisplayName = "32-bit (x86)"
            }
        }
    }
}

function Get-SpicetifyCompatibilityInfo {
    <#
    .SYNOPSIS
    Fetches compatibility info from repository config file
    
    .DESCRIPTION
    Fetches compatibility data from manually maintained config file.
    Falls back to hardcoded values if fetch fails.
    #>
    
    try {
        Write-Log "Fetching compatibility data from repository..." -ForegroundColor DarkMagenta
        
        $configUrl = "https://raw.githubusercontent.com/alexk218/tagify/main/config/spotify-compatibility.json"
        $config = Invoke-RestMethod -Uri $configUrl -TimeoutSec 15
        
        Write-Log "✓ Fetched compatibility config (last updated: $($config.lastUpdated))" -ForegroundColor Green
        Write-Log "  Windows: $($config.spotify.windows.min) -> $($config.spotify.windows.max)"
        
        return @{
            LastUpdated      = $config.lastUpdated
            Source           = "Repository Config File"
            SpicetifyVersion = $config.spicetifyVersion
            Spotify          = @{
                Windows = @{
                    Min = $config.spotify.windows.min
                    Max = $config.spotify.windows.max
                }
            }
        }
    }
    catch {
        Write-Log "Failed to fetch compatibility config: $_" -ForegroundColor Yellow
        Write-Log "Using hardcoded fallback values" -ForegroundColor Yellow
        
        # Hardcoded fallback
        return @{
            LastUpdated      = "2025-01-15"
            Source           = "Hardcoded Fallback"
            SpicetifyVersion = "2.38.4"
            Spotify          = @{
                Windows = @{
                    Min = "1.2.14"
                    Max = "1.2.77"
                }
            }
        }
    }
}

function Compare-SpotifyVersion {
    <#
    .SYNOPSIS
    Compares a Spotify version against a min/max range
    
    .PARAMETER Version
    The version to check (e.g., "1.2.78")
    
    .PARAMETER MinVersion
    Minimum supported version (e.g., "1.2.14")
    
    .PARAMETER MaxVersion
    Maximum supported version (e.g., "1.2.77")
    
    .OUTPUTS
    Hashtable with IsCompatible, IsTooOld, IsTooNew properties
    #>
    
    param(
        [string]$Version,
        [string]$MinVersion,
        [string]$MaxVersion
    )
    
    try {
        # Remove any prefixes and trim
        $Version = $Version -replace '[^\d.]', '' -replace '\.+$', ''
        $MinVersion = $MinVersion -replace '[^\d.]', '' -replace '\.+$', ''
        $MaxVersion = $MaxVersion -replace '[^\d.]', '' -replace '\.+$', ''
        
        $versionObj = [version]$Version
        $minObj = [version]$MinVersion
        $maxObj = [version]$MaxVersion
        
        $isCompatible = ($versionObj -ge $minObj) -and ($versionObj -le $maxObj)
        
        return @{
            IsCompatible = $isCompatible
            IsTooOld     = $versionObj -lt $minObj
            IsTooNew     = $versionObj -gt $maxObj
        }
    }
    catch {
        Write-Log "Version comparison failed: $_"
        return @{
            IsCompatible = $null
            Error        = $_.Exception.Message
        }
    }
}

function Test-SpotifyCompatibility {
    <#
    .SYNOPSIS
    Tests if current Spotify version is compatible with Spicetify
    
    .OUTPUTS
    Hashtable with CanProceed, IsCompatible, and other status properties
    #>
    
    Write-Log "Checking Spotify compatibility..." -ForegroundColor DarkMagenta
    
    # Get installed Spotify version
    $spotifyVersion = Get-SpotifyVersion
    
    if (-not $spotifyVersion) {
        Write-Log "Could not detect Spotify version - proceeding with caution" -ForegroundColor Yellow
        return @{
            CanProceed = $true
            Warning    = "Spotify version could not be detected"
        }
    }
    
    Write-Log "Detected Spotify version: $spotifyVersion"
    
    # Get compatibility data from Spicetify releases
    $compatData = Get-SpicetifyCompatibilityInfo
    
    if (-not $compatData) {
        Write-Log "Could not fetch compatibility data - proceeding with caution" -ForegroundColor Yellow
        return @{
            CanProceed     = $true
            Warning        = "Could not verify compatibility (network error or API unavailable)"
            SpotifyVersion = $spotifyVersion
        }
    }
    
    $windowsCompat = $compatData.Spotify.Windows
    
    if (-not $windowsCompat.Min -or -not $windowsCompat.Max) {
        Write-Log "Compatibility information incomplete - proceeding with caution" -ForegroundColor Yellow
        return @{
            CanProceed     = $true
            Warning        = "Compatibility information incomplete"
            SpotifyVersion = $spotifyVersion
        }
    }
    
    # Compare versions
    $comparison = Compare-SpotifyVersion `
        -Version $spotifyVersion `
        -MinVersion $windowsCompat.Min `
        -MaxVersion $windowsCompat.Max
    
    if ($comparison.IsCompatible -eq $true) {
        Write-Log "✓ Spotify version is compatible" -ForegroundColor Green
        return @{
            CanProceed       = $true
            IsCompatible     = $true
            SpotifyVersion   = $spotifyVersion
            CompatibleRange  = "$($windowsCompat.Min) - $($windowsCompat.Max)"
            SpicetifyVersion = $compatData.SpicetifyVersion
        }
    }
    
    # Not compatible
    $reason = if ($comparison.IsTooNew) {
        "Your Spotify version ($spotifyVersion) is TOO NEW"
    }
    elseif ($comparison.IsTooOld) {
        "Your Spotify version ($spotifyVersion) is TOO OLD"
    }
    else {
        "Your Spotify version ($spotifyVersion) is NOT COMPATIBLE"
    }
    
    return @{
        CanProceed         = $false
        IsCompatible       = $false
        Reason             = $reason
        SpotifyVersion     = $spotifyVersion
        RequiredRange      = "$($windowsCompat.Min) - $($windowsCompat.Max)"
        RecommendedVersion = $windowsCompat.Max
        SpicetifyVersion   = $compatData.SpicetifyVersion
        IsTooNew           = $comparison.IsTooNew
        IsTooOld           = $comparison.IsTooOld
    }
}

function Get-SpotifyDownloadUrl {
    <#
    .SYNOPSIS
    Constructs Loadspot URL information for downloading Spotify
    
    .PARAMETER Version
    Spotify version to download (e.g., "1.2.77")
    
    .OUTPUTS
    Hashtable with BrowserUrl, Version, and Architecture
    #>
    
    param(
        [string]$Version
    )
    
    $sysArch = Get-SystemArchitecture
    $baseUrl = "https://loadspot.pages.dev/"
    
    return @{
        BrowserUrl          = $baseUrl
        Version             = $Version
        Architecture        = $sysArch.Type
        ArchitectureDisplay = $sysArch.DisplayName
    }
}

function Handle-SpotifyIncompatibility {
    param(
        [string]$CurrentVersion,
        [string]$RequiredVersion,
        [bool]$IsTooNew
    )
    
    if ($IsTooNew) {
        $sysArch = Get-SystemArchitecture
        $loadspotUrl = "https://loadspot.pages.dev/"
        
        $message = @"

═══════════════════════════════════════════════════════════
⚠️  SPOTIFY DOWNGRADE REQUIRED
═══════════════════════════════════════════════════════════

Current Spotify version: v$CurrentVersion (TOO NEW)
Required version: v$RequiredVersion or older

Spicetify doesn't support Spotify v$CurrentVersion yet.

═══════════════════════════════════════════════════════════
DOWNLOAD INSTRUCTIONS
═══════════════════════════════════════════════════════════

1. We'll open Loadspot in your browser

2. On the Loadspot page, download:
   
   ┌────────────────────────────────────────────────────────┐
   │  Spotify Version: $RequiredVersion                          │
   │  Architecture: $($sysArch.DisplayName)                      │
   └────────────────────────────────────────────────────────┘

3. After downloading, UNINSTALL your current Spotify:
   Windows Settings > Apps > Spotify > Uninstall

4. Install the downloaded Spotify v$RequiredVersion

5. IMPORTANT: Disable auto-updates in Spotify settings:
   Settings > Show Advanced Settings > Automatic Updates > OFF

6. Re-run this Tagify installer

═══════════════════════════════════════════════════════════
NEED HELP?
═══════════════════════════════════════════════════════════

Spicetify Discord: https://discord.gg/spicetify

═══════════════════════════════════════════════════════════

"@
        
        Write-Host $message -ForegroundColor Yellow
        
        # Emphasis box for version/arch
        Write-Host ""
        Write-Host "  ╔════════════════════════════════════════════════════╗" -ForegroundColor Cyan
        Write-Host "  ║  DOWNLOAD THIS VERSION:                            ║" -ForegroundColor Cyan
        Write-Host "  ║                                                    ║" -ForegroundColor Cyan
        Write-Host "  ║  Spotify v$RequiredVersion ($($sysArch.Type))                        ║" -ForegroundColor Cyan
        Write-Host "  ╚════════════════════════════════════════════════════╝" -ForegroundColor Cyan
        Write-Host ""
        
        Write-Host "Press ENTER to open Loadspot download page..." -NoNewline -ForegroundColor Green
        Read-Host
        
        Write-Log "Opening Loadspot..."
        Start-Process $loadspotUrl
        
        # Show persistent notification
        Show-Notification "Tagify Installer - Action Required" "Download Spotify v$RequiredVersion ($($sysArch.Type)) from Loadspot"
        
        Write-Host ""
        Write-Host "✓ Loadspot opened in your browser" -ForegroundColor Green
        Write-Host ""
        Write-Host "Remember to download: Spotify v$RequiredVersion ($($sysArch.Type))" -ForegroundColor Yellow
        Write-Host "After installing, re-run this installer." -ForegroundColor Yellow
        Write-Host ""
        
        Write-ErrorAndExit "Installation cancelled - please downgrade Spotify to v$RequiredVersion first"
    }
    else {
        # Version too old
        $message = @"

═══════════════════════════════════════════════════════════
⚠️  SPOTIFY UPDATE REQUIRED
═══════════════════════════════════════════════════════════

Current Spotify version: v$CurrentVersion (TOO OLD)
Required version: v$RequiredVersion or newer

Your Spotify is outdated. Please update to the latest version.

═══════════════════════════════════════════════════════════

"@
        
        Write-Host $message -ForegroundColor Yellow
        Write-Host "Press ENTER to open Spotify download page..." -NoNewline -ForegroundColor Green
        Read-Host
        
        Start-Process "https://www.spotify.com/download"
        Write-Host "✓ Spotify download page opened" -ForegroundColor Green
        
        Write-ErrorAndExit "Installation cancelled - please update Spotify first"
    }
}

# todo: maybe not a notification with timer? user must click 'x'.
function Show-SpotifyDowngradeNotification {
    param(
        [string]$Version,
        [string]$Architecture
    )
    
    try {
        Add-Type -AssemblyName System.Windows.Forms
        
        $notification = New-Object System.Windows.Forms.NotifyIcon
        $notification.Icon = [System.Drawing.SystemIcons]::Information
        $notification.BalloonTipTitle = "Spotify Downgrade Required"
        $notification.BalloonTipText = "Download Spotify v$Version ($Architecture) from Loadspot"
        $notification.Visible = $true
        
        # Show for longer (10 seconds)
        $notification.ShowBalloonTip(10000)
        
        Start-Sleep -Seconds 2
        $notification.Dispose()
    }
    catch {
        Write-Log "Could not show notification: $_"
    }
}
#endregion Spotify Version Control


#region Version Management
function Get-InstalledTagifyVersion {
    $tagifyPath = "$env:USERPROFILE\AppData\Roaming\spicetify\CustomApps\tagify"
    $packagePath = "$tagifyPath\package.json"

    Write-Log "Checking for installed Tagify version..." -ForegroundColor DarkMagenta
    
    if (Test-Path $packagePath) {
        try {
            $package = Get-Content $packagePath -Raw | ConvertFrom-Json
            return $package.version
        }
        catch {
            Write-Log "Could not read Tagify package.json: $_"
            return $null
        }
    }
    
    # Fallback: check if directory exists but no version info
    if (Test-Path $tagifyPath) {
        $fileCount = (Get-ChildItem $tagifyPath -File -ErrorAction SilentlyContinue).Count
        if ($fileCount -gt 0) {
            return "Unknown"
        }
    }
    
    return $null
}

function Get-LatestTagifyVersion {
    [CmdletBinding()]
    param()

    try {
        Write-Log "Checking for latest Tagify version..." -ForegroundColor DarkMagenta
        $apiUrl = "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/latest"
        $latestRelease = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 15
        
        $version = $latestRelease.tag_name -replace 'v', ''
        $downloadUrl = $null
        
        # Find the main zip asset (exclude source code)
        $mainAsset = $latestRelease.assets | Where-Object { 
            $_.name -like "tagify*.zip" -and $_.name -notlike "*source*" 
        } | Select-Object -First 1
        
        if ($mainAsset) {
            $downloadUrl = $mainAsset.browser_download_url
        }
        else {
            # Fallback URL
            $downloadUrl = "https://github.com/$REPO_OWNER/$REPO_NAME/releases/latest/download/tagify.zip"
        }
        
        return @{
            Version      = $version
            DownloadUrl  = $downloadUrl
            ReleaseNotes = $latestRelease.body
            Success      = $true
        }
    }
    catch {
        Write-Log "Could not check for latest Tagify version: $_"
        return @{
            Version      = "Unknown"
            DownloadUrl  = "https://github.com/$REPO_OWNER/$REPO_NAME/releases/latest/download/tagify.zip"
            ReleaseNotes = ""
            Success      = $false
        }
    }
}

function Test-TagifyUpdateAvailable {
    param(
        [string]$CurrentVersion,
        [string]$LatestVersion
    )
    
    if (-not $CurrentVersion -or $CurrentVersion -eq "Unknown") {
        return $true  # No version installed, treat as update available
    }
    
    if (-not $LatestVersion -or $LatestVersion -eq "Unknown") {
        return $false  # Can't determine latest, assume no update
    }
    
    try {
        return [version]$LatestVersion -gt [version]$CurrentVersion
    }
    catch {
        Write-Log "Could not compare versions: Current=$CurrentVersion, Latest=$LatestVersion"
        return $false
    }
}
#endregion Version Management

#region Spicetify Detection
function Get-SpicetifyPath {
    # TODO verify that this is reliable
    $paths = @(
        "$env:LOCALAPPDATA\spicetify\spicetify.exe",
        "$env:USERPROFILE\.spicetify\spicetify.exe",
        "$env:APPDATA\spicetify\spicetify.exe"
    )

    foreach ($p in $paths) {
        if (Test-Path $p) {
            return $p
        }
    }

    return $null
}

function Get-SpicetifyVersion {
    try {
        $spicetifyExe = Get-SpicetifyPath
        if (-not $spicetifyExe) {
            return $null
        }
    
        $versionOutput = & $spicetifyExe -v 2>&1
        return ($versionOutput | Out-String).Trim()
    }
    catch {
        return $null
    }
}

function Get-SpicetifyConfigPath {
    try {
        $spicetifyExe = Get-SpicetifyPath
        if (-not $spicetifyExe) {
            return $null
        }
        
        $configPath = & $spicetifyExe -c 2>&1
        $exitCode = $LASTEXITCODE
        
        if ($exitCode -eq 0 -and $configPath -and (Test-Path $configPath)) {
            return $configPath.Trim()
        }
        
        return $null
    }
    catch {
        Write-Log "Could not get Spicetify config path: $_"
        return $null
    }
}
#endregion Spicetify Detection

#region System Analysis
function Get-SystemState {
    Write-Log "==========================================" -ForegroundColor Cyan
    Write-Log "ANALYZING SYSTEM STATE" -ForegroundColor Cyan
    Write-Log "==========================================" -ForegroundColor Cyan
    
    # Get current versions
    $currentTagify = Get-InstalledTagifyVersion
    $latestTagifyInfo = Get-LatestTagifyVersion
    $spicetifyState = Test-SpicetifyState
    
    $systemState = @{
        TagifyInstalled         = $currentTagify -ne $null
        TagifyVersion           = $currentTagify
        LatestTagifyVersion     = $latestTagifyInfo.Version
        TagifyUpdateAvailable   = Test-TagifyUpdateAvailable -CurrentVersion $currentTagify -LatestVersion $latestTagifyInfo.Version
        TagifyDownloadUrl       = $latestTagifyInfo.DownloadUrl
        SpicetifyState          = $spicetifyState
        RecommendedAction       = ""
        ActionDescription       = ""
        RequiresSpicetifyRepair = $false
        RequiresTagifyUpdate    = $false
    }
    
    Write-Log "Current State Analysis:"
    Write-Log "- Tagify Installed: $($systemState.TagifyInstalled) (v$($currentTagify))" -ForegroundColor $(if ($systemState.TagifyInstalled) { 'Green' } else { 'Red' })
    Write-Log "- Latest Tagify: v$($latestTagifyInfo.Version)"
    Write-Log "- Tagify Update Available: $($systemState.TagifyUpdateAvailable)" -ForegroundColor $(if ($systemState.TagifyUpdateAvailable) { 'Yellow' } else { 'Green' })
    Write-Log "- Spicetify Installed: $($spicetifyState.IsInstalled)" -ForegroundColor $(if ($spicetifyState.IsInstalled) { 'Green' } else { 'Red' })
    # Write-Log "- Spicetify Working: $($spicetifyState.IsPatched)" -ForegroundColor $(if ($spicetifyState.IsPatched) { 'Green' } else { 'Red' })
    # Write-Log "- Spicetify Backup Valid: $($spicetifyState.BackupVersionMatch)" -ForegroundColor $(if ($spicetifyState.BackupVersionMatch) { 'Green' } else { 'Red' })

    return $systemState
}
#endregion System Analysis

#region Operation Planning & Execution
function Get-RequiredOperations {
    param([hashtable]$SystemState)
    
    Write-Log "Getting required operations..." -ForegroundColor DarkMagenta
    
    $operations = @()
    
    # Spicetify operations
    if (-not $SystemState.SpicetifyState.IsInstalled) {
        $operations += @{
            Type        = "InstallSpicetify"
            Description = "Install Spicetify"
            Priority    = 1
        }
    }
    elseif ($SystemState.SpicetifyState.NeedsUpdate) {
        $operations += @{
            Type        = "UpdateSpicetify" 
            Description = "Update Spicetify to latest version"
            Priority    = 2
        }
    }
    
    # apply spicetify before Tagify installation
    if ($SystemState.SpicetifyState.IsInstalled -or 
        ($operations | Where-Object { $_.Type -in @("InstallSpicetify", "UpdateSpicetify") })) {
        $operations += @{
            Type        = "ApplySpicetify"
            Description = "Initialize Spicetify configuration"
            Priority    = 3
        }
    }
    
    # Tagify operations
    if (-not $SystemState.TagifyInstalled) {
        $operations += @{
            Type              = "InstallTagify"
            Description       = "Install Tagify v$($SystemState.LatestTagifyVersion)"
            TagifyDownloadUrl = $SystemState.TagifyDownloadUrl
            Priority          = 4
        }
    }
    elseif ($SystemState.TagifyUpdateAvailable) {
        $operations += @{
            Type              = "UpdateTagify"
            Description       = "Update Tagify v$($SystemState.TagifyVersion) → v$($SystemState.LatestTagifyVersion)"
            TagifyDownloadUrl = $SystemState.TagifyDownloadUrl
            Priority          = 5
        }
    }

    # sort by priority (cast to int - otherwise treats as string - big pain in ass)
    return $operations | Sort-Object { [int]$_.Priority }
}

function Execute-Operations {
    param([array]$Operations)

    $spicetifyWasUpdated = $false
    
    foreach ($operation in $Operations) {
        Write-Log "Executing: $($operation.Description)" -ForegroundColor DarkMagenta
        
        switch ($operation.Type) {
            "InstallSpicetify" {
                Install-SpicetifyCore 
            }
            "UpdateSpicetify" {
                # We don't run 'spicetify update' - we always do a fresh install from their Releases
                Install-SpicetifyCore
                $spicetifyWasUpdated = $true 
            }
            "ApplySpicetify" { 
                Apply-SpicetifyConfiguration -ForceRestore $spicetifyWasUpdated
                $appliedSpicetify = $true  # don't appply again (in Main) # todo remove this ? if we're always applying at the end
            }
            "InstallTagify" { Install-Tagify -DownloadUrl $operation.TagifyDownloadUrl }
            "UpdateTagify" { Install-Tagify -DownloadUrl $operation.TagifyDownloadUrl }
        }
        
        Write-Log "Completed: $($operation.Description)"
    }

    return @{ AppliedSpicetify = $appliedSpicetify }
}
#endregion Operation Planning & Execution

#region Spicetify Installation
function Move-OldSpicetifyFolder {
    if (Test-Path -Path $spicetifyOldFolderPath) {
        Write-Log 'Moving old spicetify folder...' -ForegroundColor DarkMagenta
        if (-not (Test-Path $spicetifyFolderPath)) {
            New-Item -ItemType Directory -Path $spicetifyFolderPath -Force | Out-Null
        }
        Copy-Item -Path "$spicetifyOldFolderPath\*" -Destination $spicetifyFolderPath -Recurse -Force
        Remove-Item -Path $spicetifyOldFolderPath -Recurse -Force
        Write-Log "Old spicetify folder moved"
    }
}

function Install-SpicetifyCore {
    [CmdletBinding()]
    param()

    Write-Log 'Installing/updating Spicetify...' -ForegroundColor DarkMagenta
    
    # Architecture detection
    if ($env:PROCESSOR_ARCHITECTURE -eq 'AMD64') {
        $architecture = 'x64'
    }
    elseif ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
        $architecture = 'arm64'
    }
    else {
        $architecture = 'x32'
    }
    
    try {
        Write-Log 'Fetching latest Spicetify version...'
        $latestRelease = Invoke-RestMethod -Uri 'https://api.github.com/repos/spicetify/cli/releases/latest'
        $targetVersion = $latestRelease.tag_name -replace 'v', ''
        Write-Log "Latest Spicetify version: v$targetVersion"
        
        $archivePath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "spicetify.zip")
        
        Write-Log "Downloading Spicetify v$targetVersion..."
        $downloadUrl = "https://github.com/spicetify/cli/releases/download/v$targetVersion/spicetify-$targetVersion-windows-$architecture.zip"
        Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing
        Write-Log "Downloaded Spicetify"
        
        Write-Log 'Extracting Spicetify...'
        if (Test-Path $spicetifyFolderPath) {
            Remove-Item -Path $spicetifyFolderPath -Recurse -Force
        }
        New-Item -ItemType Directory -Path $spicetifyFolderPath -Force | Out-Null
        Expand-Archive -Path $archivePath -DestinationPath $spicetifyFolderPath -Force
        Write-Log "Extracted Spicetify"
        
        # Add to PATH
        Write-Log 'Adding Spicetify to PATH...'
        $user = [EnvironmentVariableTarget]::User
        $path = [Environment]::GetEnvironmentVariable('PATH', $user)
        $path = $path -replace "$([regex]::Escape($spicetifyOldFolderPath))\\*;*", ''
        if ($path -notlike "*$spicetifyFolderPath*") {
            $path = "$path;$spicetifyFolderPath"
        }
        [Environment]::SetEnvironmentVariable('PATH', $path, $user)
        $env:PATH = $path
        Write-Log "Added to PATH"
        
        Remove-Item -Path $archivePath -Force -ErrorAction 'SilentlyContinue'
        Write-Log 'Spicetify installation completed'
    }
    catch {
        Write-ErrorAndExit "Failed to install Spicetify: $_"
    }
}

function Install-Spicetify {
    [CmdletBinding()]
    param()

    Write-Log "Checking Spicetify installation..." -ForegroundColor DarkMagenta
    
    $spicetifyExe = Get-SpicetifyPath
    
    if ($spicetifyExe) {
        # Spicetify is installed, check if it's working properly
        Write-Log "Spicetify executable found at: $spicetifyExe"
        $version = Get-SpicetifyVersion
        $spicetifyState = Test-SpicetifyState
        
        if ($spicetifyState.IsInstalled -and -not $spicetifyState.NeedsUpdate -and $spicetifyState.BackupVersionMatch) {
            Write-Log "Spicetify already installed and working (version: $version)"
            return
        }
        else {
            Write-Log "Spicetify found but needs update or repair, proceeding with installation..."
        }
    }
    else {
        Write-Log "Spicetify not found, installing..."
    }
    
    Write-Log "Installing Spicetify..."
    Show-Notification "Tagify Installer" "Installing Spicetify..."
    
    # Create directory if needed
    if (-not (Test-Path $spicetifyFolderPath)) {
        New-Item -ItemType Directory -Path $spicetifyFolderPath -Force | Out-Null
    }
    
    Move-OldSpicetifyFolder
    Install-SpicetifyCore
    
    # Verify installation
    Write-Log "Verifying Spicetify installation..."
    Start-Sleep -Seconds 2
    
    $spicetifyExe = Get-SpicetifyPath
    if (-not $spicetifyExe) {
        Write-ErrorAndExit "Spicetify installation verification failed: executable not found after installation"
    }
    
    $installedVersion = Get-SpicetifyVersion
    if (-not $installedVersion) {
        Write-ErrorAndExit "Spicetify installation verification failed: could not get version"
    }
    
    Write-Log "Spicetify verified: $installedVersion"
}
#endregion Spicetify Installation

#region Tagify Installation
function Download-TagifyRelease {
    [CmdletBinding()]
    param([string]$DownloadUrl)
    
    Write-Log "Downloading Tagify..." -ForegroundColor DarkMagenta
    Show-Notification "Tagify Installer" "Downloading Tagify..."
    
    $tempDir = "$env:TEMP\tagify-download-$PID"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    
    $zipPath = "$tempDir\tagify.zip"
    
    try {
        Write-Log "Download URL: $DownloadUrl"
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $zipPath -UseBasicParsing
        
        if (-not (Test-Path $zipPath) -or (Get-Item $zipPath).Length -eq 0) {
            Write-ErrorAndExit "Downloaded file is missing or empty"
        }
        
        $fileSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
        Write-Log "Downloaded tagify.zip ($fileSize MB)"
        
        Write-Log "Extracting archive..."
        Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force
        Remove-Item $zipPath -Force
        Write-Log "Archive extracted"

        return $tempDir;
    }
    catch {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-ErrorAndExit "Failed to download Tagify: $_"
    }
}

function Install-TagifyFiles {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$TempDir
    )

    Write-Log "Installing Tagify files..." -ForegroundColor DarkMagenta
    
    $customAppsDir = "$env:USERPROFILE\AppData\Roaming\spicetify\CustomApps"
    $tagifyDir = "$customAppsDir\tagify"
    
    # Create CustomApps directory
    New-Item -ItemType Directory -Path $customAppsDir -Force | Out-Null
    
    # Remove old installation
    if (Test-Path $tagifyDir) {
        Write-Log "Removing previous Tagify installation..."
        Remove-Item -Path $tagifyDir -Recurse -Force
    }
    
    # Find and move extracted files
    $extractedFolder = Get-ChildItem $TempDir -Directory | Where-Object { $_.Name -eq "tagify" } | Select-Object -First 1
    
    if ($extractedFolder) {
        Move-Item -Path $extractedFolder.FullName -Destination $tagifyDir -Force
    }
    else {
        # Try any directory (excluding __MACOSX)
        $extractedFolder = Get-ChildItem $TempDir -Directory | Where-Object { $_.Name -ne "__MACOSX" } | Select-Object -First 1
        
        if ($extractedFolder) {
            Move-Item -Path $extractedFolder.FullName -Destination $tagifyDir -Force
        }
        else {
            # Copy files directly
            $files = Get-ChildItem $TempDir -File -Recurse | Where-Object { $_.FullName -notlike "*__MACOSX*" }
            if ($files.Count -gt 0) {
                New-Item -ItemType Directory -Path $tagifyDir -Force | Out-Null
                Copy-Item -Path "$TempDir\*" -Destination $tagifyDir -Recurse -Force
            }
            else {
                Write-ErrorAndExit "No files found in downloaded archive"
            }
        }
    }
    
    # Cleanup temp
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    
    # Verify installation
    if (-not (Test-Path $tagifyDir)) {
        Write-ErrorAndExit "Tagify directory not found after installation"
    }
    
    $installedFileCount = (Get-ChildItem $tagifyDir -File -Recurse).Count
    if ($installedFileCount -eq 0) {
        Write-ErrorAndExit "Tagify directory is empty after installation"
    }
    
    Write-Log "Tagify files installed: $installedFileCount files"
    return $tagifyDir
}

function Set-SpicetifyTagifyConfiguration {
    Write-Log "Configuring Spicetify for Tagify..." -ForegroundColor DarkMagenta
    
    try {
        $spicetifyExe = Get-SpicetifyPath
        $configFile = Get-SpicetifyConfigPath

        # If no config file exists, initialize Spicetify first
        if (-not $configFile) {
            Write-Log "No Spicetify config found, applying Spicetify configuration..."
            Apply-SpicetifyConfiguration
    
            # Get config path again after initialization
            $configFile = Get-SpicetifyConfigPath
            if (-not $configFile) {
                Write-ErrorAndExit "Spicetify config still not found after initialization."
            }
        }
        
        # Check if Tagify is already configured
        if (Test-Path $configFile) {
            $configContent = Get-Content $configFile -Raw
            if ($configContent -match "custom_apps.*tagify") {
                Write-Log "Tagify already in config"
                return
            }
        }
        
        # Add Tagify to custom apps
        & $spicetifyExe config custom_apps tagify 2>&1 | ForEach-Object { Write-Log $_ }
        Write-Log "Tagify added to Spicetify config"
    }
    catch {
        Write-ErrorAndExit "Failed to configure Spicetify for Tagify: $_"
    }
}

function Install-Tagify {
    [CmdletBinding()]
    param([string]$DownloadUrl)
    
    Write-Log "==========================================" -ForegroundColor Magenta
    Write-Log "INSTALLING TAGIFY" -ForegroundColor Magenta
    Write-Log "==========================================" -ForegroundColor Magenta
    
    $tempDir = Download-TagifyRelease -DownloadUrl $DownloadUrl
    $tagifyDir = Install-TagifyFiles -TempDir $tempDir
    Set-SpicetifyTagifyConfiguration
    
    Write-Log "Tagify installation completed at: $tagifyDir"
}
#endregion Tagify Installation

#region System Control
function Stop-SpotifyProcess {
    Write-Log "Managing Spotify process..." -ForegroundColor DarkMagenta
    
    $spotifyProcesses = Get-Process -Name "Spotify" -ErrorAction SilentlyContinue
    
    if ($spotifyProcesses) {
        Write-Log "Stopping Spotify ($($spotifyProcesses.Count)) processes..."
        Show-Notification "Tagify Installer" "Stopping Spotify..."
        
        $spotifyProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
        
        # Wait for termination
        $count = 0
        while ((Get-Process -Name "Spotify" -ErrorAction SilentlyContinue) -and $count -lt 20) {
            Start-Sleep -Milliseconds 500
            $count++
        }
        
        # Force kill if still running
        Get-Process -Name "Spotify" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        
        Write-Log "Spotify stopped"
    }
    else {
        Write-Log "Spotify is not running"
    }
}

function Apply-SpicetifyConfiguration {
    param(
        [Parameter(Mandatory = $false)]
        [bool]$ForceRestore = $false
    )
    
    Write-Log "Applying Spicetify patches..." -ForegroundColor Cyan
    
    $spicetifyExe = Get-SpicetifyPath
    
    # If this is after a Spicetify update, always do full 'spicetify restore backup apply'
    if ($ForceRestore) {
        Write-Log "Running: spicetify restore backup apply (post-update)"
        & $spicetifyExe restore backup apply
        
        if ($LASTEXITCODE -ne 0) {
            Write-ErrorAndExit "Spicetify restore backup apply failed with exit code: $LASTEXITCODE"
        }
        
        Write-Log "Spicetify restore backup apply successful"
        return
    }
    
    # Try simple apply first
    Write-Log "Running: spicetify apply"
    $applyOutput = & $spicetifyExe apply 2>&1 | Out-String
    
    if ($LASTEXITCODE -eq 0) {
        Write-Log "Spicetify apply successful"
        return
    }
    
    # Check for the specific error about outdated preprocessed data
    # matches error code from https://github.com/spicetify/cli/blob/main/src/cmd/apply.go
    if ($applyOutput -match 'Preprocessed\s+Spotify\s+data\s+is\s+outdated' -or 
        $applyOutput -match 'Please run\s+"spicetify\s+restore\s+backup\s+apply"') {
        
        Write-Log "Preprocessed data is outdated (detected from error message)" -ForegroundColor Yellow
        Write-Log "Running: spicetify restore backup apply"
        & $spicetifyExe restore backup apply
        
        if ($LASTEXITCODE -ne 0) {
            Write-ErrorAndExit "Spicetify restore backup apply failed with exit code: $LASTEXITCODE"
        }
        
        Write-Log "Spicetify restore backup apply successful"
        return
    }
    
    # Generic fallback for other apply failures
    Write-Log "Apply failed with different error, attempting: spicetify backup apply" -ForegroundColor Yellow
    & $spicetifyExe backup apply
    
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorAndExit "Spicetify backup apply failed with exit code: $LASTEXITCODE"
    }
    
    Write-Log "Spicetify backup apply successful"
}
#endregion System Control

#region Verification
function Test-FinalInstallation {
    Write-Log "==========================================" -ForegroundColor Magenta
    Write-Log "VERIFYING INSTALLATION" -ForegroundColor Magenta
    Write-Log "==========================================" -ForegroundColor Magenta
    
    # Check Tagify installation
    $tagifyVersion = Get-InstalledTagifyVersion
    if ($tagifyVersion) {
        Write-Log "Tagify v$tagifyVersion installed"
    }
    else {
        Write-Log "Tagify verification failed"
        return $false
    }

    # Check config
    $configFile = Get-SpicetifyConfigPath
    if (Test-Path $configFile) {
        $configContent = Get-Content $configFile -Raw
        if ($configContent -match "tagify") {
            Write-Log "Tagify found in Spicetify config"
        }
        else {
            Write-Log "Tagify not found in config"
        }
    }
    
    return $true
}
#endregion Verification

#region Main
function Main {
    [CmdletBinding()]
    param()

    Initialize-Logging
    Write-Log "Starting Tagify Installer..." -ForegroundColor DarkMagenta
    
    try {
        Test-Prerequisites
        
        # Analyze system state
        $systemState = Get-SystemState
        
        # Get required actions
        $requiredOperations = Get-RequiredOperations -SystemState $systemState
        Write-Log "Operations after sorting:"
        foreach ($op in $requiredOperations) {
            Write-Log "  Priority: $($op.Priority) - $($op.Description)"
        }

        if ($requiredOperations.Count -eq 0) {
            Write-Log "System is already up to date"
            Finalize-Log 0
            return
        }

        Write-Log "Planning to execute $($requiredOperations.Count) operations:" -ForegroundColor Yellow
        foreach ($op in $requiredOperations) {
            Write-Log " - $($op.Description)" -ForegroundColor Yellow
        }

        Stop-SpotifyProcess

        # Execute actions
        $executionResult = Execute-Operations -Operations $requiredOperations -SystemState $systemState
        
        # Apply Spicetify patches - only if not already applied
        # if (-not $executionResult.AppliedSpicetify) {
        #     Apply-SpicetifyConfiguration
        # }

        Apply-SpicetifyConfiguration
        
        # Final verification
        $verificationPassed = Test-FinalInstallation
        if (-not $verificationPassed) {
            Write-ErrorAndExit "Installation verification failed. Tagify may not be properly installed."
        }
        
        Write-Log "==========================================" -ForegroundColor Green
        Write-Log "OPERATION COMPLETED SUCCESSFULLY!" -ForegroundColor Green
        Write-Log "Action: $($systemState.RecommendedAction)" -ForegroundColor Green
        Write-Log "Tagify Version: v$($systemState.LatestTagifyVersion)" -ForegroundColor Green
        Write-Log "==========================================" -ForegroundColor Green
        
        $successMessage = switch ($systemState.RecommendedAction) {
            "FullInstall" { "Tagify installed successfully! Restart Spotify to use it." }
            "RepairAndUpdate" { "Spicetify repaired and Tagify updated! Restart Spotify." }
            "InstallTagify" { "Tagify installed! Restart Spotify to use it." }
            "UpdateTagify" { "Tagify updated to v$($systemState.LatestTagifyVersion)! Restart Spotify." }
            "ReinstallTagify" { "Tagify reinstalled successfully! Restart Spotify." }
            default { "Installation completed! Restart Spotify to use Tagify." }
        }
        
        Show-Notification "Tagify Installer - Success" $successMessage
        Finalize-Log 0
    }
    catch {
        Write-Log "Operation failed: $_"
        Write-Log "==========================================" -ForegroundColor Red
        Write-Log "TROUBLESHOOTING INFO:" -ForegroundColor Red
        Write-Log "- Log file: $script:USER_LOG" -ForegroundColor Red
        Write-Log "- Try running as administrator if issues persist" -ForegroundColor Red
        Write-Log "- Ensure Spotify is completely closed before running" -ForegroundColor Red
        Write-Log "==========================================" -ForegroundColor Red
        
        Finalize-Log 1
    }
    finally {
        Cleanup-TempFiles
    }
}
#endregion Main

Main
