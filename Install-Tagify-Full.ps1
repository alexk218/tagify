<#
.SYNOPSIS
    Tagify Installer for Windows - Full installation of Spicetify & Tagify

.VERSION
    1.0.27

.DESCRIPTION
    Automates installation and updates for Spicetify CLI and Tagify custom app.
#>

$SCRIPT_VERSION = "1.0.27"

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

#region Variables
$REPO_OWNER = "alexk218"
$REPO_NAME = "tagify"
$script:LOG_DIR = ""
$script:LOG_FILE = ""
$script:USER_LOG = ""
$script:INSTALLATION_FAILED = $false
$script:INSTALLATION_ACTION = "Unknown"
$script:INSTALL_START_TIME = $null
$spicetifyFolderPath = "$env:LOCALAPPDATA\spicetify"
$spicetifyOldFolderPath = "$HOME\spicetify-cli"

# Status code for C# host to read
$global:TAGIFY_INSTALL_EXIT_CODE = 0
$global:TAGIFY_INSTALL_ERROR_MESSAGE = ""

# Installer version - passed from C#
$INSTALLER_VERSION = if ($env:TAGIFY_INSTALLER_VERSION) { $env:TAGIFY_INSTALLER_VERSION } else { "Unknown" }
#endregion Variables

#region Logging
function Initialize-Logging {
    # Use centralized log directory
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $script:LOG_DIR = "$env:LOCALAPPDATA\Tagify\Logs"
    $script:LOG_FILE = "$script:LOG_DIR\install_$timestamp.log"

    if (-not (Test-Path $script:LOG_DIR)) {
        New-Item -ItemType Directory -Path $script:LOG_DIR -Force | Out-Null
    }
    
    $script:INSTALL_START_TIME = Get-Date
    
    "==========================================" | Out-File -FilePath $script:LOG_FILE -Encoding UTF8
    "Tagify Installer Diagnostic Log" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    "==========================================" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    "" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    
    "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    "" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    
    "APPLICATION VERSIONS:" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    "  Installer Version: $INSTALLER_VERSION" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    "  Script Version: $SCRIPT_VERSION" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    "" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    
    "SYSTEM INFORMATION:" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
        if ($os) {
            "  OS: $($os.Caption) (Build $($os.BuildNumber))" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            "  OS Version: $($os.Version)" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            
            # Calculate available disk space
            $systemDrive = $env:SystemDrive
            $disk = Get-PSDrive -Name $systemDrive.TrimEnd(':') -ErrorAction SilentlyContinue
            if ($disk) {
                $freeGB = [math]::Round($disk.Free / 1GB, 2)
                "  Available Disk Space: $freeGB GB" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            }
        }
    }
    catch {
        "  OS: Unknown (Error: $_)" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    }
    
    "  PowerShell Version: $($PSVersionTable.PSVersion)" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    "  Architecture: $env:PROCESSOR_ARCHITECTURE" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    
    try {
        $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
        $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        "  Running as Administrator: $isAdmin" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    }
    catch {
        "  User Context: Unknown" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    }
    "" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    
    "SPOTIFY INFORMATION:" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    try {
        $spotifyVersion = Get-SpotifyVersion
        "  Spotify Version: $spotifyVersion" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        
        $spotifyPath = "$env:APPDATA\Spotify"
        if (Test-Path $spotifyPath) {
            "  Spotify Path: $spotifyPath" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            "  Spotify Installed: Yes" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        }
        else {
            "  Spotify Installed: No" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        }
    }
    catch {
        "  Spotify Version: Error detecting ($_)" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    }
    "" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    
    "SPICETIFY INFORMATION:" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    try {
        $spicetifyExe = Get-SpicetifyPath
        if ($spicetifyExe) {
            $currentSpicetifyVersion = Get-SpicetifyVersion
            "  Current Version: $currentSpicetifyVersion" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            "  Executable Path: $spicetifyExe" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            
            $configPath = Get-SpicetifyConfigPath
            if ($configPath -and (Test-Path $configPath)) {
                "  Config Found: Yes ($configPath)" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            }
            else {
                "  Config Found: No" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            }
        }
        else {
            "  Current Version: Not installed" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        }
        
        # Get latest available version
        try {
            $latestSpicetifyRelease = Invoke-RestMethod -Uri 'https://api.github.com/repos/spicetify/cli/releases/latest' -TimeoutSec 5
            $latestSpicetifyVersion = $latestSpicetifyRelease.tag_name -replace 'v', ''
            "  Latest Version: $latestSpicetifyVersion" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        }
        catch {
            "  Latest Version: Unable to fetch" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        }
    }
    catch {
        "  Spicetify: Error detecting ($_)" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    }
    "" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    
    "TAGIFY INFORMATION:" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    try {
        $currentTagifyVersion = Get-InstalledTagifyVersion
        if ($currentTagifyVersion) {
            "  Current Version: $currentTagifyVersion" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        }
        else {
            "  Current Version: Not installed" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        }
        
        # Get latest available version
        $latestTagifyInfo = Get-LatestTagifyVersion
        if ($latestTagifyInfo.Success) {
            "  Latest Version: $($latestTagifyInfo.Version)" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        }
        else {
            "  Latest Version: Unable to fetch" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        }
    }
    catch {
        "  Tagify: Error detecting ($_)" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    }
    "" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    
    "NETWORK CONNECTIVITY:" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    try {
        $githubTest = Test-Connection -ComputerName "api.github.com" -Count 1 -Quiet -ErrorAction SilentlyContinue
        "  GitHub API: $(if ($githubTest) { 'Reachable' } else { 'Unreachable' })" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    }
    catch {
        "  GitHub API: Unknown" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    }
    "" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    
    "INSTALLATION HISTORY:" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    try {
        $existingLogs = Get-ChildItem $script:LOG_DIR -Filter "install_*.log" -ErrorAction SilentlyContinue | 
        Sort-Object CreationTime -Descending
        
        if ($existingLogs.Count -gt 0) {
            "  Previous Installations: $($existingLogs.Count) log file(s) found" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            
            # Check for recent failures
            $recentLogs = $existingLogs | Select-Object -First 5
            $failureCount = 0
            foreach ($log in $recentLogs) {
                $content = Get-Content $log.FullName -Raw -ErrorAction SilentlyContinue
                if ($content -and $content -match "RESULT: FAILED") {
                    $failureCount++
                }
            }
            
            if ($failureCount -gt 0) {
                "  Recent Failures: $failureCount of last $($recentLogs.Count) attempts failed" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            }
            else {
                "  Recent Failures: None" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            }
        }
        else {
            "  Previous Installations: None (first installation)" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        }
    }
    catch {
        "  Installation History: Unable to read" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    }
    "" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    
    "==========================================" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    "INSTALLATION LOG:" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    "==========================================" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    "" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    
    Cleanup-OldLogs
}

