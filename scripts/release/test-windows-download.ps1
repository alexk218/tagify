$ErrorActionPreference='Stop'
$scriptPath=Join-Path $PSScriptRoot '../install/Install-Tagify-Full.ps1'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($scriptPath,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
foreach($name in @('Get-LatestTagifyVersion','Download-TagifyRelease')) {
 $function=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 Invoke-Expression $function.Extent.Text
}
function Write-Log {param($Message,$ForegroundColor)}
function Write-UserProgress {param($Message)}
function Show-Notification {param($Title,$Message)}
function Write-ErrorAndExit {param($Message) throw $Message}
$env:TEMP=[System.IO.Path]::GetTempPath()
$script:SETUP_TEMP=$env:TEMP
$REPO_OWNER='alexk218'; $REPO_NAME='tagify'
$payload=[System.Text.Encoding]::UTF8.GetBytes('archive fixture')
$sha=[Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($payload)).ToLower()
$script:manifest=@{tag_name='v3.2.0';body='notes';assets=@(@{name='tagify-v3.2.0.zip';browser_download_url='https://github.com/alexk218/tagify/releases/download/v3.2.0/tagify-v3.2.0.zip';digest="sha256:$sha";size=$payload.Length})}
function Invoke-RestMethod {param($Uri,$TimeoutSec) if($Uri -ne 'https://api.github.com/repos/alexk218/tagify/releases/latest'){throw 'Unexpected request'};return $script:manifest}
function Invoke-WebRequest {param($Uri,$OutFile,[switch]$UseBasicParsing) [IO.File]::WriteAllBytes($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutFile),$payload)}
$script:extracted=$false
function Expand-ZipFile {param($ZipPath,$Destination) $script:extracted=$true}
$result=Get-LatestTagifyVersion
if(-not $result.Success -or $result.Version -ne '3.2.0'){throw 'Wrong client version'}
$folder=Download-TagifyRelease -DownloadUrl $result.DownloadUrl
if(-not $script:extracted){throw 'Valid archive not extracted'}
Remove-Item $folder -Recurse -Force
$script:extracted=$false;$script:manifest.assets[0].digest='sha256:' + ('0'*64)
try { Download-TagifyRelease -DownloadUrl $result.DownloadUrl; throw 'BAD_HASH_ACCEPTED' } catch {if($_ -match 'BAD_HASH_ACCEPTED'){throw}}
if($script:extracted){throw 'Corrupt download extracted'}
$script:manifest.assets[0].browser_download_url='https://evil.example/file.zip'
try {Download-TagifyRelease -DownloadUrl 'https://evil.example/file.zip'; throw 'FOREIGN_ACCEPTED'} catch {if($_ -match 'FOREIGN_ACCEPTED'){throw}}
'PASS: PowerShell parsing, GitHub release lookup, valid checksum, corrupt download rejection, foreign URL rejection'
