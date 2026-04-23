param(
  [string]$AppDirectory = "C:\weather-kelly-bridge",
  [string]$ZipPath = (Join-Path $PSScriptRoot "kelly-origin-dist-20260423-kelly-latency-audit-fix.zip"),
  [string]$ServiceScriptPath = "C:\weather-kelly-bridge\scripts\windows\kelly-origin-service.ps1"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath $ZipPath)) {
  throw "Hotfix zip not found: $ZipPath"
}

$resolvedAppDirectory = (Resolve-Path -LiteralPath $AppDirectory).Path
$resolvedZipPath = (Resolve-Path -LiteralPath $ZipPath).Path
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $resolvedAppDirectory "backups"
$backupDistPath = Join-Path $backupRoot "dist-before-hotfix-$timestamp"
$targetDistPath = Join-Path $resolvedAppDirectory "dist"
$extractRoot = Join-Path $resolvedAppDirectory "hotfix"
$extractPath = Join-Path $extractRoot "extract-$timestamp"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

if (!(Test-Path -LiteralPath $targetDistPath)) {
  throw "Target dist directory not found: $targetDistPath"
}

Copy-Item -LiteralPath $targetDistPath -Destination $backupDistPath -Recurse -Force

if (Test-Path -LiteralPath $extractPath) {
  Remove-Item -LiteralPath $extractPath -Recurse -Force
}

Expand-Archive -LiteralPath $resolvedZipPath -DestinationPath $extractPath -Force

$extractedDistPath = Join-Path $extractPath "dist"
$sourceDistPath = $null

if (Test-Path -LiteralPath $extractedDistPath) {
  $sourceDistPath = (Resolve-Path -LiteralPath $extractedDistPath).Path
} elseif (Test-Path -LiteralPath (Join-Path $extractPath "src\index.js")) {
  $sourceDistPath = (Resolve-Path -LiteralPath $extractPath).Path
} else {
  throw "Extracted archive does not contain a deployable dist payload. Checked: $extractedDistPath and $extractPath"
}

Remove-Item -LiteralPath $targetDistPath -Recurse -Force
New-Item -ItemType Directory -Path $targetDistPath -Force | Out-Null
Copy-Item -Path (Join-Path $sourceDistPath "*") -Destination $targetDistPath -Recurse -Force

if (!(Test-Path -LiteralPath $ServiceScriptPath)) {
  throw "Service control script not found: $ServiceScriptPath"
}

& powershell -ExecutionPolicy Bypass -File $ServiceScriptPath -Action update | Out-Null
Start-Sleep -Seconds 5

$healthResponse = Invoke-RestMethod -Uri "http://127.0.0.1:8081/healthz" -TimeoutSec 15
$sampleResponse = Invoke-RestMethod -Uri "http://127.0.0.1:8081/api/weather/kelly?locationId=miami_mia" -TimeoutSec 20

[PSCustomObject]@{
  deployed = $true
  appDirectory = $resolvedAppDirectory
  zipPath = $resolvedZipPath
  backupDistPath = $backupDistPath
  deployedFrom = $sourceDistPath
  buildId = $healthResponse.buildId
  healthOk = [bool]($healthResponse.ok -or $healthResponse.healthOk)
  sampleLocationId = $sampleResponse.location.id
  sampleTargetDate = $sampleResponse.targetDate
  sampleWarningCount = @($sampleResponse.warnings).Count
  sampleMarketCount = @($sampleResponse.markets).Count + @($sampleResponse.inactiveMarkets).Count
} | ConvertTo-Json -Depth 6