function Cleanup-OldLogs {
    try {
        $maxLogs = 10
        $logs = Get-ChildItem $script:LOG_DIR -Filter "install_*.log" -ErrorAction SilentlyContinue | 
        Sort-Object CreationTime -Descending
        
        if ($logs.Count -gt $maxLogs) {
            $logsToRemove = $logs | Select-Object -Skip $maxLogs
            foreach ($log in $logsToRemove) {
                Remove-Item -Path $log.FullName -Force -ErrorAction SilentlyContinue
            }
            Write-Log "Cleaned up $($logsToRemove.Count) old log file(s)" -ForegroundColor DarkGray
        }
    }
    catch {
        # Silently fail - don't break installation over log cleanup
        Write-Log "Could not clean up old logs: $_" -ForegroundColor DarkGray
    }
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
    $global:TAGIFY_INSTALL_EXIT_CODE = 1
    $global:TAGIFY_INSTALL_ERROR_MESSAGE = $Message
    
    Write-Log "ERROR: $Message" -ForegroundColor Red
    Write-Log "==========================================" -ForegroundColor Red
    Write-Log "Operation failed! See error above." -ForegroundColor Red
    Write-Log "==========================================" -ForegroundColor Red
    
    Show-Notification "Tagify Installer - Error" "Error: $Message"
    
    Finalize-Log 1
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

function Write-UserProgress {
    param([string]$Message)
    # Send to Information stream (captured by C#)
    Write-Information "PROGRESS: $Message" -InformationAction Continue
    
    # Also log to file
    Write-Log $Message -ForegroundColor Cyan
}

function Finalize-Log {
    param([int]$ExitCode = 0)
    
    Write-Log "Finalizing log file..." -ForegroundColor DarkMagenta
    
    # Calculate installation duration
    if ($script:INSTALL_START_TIME) {
        $duration = (Get-Date) - $script:INSTALL_START_TIME
        $durationText = "{0:mm}m {0:ss}s" -f $duration
    }
    else {
        $durationText = "Unknown"
    }
    
    try {
        "" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        "==========================================" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        "INSTALLATION SUMMARY:" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        "==========================================" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        
        if ($ExitCode -eq 0 -and -not $script:INSTALLATION_FAILED) {
            "RESULT: SUCCESS" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            "Duration: $durationText" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            "Completed: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            "" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            "Operation completed successfully." | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            $global:TAGIFY_INSTALL_EXIT_CODE = 0
            $global:TAGIFY_INSTALL_ERROR_MESSAGE = ""
        }
        else {
            "RESULT: FAILED" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            "Duration: $durationText" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            "Failed at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            
            if ($global:TAGIFY_INSTALL_ERROR_MESSAGE) {
                "" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
                "Error: $global:TAGIFY_INSTALL_ERROR_MESSAGE" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            }
            
            "" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            "Operation FAILED. See errors above." | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
            $global:TAGIFY_INSTALL_EXIT_CODE = 1
            
            if ([string]::IsNullOrEmpty($global:TAGIFY_INSTALL_ERROR_MESSAGE)) {
                $global:TAGIFY_INSTALL_ERROR_MESSAGE = "Installation failed. Check log for details."
            }
        }
        
        "==========================================" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        "Log file: $script:LOG_FILE" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        "==========================================" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
        
        Write-Log "Log file saved to: $script:LOG_FILE" -ForegroundColor Cyan
        Write-Log "Installation duration: $durationText" -ForegroundColor Cyan
    }
    catch {
        Write-Log "Could not finalize log: $_" -ForegroundColor Red
        $global:TAGIFY_INSTALL_EXIT_CODE = 1
        $global:TAGIFY_INSTALL_ERROR_MESSAGE = "Log file finalization failed: $_"
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
function Test-Paths {
    Write-Log "=== DIAGNOSTIC TEST START ===" -ForegroundColor Cyan
    Write-Log "Testing basic path operations..."
    
    try {
        $testPath1 = "$env:LOCALAPPDATA\test"
        Write-Log "Test path 1: $testPath1"
        
        $testPath2 = Join-Path $env:USERPROFILE "test"
        Write-Log "Test path 2: $testPath2"
        
        $testPath3 = [System.IO.Path]::Combine($env:APPDATA, "test")
        Write-Log "Test path 3: $testPath3"
        
        Write-Log "All path tests passed" -ForegroundColor Green
    }
    catch {
        Write-Log "Path test FAILED: $_" -ForegroundColor Red
        Write-Log "This indicates environment variables are not accessible in PowerShell context"
        Write-ErrorAndExit "Environment configuration error: $_"
    }
    Write-Log "=== DIAGNOSTIC TEST END ===" -ForegroundColor Cyan
}

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

#region Version Management
function Get-SpotifyVersion {
    try {
        # Method 1: Check Spotify.exe file version
        $spotifyExePath = "$env:APPDATA\Spotify\Spotify.exe"
        
        if (Test-Path $spotifyExePath) {
            $versionInfo = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($spotifyExePath)
            if ($versionInfo.FileVersion) {
                return $versionInfo.FileVersion
            }
        }
        
        # Method 2: Check prefs file
        $prefsPath = "$env:APPDATA\Spotify\prefs"
        if (Test-Path $prefsPath) {
            $prefs = Get-Content $prefsPath -Raw
            if ($prefs -match 'app\.last-launched-version="([\d.]+)') {
                # $matches[0] = entire match => app.last-launched-version="1.2.3.456"
                # $matches[1] = 1st capture group => 1.2.3.456
                return $matches[1]
            }
        }
        
        return "Unknown"
    }
    catch {
        return "Error: $_"
    }
}

function Get-InstalledTagifyVersion {
    $tagifyPath = "$env:USERPROFILE\AppData\Roaming\spicetify\CustomApps\tagify"
    $packagePath = "$tagifyPath\package.json"

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
        TagifyInstalled       = $currentTagify -ne $null
        TagifyVersion         = $currentTagify
        LatestTagifyVersion   = $latestTagifyInfo.Version
        TagifyUpdateAvailable = Test-TagifyUpdateAvailable -CurrentVersion $currentTagify -LatestVersion $latestTagifyInfo.Version
        TagifyDownloadUrl     = $latestTagifyInfo.DownloadUrl
        SpicetifyState        = $spicetifyState
    }
    
    Write-Log "Current State Analysis:"
    Write-Log "- Tagify Installed: $($systemState.TagifyInstalled) (v$($currentTagify))" -ForegroundColor $(if ($systemState.TagifyInstalled) { 'Green' } else { 'Red' })
    Write-Log "- Latest Tagify: v$($latestTagifyInfo.Version)"
    Write-Log "- Tagify Update Available: $($systemState.TagifyUpdateAvailable)" -ForegroundColor $(if ($systemState.TagifyUpdateAvailable) { 'Yellow' } else { 'Green' })
    Write-Log "- Spicetify Installed: $($spicetifyState.IsInstalled)" -ForegroundColor $(if ($spicetifyState.IsInstalled) { 'Green' } else { 'Red' })

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

    Write-UserProgress "Downloading Spicetify..."
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
        Write-UserProgress "Downloading Spicetify v$targetVersion..."
        Write-Log "Latest Spicetify version: v$targetVersion"
        
        $archivePath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "spicetify.zip")
        
        Write-Log "Downloading Spicetify v$targetVersion..."
        $downloadUrl = "https://github.com/spicetify/cli/releases/download/v$targetVersion/spicetify-$targetVersion-windows-$architecture.zip"
        Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing
        Write-Log "Downloaded Spicetify"
        
        Write-UserProgress "Extracting Spicetify..."
        Write-Log 'Extracting Spicetify...'
        if (Test-Path $spicetifyFolderPath) {
            Remove-Item -Path $spicetifyFolderPath -Recurse -Force
        }
        New-Item -ItemType Directory -Path $spicetifyFolderPath -Force | Out-Null
        Expand-Archive -Path $archivePath -DestinationPath $spicetifyFolderPath -Force
        Write-Log "Extracted Spicetify"
        
        # Add to PATH
        Write-UserProgress "Configuring Spicetify..."
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
        Write-UserProgress "Spicetify installed successfully"
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
    
    Write-UserProgress "Installing Spicetify..."
    Write-Log "Installing Spicetify..."
    Show-Notification "Tagify Installer" "Installing Spicetify..."
    
    # Create directory if needed
    if (-not (Test-Path $spicetifyFolderPath)) {
        New-Item -ItemType Directory -Path $spicetifyFolderPath -Force | Out-Null
    }
    
    Move-OldSpicetifyFolder
    Install-SpicetifyCore
    
    # Verify installation
    Write-UserProgress "Verifying Spicetify installation..."
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
    
    Write-UserProgress "Downloading Tagify..."
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
        
        Write-UserProgress "Extracting Tagify..."
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

    Write-UserProgress "Installing Tagify files..."
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
    Write-UserProgress "Configuring Tagify..."
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
    
    Write-UserProgress "Installing Tagify..."
    Write-Log "==========================================" -ForegroundColor Magenta
    Write-Log "INSTALLING TAGIFY" -ForegroundColor Magenta
    Write-Log "==========================================" -ForegroundColor Magenta
    
    $tempDir = Download-TagifyRelease -DownloadUrl $DownloadUrl
    $tagifyDir = Install-TagifyFiles -TempDir $tempDir
    Set-SpicetifyTagifyConfiguration
    
    Write-UserProgress "Tagify installed successfully"
    Write-Log "Tagify installation completed at: $tagifyDir"
}
#endregion Tagify Installation

#region System Control
function Stop-SpotifyProcess {
    Write-UserProgress "Stopping Spotify..."
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

function Invoke-Spicetify {
    <#
    .SYNOPSIS
        Safely invokes spicetify.exe and captures output without throwing RemoteException
    .PARAMETER Arguments
        Arguments to pass to spicetify.exe
    .RETURNS
        Hashtable with ExitCode, Output, and Error properties
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Arguments
    )
    
    $spicetifyExe = Get-SpicetifyPath
    if (-not $spicetifyExe) {
        return @{
            ExitCode = 1
            Output   = ""
            Error    = "Spicetify executable not found"
            Success  = $false
        }
    }
    
    Write-Log "Running: spicetify $Arguments"
    
    try {
        # Use Start-Process for cleaner output capture
        $tempOutput = [System.IO.Path]::GetTempFileName()
        $tempError = [System.IO.Path]::GetTempFileName()
        
        $processInfo = New-Object System.Diagnostics.ProcessStartInfo
        $processInfo.FileName = $spicetifyExe
        $processInfo.Arguments = $Arguments
        $processInfo.RedirectStandardOutput = $true
        $processInfo.RedirectStandardError = $true
        $processInfo.UseShellExecute = $false
        $processInfo.CreateNoWindow = $true
        $processInfo.WorkingDirectory = Split-Path $spicetifyExe -Parent
        
        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $processInfo
        
        # Capture output asynchronously to avoid deadlocks
        $outputBuilder = New-Object System.Text.StringBuilder
        $errorBuilder = New-Object System.Text.StringBuilder
        
        $outputEvent = Register-ObjectEvent -InputObject $process -EventName OutputDataReceived -Action {
            if ($EventArgs.Data) {
                $Event.MessageData.AppendLine($EventArgs.Data) | Out-Null
            }
        } -MessageData $outputBuilder
        
        $errorEvent = Register-ObjectEvent -InputObject $process -EventName ErrorDataReceived -Action {
            if ($EventArgs.Data) {
                $Event.MessageData.AppendLine($EventArgs.Data) | Out-Null
            }
        } -MessageData $errorBuilder
        
        $process.Start() | Out-Null
        $process.BeginOutputReadLine()
        $process.BeginErrorReadLine()
        
        # Wait with timeout (2 minutes should be plenty for spicetify)
        $completed = $process.WaitForExit(120000)
        
        # Clean up event handlers
        Unregister-Event -SourceIdentifier $outputEvent.Name -ErrorAction SilentlyContinue
        Unregister-Event -SourceIdentifier $errorEvent.Name -ErrorAction SilentlyContinue
        
        if (-not $completed) {
            $process.Kill()
            return @{
                ExitCode = -1
                Output   = $outputBuilder.ToString()
                Error    = "Process timed out after 2 minutes"
                Success  = $false
            }
        }
        
        $exitCode = $process.ExitCode
        $output = $outputBuilder.ToString()
        $errorOutput = $errorBuilder.ToString()
        
        # Log output for debugging
        if ($output) {
            Write-Log "Spicetify output: $($output.Substring(0, [Math]::Min(200, $output.Length)))..."
        }
        if ($errorOutput) {
            Write-Log "Spicetify stderr: $($errorOutput.Substring(0, [Math]::Min(200, $errorOutput.Length)))..."
        }
        
        return @{
            ExitCode = $exitCode
            Output   = $output
            Error    = $errorOutput
            Success  = ($exitCode -eq 0)
        }
    }
    catch {
        Write-Log "Exception running spicetify: $_" -ForegroundColor Red
        return @{
            ExitCode = -1
            Output   = ""
            Error    = $_.Exception.Message
            Success  = $false
        }
    }
    finally {
        # Cleanup temp files
        Remove-Item $tempOutput -Force -ErrorAction SilentlyContinue
        Remove-Item $tempError -Force -ErrorAction SilentlyContinue
    }
}

function Apply-SpicetifyConfiguration {
    param(
        [Parameter(Mandatory = $false)]
        [bool]$ForceRestore = $false
    )
    
    Write-UserProgress "Applying Spicetify patches..."
    Write-Log "Applying Spicetify patches..." -ForegroundColor Cyan
    
    # If this is after a Spicetify update, always do full 'spicetify restore backup apply'
    if ($ForceRestore) {
        Write-UserProgress "Updating Spicetify patches..."
        Write-Log "Running: spicetify restore backup apply (post-update)"
        
        $result = Invoke-Spicetify -Arguments "restore backup apply"
        
        if (-not $result.Success) {
            # Check if it's a "no backup" error which we can work around
            if ($result.Error -match "no backup" -or $result.Output -match "no backup") {
                Write-Log "No backup found, running backup apply instead..." -ForegroundColor Yellow
                $result = Invoke-Spicetify -Arguments "backup apply"
            }
            
            if (-not $result.Success) {
                Write-ErrorAndExit "Spicetify restore backup apply failed: $($result.Error)"
            }
        }
        
        Write-UserProgress "Spicetify patches updated"
        Write-Log "Spicetify restore backup apply successful"
        return
    }
    
    # Try simple apply first
    $result = Invoke-Spicetify -Arguments "apply"
    
    if ($result.Success) {
        Write-UserProgress "Spicetify patches applied successfully"
        Write-Log "Spicetify apply successful"
        return
    }
    
    # Combine output and error for pattern matching
    $combinedOutput = "$($result.Output)`n$($result.Error)"
    
    # Check for the specific error about outdated preprocessed data
    if ($combinedOutput -match 'Preprocessed\s+Spotify\s+data\s+is\s+outdated' -or 
        $combinedOutput -match 'Please run\s+"spicetify\s+restore\s+backup\s+apply"' -or
        $combinedOutput -match 'spotify is outdated') {
        
        Write-UserProgress "Updating Spicetify patches..."
        Write-Log "Preprocessed data is outdated (detected from error message)" -ForegroundColor Yellow
        
        $result = Invoke-Spicetify -Arguments "restore backup apply"
        
        if (-not $result.Success) {
            Write-ErrorAndExit "Spicetify restore backup apply failed: $($result.Error)"
        }
        
        Write-UserProgress "Spicetify patches updated"
        Write-Log "Spicetify restore backup apply successful"
        return
    }
    
    # Check for backup-related errors
    if ($combinedOutput -match 'backup' -or $combinedOutput -match 'Backup') {
        Write-UserProgress "Repairing Spicetify configuration..."
        Write-Log "Apply failed with backup-related error, attempting: spicetify backup apply" -ForegroundColor Yellow
        
        $result = Invoke-Spicetify -Arguments "backup apply"
        
        if (-not $result.Success) {
            Write-ErrorAndExit "Spicetify backup apply failed: $($result.Error)"
        }
        
        Write-UserProgress "Spicetify configuration repaired"
        Write-Log "Spicetify backup apply successful"
        return
    }
    
    # Generic fallback for other apply failures - try backup apply
    Write-UserProgress "Repairing Spicetify configuration..."
    Write-Log "Apply failed with error: $($result.Error)" -ForegroundColor Yellow
    Write-Log "Attempting fallback: spicetify backup apply"
    
    $result = Invoke-Spicetify -Arguments "backup apply"
    
    if (-not $result.Success) {
        # Last resort - try just 'apply' one more time after a small delay
        Start-Sleep -Seconds 2
        $result = Invoke-Spicetify -Arguments "apply"
        
        if (-not $result.Success) {
            Write-ErrorAndExit "Spicetify apply failed after multiple attempts. Error: $($result.Error)"
        }
    }
    
    Write-UserProgress "Spicetify configuration applied"
    Write-Log "Spicetify apply successful (after fallback)"
}
#endregion System Control

#region Verification
function Test-FinalInstallation {
    Write-UserProgress "Verifying installation..."
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
    
    Write-UserProgress "Installation verified successfully"
    return $true
}
#endregion Verification

#region Main
function Main {
    [CmdletBinding()]
    param()

    Initialize-Logging
    Test-Paths

    Write-UserProgress "Starting Tagify installer..."
    Write-Log "Starting Tagify Installer..." -ForegroundColor DarkMagenta
    
    try {
        Write-UserProgress "Checking system requirements..."
        Test-Prerequisites
        
        Write-UserProgress "Analyzing installation state..."
        $systemState = Get-SystemState
        
        # Get required actions
        $requiredOperations = Get-RequiredOperations -SystemState $systemState
        Write-Log "Operations after sorting:"
        foreach ($op in $requiredOperations) {
            Write-Log "  Priority: $($op.Priority) - $($op.Description)"
        }

        if ($requiredOperations.Count -eq 0) {
            $script:INSTALLATION_ACTION = "None - System up to date"
            Write-Log "Installation Action: $script:INSTALLATION_ACTION" -ForegroundColor Cyan
            Write-UserProgress "Installation Action: $script:INSTALLATION_ACTION" -ForegroundColor Cyan
            Finalize-Log 0
            return
        }
        else {
            $actionDescriptions = ($requiredOperations | ForEach-Object { $_.Description }) -join ", "
            $script:INSTALLATION_ACTION = $actionDescriptions
            Write-Log "Installation Action: $script:INSTALLATION_ACTION" -ForegroundColor Cyan
            Write-UserProgress "Installation Action: $script:INSTALLATION_ACTION"
        }
        "" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8

        Write-UserProgress "Preparing to install components..."
        Write-Log "Planning to execute $($requiredOperations.Count) operations:" -ForegroundColor Yellow
        foreach ($op in $requiredOperations) {
            Write-Log " - $($op.Description)" -ForegroundColor Yellow
        }

        Write-UserProgress "Stopping Spotify..."
        Stop-SpotifyProcess

        # Execute actions
        Write-UserProgress "Installing components..."
        $executionResult = Execute-Operations -Operations $requiredOperations -SystemState $systemState
        
        # Apply Spicetify patches - only if not already applied
        # if (-not $executionResult.AppliedSpicetify) {
        #     Apply-SpicetifyConfiguration
        # }

        Write-UserProgress "Applying Spicetify configuration..."
        Apply-SpicetifyConfiguration
        
        # Final verification
        Write-UserProgress "Verifying installation..."
        $verificationPassed = Test-FinalInstallation
        if (-not $verificationPassed) {
            Write-ErrorAndExit "Installation verification failed. Tagify may not be properly installed."
        }

        # Build completion summary from what was actually executed
        $completedActions = if ($requiredOperations.Count -gt 0) {
            ($requiredOperations | ForEach-Object { $_.Description }) -join ", "
        }
        else {
            "No changes needed"
        }

        Write-Log "==========================================" -ForegroundColor Green
        Write-Log "OPERATION COMPLETED SUCCESSFULLY!" -ForegroundColor Green
        Write-Log "Actions Performed: $completedActions" -ForegroundColor Green
        Write-Log "Tagify Version: v$($systemState.LatestTagifyVersion)" -ForegroundColor Green
        Write-Log "==========================================" -ForegroundColor Green

        $successMessage = if ($requiredOperations.Count -gt 0) {
            "Installation completed! Restart Spotify to see changes."
        }
        else {
            "System is already up to date! Restart Spotify if changes haven't been applied."
        }
        
        Write-UserProgress "Installation completed successfully!"
        Show-Notification "Tagify Installer - Success" $successMessage
        Finalize-Log 0
    }
    catch {
        Write-Log "Operation failed: $_"
        Write-Log "==========================================" -ForegroundColor Red
        Write-Log "TROUBLESHOOTING INFO:" -ForegroundColor Red
        Write-Log "- Log file: $script:USER_LOG" -ForegroundColor Red
        Write-Log "==========================================" -ForegroundColor Red
        
        Write-UserProgress "Installation failed"
        Finalize-Log 1
    }
    finally {
        Cleanup-TempFiles
    }
}
#endregion Main

Main
