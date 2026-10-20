$ErrorActionPreference='Stop'
$scriptPath=Join-Path $PSScriptRoot '../install/Install-Tagify-Full.ps1'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($scriptPath,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
$function=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Install-ManagerAnalyticsOffer'},$true)
Invoke-Expression $function.Extent.Text
$script:logs=@()
function Write-Log {param($Message,$ForegroundColor) $script:logs+=$Message}

$default="(function(){window.__tagifyInstallerAnalyticsV1 ??= { schemaVersion: 2, enabled: false };})();`n"
$manifest='{"name":"Tagify","subfiles_extension":["extension.js","productAnalyticsBridge.js"]}'
$root=Join-Path ([IO.Path]::GetTempPath()) ("tagify-offer-"+[guid]::NewGuid())
function New-App([string]$name,[string]$manifestText=$manifest) {
  $app=Join-Path $root $name; New-Item -ItemType Directory -Path $app -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $app 'productAnalyticsBridge.js'),$default)
  [IO.File]::WriteAllText((Join-Path $app 'manifest.json'),$manifestText)
  return $app
}
function Bridge([string]$app) {[IO.File]::ReadAllText((Join-Path $app 'productAnalyticsBridge.js'))}
function Check([bool]$ok,[string]$message) {if(-not $ok){throw $message}}

$id='0b0e6b4c-2f58-4d3a-9c1e-6f2d1a7b8c90'
$enabled="{`"enabled`":true,`"expiresAt`":`"2026-10-27T09:30:15Z`",`"installationId`":`"$id`",`"schemaVersion`":2}"
$disabled='{"enabled":false,"schemaVersion":2}'
try {
  $env:TAGIFY_INSTALLER_ANALYTICS_OFFER=$enabled
  $app=New-App 'enabled'
  $output=@(Install-ManagerAnalyticsOffer -TagifyDir $app)
  Check ($output.Count -eq 0) 'Offer wrote to the pipeline, which would change Install-TagifyFiles return value'
  Check ((Bridge $app) -ceq "window.__tagifyInstallerAnalyticsV1 = $enabled;`n") 'Valid offer not written'
  Check (-not ($script:logs -join "`n").Contains($id)) 'Installation identity entered the setup log'
  $parsed=(Bridge $app).Substring('window.__tagifyInstallerAnalyticsV1 = '.Length).TrimEnd("`n").TrimEnd(';') | ConvertFrom-Json
  Check ($parsed.schemaVersion -eq 2 -and $parsed.enabled -eq $true -and $parsed.installationId -eq $id) 'Written offer is not readable by the app'

  $env:TAGIFY_INSTALLER_ANALYTICS_OFFER=$disabled
  $app=New-App 'disabled'; Install-ManagerAnalyticsOffer -TagifyDir $app
  Check ((Bridge $app) -ceq "window.__tagifyInstallerAnalyticsV1 = $disabled;`n") 'Opt-out offer not written'

  Remove-Item Env:TAGIFY_INSTALLER_ANALYTICS_OFFER
  $app=New-App 'older-manager'; Install-ManagerAnalyticsOffer -TagifyDir $app
  Check ((Bridge $app) -ceq $default) 'Older Manager without an offer changed the bridge'

  foreach($bad in @(
    ($enabled -replace 'true','"true"'),
    ($enabled -replace $id,'not-a-uuid'),
    ($enabled -replace $id,$id.ToUpperInvariant()),
    ($enabled + ';alert(1)'),
    ($enabled -replace '"schemaVersion":2','"schemaVersion":2,"token":"x"'),
    "$enabled`n",
    '{"enabled":true}')) {
    $env:TAGIFY_INSTALLER_ANALYTICS_OFFER=$bad
    $app=New-App ("bad-"+[guid]::NewGuid()); Install-ManagerAnalyticsOffer -TagifyDir $app
    Check ((Bridge $app) -ceq $default) "Unexpected offer was written: $bad"
  }

  $env:TAGIFY_INSTALLER_ANALYTICS_OFFER=$enabled
  $app=New-App 'unlisted' '{"subfiles_extension":["extension.js"]}'; Install-ManagerAnalyticsOffer -TagifyDir $app
  Check ((Bridge $app) -ceq $default) 'Bridge written although the manifest does not load it'
  $app=New-App 'corrupt-manifest' 'not json'; Install-ManagerAnalyticsOffer -TagifyDir $app
  Check ((Bridge $app) -ceq $default) 'Bridge written with an unreadable manifest'
  $app=Join-Path $root 'older-tagify'; New-Item -ItemType Directory -Path $app | Out-Null
  [IO.File]::WriteAllText((Join-Path $app 'manifest.json'),$manifest)
  Install-ManagerAnalyticsOffer -TagifyDir $app
  Check (-not (Test-Path (Join-Path $app 'productAnalyticsBridge.js'))) 'Bridge created for a Tagify build that does not ship it'
  $app=New-App 'linked'; $outside=Join-Path $root 'outside.js'; [IO.File]::WriteAllText($outside,'outside')
  Remove-Item (Join-Path $app 'productAnalyticsBridge.js')
  New-Item -ItemType SymbolicLink -Path (Join-Path $app 'productAnalyticsBridge.js') -Target $outside | Out-Null
  Install-ManagerAnalyticsOffer -TagifyDir $app
  Check ([IO.File]::ReadAllText($outside) -ceq 'outside') 'Offer followed a linked bridge file'
  'PASS: Manager analytics offer written only in the app''s exact version-two shape, only to a listed regular bridge file'
}
finally {
  Remove-Item Env:TAGIFY_INSTALLER_ANALYTICS_OFFER -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
