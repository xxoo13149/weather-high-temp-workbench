[CmdletBinding()]
param(
  [string]$ServiceName = "weather-kelly-origin",
  [string]$StatusFile = "C:\weather-kelly-bridge\logs\watchdog-status.json",
  [string]$HealthUrl = "http://127.0.0.1:8081/healthz",
  [string]$SmokeBaseUrl = "http://127.0.0.1:8081",
  [string]$SmokeLocationIds = "miami_mia,toronto_yyz,shanghai_pvg",
  [string]$SmokeUrl = "",
  [int]$Port = 8081
)

$ErrorActionPreference = "Stop"

function Read-State {
  if (-not (Test-Path -LiteralPath $StatusFile)) {
    return [ordered]@{
      checkedAt = $null
      healthy = $false
      consecutiveHealthFailures = 0
      lastRestartAt = $null
      lastHealthError = $null
      lastSmokeAt = $null
      lastSmokeError = $null
      lastSmokeLocationId = $null
      lastSmokeUrl = $null
    }
  }

  $parsed = Get-Content -LiteralPath $StatusFile -Raw | ConvertFrom-Json
  return [ordered]@{
    checkedAt = $parsed.checkedAt
    healthy = [bool]$parsed.healthy
    consecutiveHealthFailures = [int]$parsed.consecutiveHealthFailures
    lastRestartAt = $parsed.lastRestartAt
    lastHealthError = $parsed.lastHealthError
    lastSmokeAt = $parsed.lastSmokeAt
    lastSmokeError = $parsed.lastSmokeError
    lastSmokeLocationId = $parsed.lastSmokeLocationId
    lastSmokeUrl = $parsed.lastSmokeUrl
  }
}

function Write-State {
  param([hashtable]$State)

  $directory = Split-Path -Parent $StatusFile
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }

  $State | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $StatusFile -Encoding UTF8
}

function Split-SmokeLocationIds {
  param([string]$RawValue)

  if (-not $RawValue) {
    return @()
  }

  return @(
    $RawValue.Split(",") |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ }
  )
}

function Resolve-NextSmokeLocationId {
  param(
    [hashtable]$State,
    [string[]]$LocationIds
  )

  if (-not $LocationIds -or $LocationIds.Count -eq 0) {
    return $null
  }

  if (-not $State.lastSmokeLocationId) {
    return $LocationIds[0]
  }

  $currentIndex = [Array]::IndexOf($LocationIds, [string]$State.lastSmokeLocationId)
  if ($currentIndex -lt 0 -or $currentIndex -ge ($LocationIds.Count - 1)) {
    return $LocationIds[0]
  }

  return $LocationIds[$currentIndex + 1]
}

function Resolve-SmokeRequest {
  param(
    [hashtable]$State,
    [string]$ExplicitSmokeUrl,
    [string]$BaseUrl,
    [string]$LocationIdsRaw
  )

  if ($ExplicitSmokeUrl) {
    return [ordered]@{
      Url = $ExplicitSmokeUrl
      LocationId = $null
    }
  }

  $locationIds = Split-SmokeLocationIds -RawValue $LocationIdsRaw
  $nextLocationId = Resolve-NextSmokeLocationId -State $State -LocationIds $locationIds
  if (-not $nextLocationId) {
    throw "SmokeLocationIds must include at least one location when SmokeUrl is not provided."
  }

  $trimmedBaseUrl = $BaseUrl.TrimEnd("/")
  return [ordered]@{
    Url = "$trimmedBaseUrl/api/weather/kelly?locationId=$([uri]::EscapeDataString($nextLocationId))"
    LocationId = $nextLocationId
  }
}

$state = Read-State
$checkedAt = (Get-Date).ToString("o")
$healthOk = $false
$lastHealthError = $null

try {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop
  if (-not $listener) {
    throw "No listener on port $Port"
  }

  $healthResponse = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 10
  if ($healthResponse.StatusCode -ne 200) {
    throw "Health endpoint returned $($healthResponse.StatusCode)"
  }

  $healthOk = $true
} catch {
  $lastHealthError = $_.Exception.Message
}

if ($healthOk) {
  $state.consecutiveHealthFailures = 0
  $state.healthy = $true
  $state.lastHealthError = $null
} else {
  $state.consecutiveHealthFailures = [int]$state.consecutiveHealthFailures + 1
  $state.healthy = $false
  $state.lastHealthError = $lastHealthError
}

if ([int]$state.consecutiveHealthFailures -ge 2) {
  Restart-Service -Name $ServiceName -Force
  $state.lastRestartAt = (Get-Date).ToString("o")
  $state.consecutiveHealthFailures = 0
}

$shouldRunSmoke = $true
if ($state.lastSmokeAt) {
  $elapsed = (Get-Date) - [datetime]$state.lastSmokeAt
  $shouldRunSmoke = $elapsed.TotalMinutes -ge 5
}

if ($shouldRunSmoke) {
  $smokeRequest = Resolve-SmokeRequest -State $state -ExplicitSmokeUrl $SmokeUrl -BaseUrl $SmokeBaseUrl -LocationIdsRaw $SmokeLocationIds
  try {
    $smokeResponse = Invoke-WebRequest -Uri $smokeRequest.Url -UseBasicParsing -TimeoutSec 15
    if ($smokeResponse.StatusCode -ne 200) {
      throw "Smoke endpoint returned $($smokeResponse.StatusCode)"
    }
    $state.lastSmokeError = $null
  } catch {
    $state.lastSmokeError = $_.Exception.Message
  }

  $state.lastSmokeAt = (Get-Date).ToString("o")
  $state.lastSmokeLocationId = $smokeRequest.LocationId
  $state.lastSmokeUrl = $smokeRequest.Url
}

$state.checkedAt = $checkedAt
Write-State -State $state
