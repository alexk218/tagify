function Write-Success { param($Message) Write-Host "✅ $Message" -ForegroundColor Green }
function Write-Error { param($Message) Write-Host "❌ $Message" -ForegroundColor Red }
function Write-Info { param($Message) Write-Host "ℹ️  $Message" -ForegroundColor Cyan }
function Write-Warning { param($Message) Write-Host "⚠️  $Message" -ForegroundColor Yellow }

Write-Host @"
Tagify Auto-Installer
Transform your Spotify music organization
"@ -ForegroundColor Magenta

$homeDir = $env:USERPROFILE
$customAppsDir = "$homeDir\AppData\Roaming\spicetify\CustomApps"
$appName = "tagify"
$customAppDir = Join-Path $customAppsDir $appName
$tagifyStateDir = "$env:LOCALAPPDATA\Tagify"
$installRecoveryKeyFile = Join-Path $tagifyStateDir "install-recovery-key"
$tempDir = "$env:TEMP\tagify-install"
$zipFile = "$tempDir\tagify.zip"

$repoOwner = "alexk218"
$repoName = "tagify"

function Install-CommunityRecoveryBootstrap {
    if (!(Test-Path -Path $tagifyStateDir)) {
        New-Item -ItemType Directory -Path $tagifyStateDir -Force | Out-Null
    }

    $recoveryKey = $null
    if (Test-Path -Path $installRecoveryKeyFile) {
        $candidate = (Get-Content -Path $installRecoveryKeyFile -Raw).Trim()
        if ($candidate -match '^tgfy_install_[A-Za-z0-9_-]{43}$') {
            $recoveryKey = $candidate
        }
    }
    if (-not $recoveryKey) {
        $bytes = New-Object byte[] 32
        $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
        $encoded = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
        $recoveryKey = "tgfy_install_$encoded"
        [IO.File]::WriteAllText($installRecoveryKeyFile, "$recoveryKey`n", (New-Object Text.UTF8Encoding($false)))
    }

    $extensionPath = Join-Path $customAppDir "extension.js"
    if (!(Test-Path -Path $extensionPath)) {
        throw "Tagify extension.js is missing; automatic Community reconnection could not be installed."
    }
    $source = [IO.File]::ReadAllText($extensionPath)
    $bootstrap = "globalThis.__tagifyInstallRecoveryKey=`"$recoveryKey`";`n"
    [IO.File]::WriteAllText($extensionPath, $bootstrap + $source, (New-Object Text.UTF8Encoding($false)))
}

Write-Info "Starting Tagify installation..."

Write-Info "Checking for Spicetify installation..."
try {
    $spicetifyVersion = spicetify -v 2>$null
    if ($spicetifyVersion) {
        Write-Success "Spicetify found: $spicetifyVersion"
    }
}
catch {
    Write-Error "Spicetify not found! Please install Spicetify first:"
    Write-Host "https://spicetify.app/docs/getting-started" -ForegroundColor Yellow
    exit 1
}

Write-Info "Creating directories..."
if (!(Test-Path -Path $customAppsDir)) {
    New-Item -ItemType Directory -Path $customAppsDir -Force | Out-Null
    Write-Success "Created CustomApps directory"
}

if (!(Test-Path -Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
}

Write-Info "Fetching latest release information..."
$apiUrl = "https://api.github.com/repos/$repoOwner/$repoName/releases/latest"

try {
    $releaseInfo = Invoke-RestMethod -Uri $apiUrl -ErrorAction Stop
    $releaseVersion = $releaseInfo.tag_name

    # Find the main zip file (exclude source code archives)
    $mainAsset = $releaseInfo.assets | Where-Object { 
        $_.name -like "tagify*.zip" -and $_.name -notlike "*source*" 
    } | Select-Object -First 1

    if ($mainAsset) {
        $downloadUrl = $mainAsset.browser_download_url
        Write-Success "Found latest release: $releaseVersion ($($mainAsset.name))"
    }
    else {
        throw "No suitable zip file found in release"
    }
}
catch {
    Write-Warning "Could not fetch release info from GitHub API. Using direct download..."
    $downloadUrl = "https://github.com/$repoOwner/$repoName/releases/latest/download/tagify.zip"
    $releaseVersion = "latest"
}

Write-Info "Downloading Tagify $releaseVersion..."
try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipFile -ErrorAction Stop
    Write-Success "Download completed"
}
catch {
    Write-Error "Failed to download Tagify. Please check your internet connection."
    Write-Error "Download URL: $downloadUrl"
    exit 1
}

# Remove existing installation
if (Test-Path -Path $customAppDir) {
    Write-Warning "Existing Tagify installation found. Removing for clean install..."
    Remove-Item -Recurse -Force $customAppDir
    Write-Success "Removed existing installation"
}

Write-Info "Extracting files..."
try {
    Expand-Archive -Path $zipFile -DestinationPath $tempDir -Force

    # Find the extracted folder (might be nested)
    $extractedFolders = Get-ChildItem $tempDir -Directory
    if ($extractedFolders.Count -eq 1) {
        $sourceDir = $extractedFolders[0].FullName
    }
    else {
        $sourceDir = $tempDir
    }

    Move-Item -Path $sourceDir -Destination $customAppDir -Force
    Install-CommunityRecoveryBootstrap
    Write-Success "Files extracted successfully"
}
catch {
    Write-Error "Failed to extract files: $($_.Exception.Message)"
    exit 1
}

Write-Info "Configuring Spicetify..."
try {
    & spicetify config custom_apps $appName
    Write-Success "Added Tagify to Spicetify config"

    Write-Info "Applying Spicetify changes..."
    & spicetify apply
    Write-Success "Spicetify configuration applied"
}
catch {
    Write-Error "Failed to configure Spicetify: $($_.Exception.Message)"
    Write-Warning "You may need to run these commands manually:"
    Write-Host "  spicetify config custom_apps tagify" -ForegroundColor Yellow
    Write-Host "  spicetify apply" -ForegroundColor Yellow
    exit 1
}

# Clean up
Write-Info "Cleaning up temporary files..."
Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue

# Success!
Write-Host @"

Tagify installation completed successfully!

Next steps:
1. Restart Spotify completely
2. Look for 'Tagify' in your Spotify top navigation bar
3. Start tagging your tracks!

"@ -ForegroundColor Green
