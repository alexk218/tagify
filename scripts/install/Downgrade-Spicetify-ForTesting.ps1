<#
.SYNOPSIS
    Downgrade Spicetify to a specific version for testing

.DESCRIPTION
    Downloads and installs an older version of Spicetify to test upgrade scenarios.
    Automatically detects system architecture and backs up current installation.

.PARAMETER Version
    Version to downgrade to (default: 2.42.3)

.PARAMETER SkipBackup
    Skip backing up current installation

.EXAMPLE
    .\Downgrade-Spicetify-ForTesting.ps1
    .\Downgrade-Spicetify-ForTesting.ps1 -Version "2.42.0"
    .\Downgrade-Spicetify-ForTesting.ps1 -SkipBackup
#>

param(
  [Parameter(Mandatory = $false)]
  [string]$Version = "2.42.3",
    
  [Parameter(Mandatory = $false)]
  [switch]$SkipBackup
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

#region Functions
function Write-ColorOutput {
  param(
    [string]$Message,
    [ConsoleColor]$Color = [ConsoleColor]::White
  )
  Write-Host $Message -ForegroundColor $Color
}

function Get-SystemArchitecture {
  $arch = $env:PROCESSOR_ARCHITECTURE
    
  switch ($arch) {
    "AMD64" { return "x64" }
    "ARM64" { return "arm64" }
    default { return "x32" }
  }
}

function Stop-SpotifyProcess {
  Write-ColorOutput "Checking for running Spotify processes..." -Color Cyan
    
  $spotifyProcesses = Get-Process -Name "Spotify" -ErrorAction SilentlyContinue
    
  if ($spotifyProcesses) {
    Write-ColorOutput "Stopping Spotify ($($spotifyProcesses.Count) processes)..." -Color Yellow
    $spotifyProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
        
    # Wait for termination
    $count = 0
    while ((Get-Process -Name "Spotify" -ErrorAction SilentlyContinue) -and $count -lt 20) {
      Start-Sleep -Milliseconds 500
      $count++
    }
        
    # Force kill if still running
    Get-Process -Name "Spotify" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        
    Write-ColorOutput "[OK] Spotify stopped" -Color Green
  }
  else {
    Write-ColorOutput "[OK] Spotify is not running" -Color Green
  }
}

function Backup-CurrentSpicetify {
  param([string]$SpicetifyFolder)
    
  if (-not (Test-Path $SpicetifyFolder)) {
    Write-ColorOutput "No existing Spicetify installation found - skipping backup" -Color Yellow
    return $null
  }
    
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupFolder = "$env:LOCALAPPDATA\spicetify-backup-$timestamp"
    
  Write-ColorOutput "Backing up current Spicetify installation..." -Color Cyan
    
  try {
    Copy-Item -Path $SpicetifyFolder -Destination $backupFolder -Recurse -Force
    Write-ColorOutput "[OK] Backed up to: $backupFolder" -Color Green
    return $backupFolder
  }
  catch {
    Write-ColorOutput "[WARNING] Backup failed: $_" -Color Yellow
    return $null
  }
}

function Get-CurrentSpicetifyVersion {
  $spicetifyExe = "$env:LOCALAPPDATA\spicetify\spicetify.exe"
    
  if (-not (Test-Path $spicetifyExe)) {
    return "Not installed"
  }
    
  try {
    $versionOutput = & $spicetifyExe -v 2>&1
    return ($versionOutput | Out-String).Trim()
  }
  catch {
    return "Unknown"
  }
}

function Download-SpicetifyVersion {
  param(
    [string]$Version,
    [string]$Architecture
  )
    
  Write-ColorOutput "Downloading Spicetify v$Version ($Architecture)..." -Color Cyan
    
  $downloadUrl = "https://github.com/spicetify/cli/releases/download/v$Version/spicetify-$Version-windows-$Architecture.zip"
  $tempZip = "$env:TEMP\spicetify-$Version-downgrade.zip"
    
  try {
    # Remove old temp file if exists
    if (Test-Path $tempZip) {
      Remove-Item -Path $tempZip -Force
    }
        
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempZip -UseBasicParsing
        
    if (-not (Test-Path $tempZip) -or (Get-Item $tempZip).Length -eq 0) {
      throw "Downloaded file is empty or missing"
    }
        
    $fileSize = [math]::Round((Get-Item $tempZip).Length / 1MB, 2)
    Write-ColorOutput "[OK] Downloaded $fileSize MB" -Color Green
        
    return $tempZip
  }
  catch {
    Write-ColorOutput "[ERROR] Download failed: $_" -Color Red
    throw
  }
}

function Install-SpicetifyFromZip {
  param(
    [string]$ZipPath,
    [string]$DestinationFolder
  )
    
  Write-ColorOutput "Installing Spicetify v$Version..." -Color Cyan
    
  $tempExtract = "$env:TEMP\spicetify-downgrade-extract"
    
  try {
    # Clean temp extraction folder
    if (Test-Path $tempExtract) {
      Remove-Item -Path $tempExtract -Recurse -Force
    }
        
    # Extract archive
    Expand-Archive -Path $ZipPath -DestinationPath $tempExtract -Force
        
    # Remove existing installation
    if (Test-Path $DestinationFolder) {
      Remove-Item -Path $DestinationFolder -Recurse -Force
    }
        
    # Create destination
    New-Item -ItemType Directory -Path $DestinationFolder -Force | Out-Null
        
    # Copy extracted files
    Copy-Item -Path "$tempExtract\*" -Destination $DestinationFolder -Recurse -Force
        
    # Clean up
    Remove-Item -Path $tempExtract -Recurse -Force
    Remove-Item -Path $ZipPath -Force
        
    Write-ColorOutput "[OK] Spicetify installed to: $DestinationFolder" -Color Green
  }
  catch {
    Write-ColorOutput "[ERROR] Installation failed: $_" -Color Red
    throw
  }
}

function Add-SpicetifyToPath {
  param([string]$SpicetifyFolder)
    
  Write-ColorOutput "Updating PATH environment variable..." -Color Cyan
    
  $user = [EnvironmentVariableTarget]::User
  $path = [Environment]::GetEnvironmentVariable('PATH', $user)
    
  # Remove old spicetify paths
  $path = $path -replace "$([regex]::Escape("$HOME\spicetify-cli"))\\*;*", ''
    
  # Add new path if not present
  if ($path -notlike "*$SpicetifyFolder*") {
    $path = "$path;$SpicetifyFolder"
  }
    
  [Environment]::SetEnvironmentVariable('PATH', $path, $user)
  $env:PATH = $path
    
  Write-ColorOutput "[OK] PATH updated" -Color Green
}

function Restore-SpicetifyBackupApply {
  Write-ColorOutput "`nApplying Spicetify to Spotify..." -Color Cyan
    
  $spicetifyExe = "$env:LOCALAPPDATA\spicetify\spicetify.exe"
    
  if (-not (Test-Path $spicetifyExe)) {
    Write-ColorOutput "[WARNING] Spicetify executable not found - skipping apply" -Color Yellow
    return
  }
    
  try {
    Write-ColorOutput "Running: spicetify restore backup apply" -Color Gray
    & $spicetifyExe restore backup apply
        
    if ($LASTEXITCODE -eq 0) {
      Write-ColorOutput "[OK] Spicetify applied successfully" -Color Green
    }
    else {
      Write-ColorOutput "[WARNING] Apply command exited with code: $LASTEXITCODE" -Color Yellow
      Write-ColorOutput "You may need to run 'spicetify restore backup apply' manually" -Color Yellow
    }
  }
  catch {
    Write-ColorOutput "[WARNING] Failed to apply Spicetify: $_" -Color Yellow
    Write-ColorOutput "You may need to run 'spicetify restore backup apply' manually" -Color Yellow
  }
}
#endregion Functions

#region Main
Write-ColorOutput "`n================================================" -Color Magenta
Write-ColorOutput "  SPICETIFY DOWNGRADE UTILITY" -Color Magenta
Write-ColorOutput "================================================`n" -Color Magenta

# Detect architecture
$architecture = Get-SystemArchitecture
Write-ColorOutput "System Architecture: $architecture" -Color Cyan

# Get current version
$currentVersion = Get-CurrentSpicetifyVersion
Write-ColorOutput "Current Spicetify: $currentVersion" -Color Cyan
Write-ColorOutput "Target Version: v$Version`n" -Color Cyan

# Confirm downgrade
Write-ColorOutput "This will downgrade Spicetify to v$Version" -Color Yellow
$confirmation = Read-Host "Continue? (Y/N)"

if ($confirmation -ne 'Y' -and $confirmation -ne 'y') {
  Write-ColorOutput "`nDowngrade cancelled" -Color Yellow
  exit 0
}

Write-ColorOutput "" # Empty line

try {
  # Stop Spotify
  Stop-SpotifyProcess
  Write-ColorOutput "" # Empty line
    
  # Backup current installation
  $backupFolder = $null
  if (-not $SkipBackup) {
    $spicetifyFolder = "$env:LOCALAPPDATA\spicetify"
    $backupFolder = Backup-CurrentSpicetify -SpicetifyFolder $spicetifyFolder
    Write-ColorOutput "" # Empty line
  }
    
  # Download old version
  $zipPath = Download-SpicetifyVersion -Version $Version -Architecture $architecture
  Write-ColorOutput "" # Empty line
    
  # Install old version
  $destinationFolder = "$env:LOCALAPPDATA\spicetify"
  Install-SpicetifyFromZip -ZipPath $zipPath -DestinationFolder $destinationFolder
  Write-ColorOutput "" # Empty line
    
  # Update PATH
  Add-SpicetifyToPath -SpicetifyFolder $destinationFolder
  Write-ColorOutput "" # Empty line
    
  # Verify installation
  Write-ColorOutput "Verifying installation..." -Color Cyan
  $installedVersion = Get-CurrentSpicetifyVersion
  Write-ColorOutput "Installed Version: $installedVersion" -Color Green
  Write-ColorOutput "" # Empty line
    
  # Apply Spicetify
  Restore-SpicetifyBackupApply
    
  # Summary
  Write-ColorOutput "`n================================================" -Color Green
  Write-ColorOutput "  DOWNGRADE COMPLETED SUCCESSFULLY!" -Color Green
  Write-ColorOutput "================================================" -Color Green
  Write-ColorOutput "`nSpicetify Version: $installedVersion" -Color White
    
  if ($backupFolder) {
    Write-ColorOutput "Backup Location: $backupFolder" -Color White
    Write-ColorOutput "`nTo restore your previous version:" -Color Yellow
    Write-ColorOutput "  1. Stop Spotify" -Color Gray
    Write-ColorOutput "  2. Copy contents of backup folder to:" -Color Gray
    Write-ColorOutput "     $destinationFolder" -Color Gray
  }
    
  Write-ColorOutput "`nYou can now test your Tagify installer!" -Color Cyan
  Write-ColorOutput "`nRestart PowerShell to refresh PATH, then run:" -Color Yellow
  Write-ColorOutput "  spicetify -v" -Color Gray
  Write-ColorOutput "" # Empty line
}
catch {
  Write-ColorOutput "`n================================================" -Color Red
  Write-ColorOutput "  DOWNGRADE FAILED" -Color Red
  Write-ColorOutput "================================================" -Color Red
  Write-ColorOutput "`nError: $_" -Color Red
    
  if ($backupFolder -and (Test-Path $backupFolder)) {
    Write-ColorOutput "`nYour previous installation was backed up to:" -Color Yellow
    Write-ColorOutput "  $backupFolder" -Color White
  }
    
  exit 1
}
#endregion Main