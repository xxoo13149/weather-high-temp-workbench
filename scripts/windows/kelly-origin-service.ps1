[CmdletBinding()]
param(
  [ValidateSet("install", "update", "restart", "uninstall", "status", "logs")]
  [string]$Action = "status",
  [string]$ServiceName = "weather-kelly-origin",
  [string]$DisplayName = "Weather Kelly Origin",
  [string]$Description = "Kelly origin bridge for /api/weather/kelly and /api/weather/kelly/stream.",
  [string]$AppDirectory = "C:\weather-kelly-bridge",
  [string]$NodePath = "C:\weather-kelly-bridge\runtime\node-v22.22.1-win-x64\node.exe",
  [string]$EntryScript = "dist\index.js",
  [string]$BindHost = "0.0.0.0",
  [int]$Port = 8081,
  [string]$NssmPath = "",
  [int]$LogTail = 80
)

$ErrorActionPreference = "Stop"

function Resolve-NssmPath {
  param([string]$RequestedPath)

  if ($RequestedPath -and (Test-Path -LiteralPath $RequestedPath)) {
    return (Resolve-Path -LiteralPath $RequestedPath).Path
  }

  $command = Get-Command nssm.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @(
    "C:\nssm\win64\nssm.exe",
    "C:\nssm\win32\nssm.exe",
    "$AppDirectory\tools\nssm\nssm.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  throw "nssm.exe was not found. Pass -NssmPath or install NSSM first."
}

function Ensure-Directory {
  param([string]$PathValue)

  if (-not (Test-Path -LiteralPath $PathValue)) {
    New-Item -ItemType Directory -Path $PathValue -Force | Out-Null
  }
}

function Get-ServicePathSet {
  $logsDirectory = Join-Path $AppDirectory "logs"
  return @{
    LogsDirectory = $logsDirectory
    EntryScript = Join-Path $AppDirectory $EntryScript
    WatchdogStatusFile = Join-Path $logsDirectory "watchdog-status.json"
    StdoutLog = Join-Path $logsDirectory "service-stdout.log"
    StderrLog = Join-Path $logsDirectory "service-stderr.log"
  }
}

function Ensure-ServicePaths {
  $paths = Get-ServicePathSet
  $logsDirectory = Join-Path $AppDirectory "logs"
  Ensure-Directory -PathValue $AppDirectory
  Ensure-Directory -PathValue $logsDirectory

  if (-not (Test-Path -LiteralPath $NodePath)) {
    throw "Node runtime not found at $NodePath"
  }
  if (-not (Test-Path -LiteralPath $paths.EntryScript)) {
    throw "Entry script not found at $($paths.EntryScript)"
  }

  return $paths
}

function Configure-Service {
  param(
    [string]$ResolvedNssm,
    [hashtable]$Paths
  )

  $envBlock = @(
    "HOST=$BindHost",
    "PORT=$Port",
    "SERVICE_NAME=kelly-origin",
    "KELLY_WATCHDOG_STATUS_FILE=$($Paths.WatchdogStatusFile)"
  ) -join "`n"

  if (-not (Get-ServiceSafe)) {
    & $ResolvedNssm install $ServiceName $NodePath $Paths.EntryScript | Out-Null
  }

  & $ResolvedNssm set $ServiceName Application $NodePath | Out-Null
  & $ResolvedNssm set $ServiceName AppParameters $Paths.EntryScript | Out-Null
  & $ResolvedNssm set $ServiceName AppDirectory $AppDirectory | Out-Null
  & $ResolvedNssm set $ServiceName DisplayName $DisplayName | Out-Null
  & $ResolvedNssm set $ServiceName Description $Description | Out-Null
  & $ResolvedNssm set $ServiceName Start SERVICE_AUTO_START | Out-Null
  & $ResolvedNssm set $ServiceName AppStdout $Paths.StdoutLog | Out-Null
  & $ResolvedNssm set $ServiceName AppStderr $Paths.StderrLog | Out-Null
  & $ResolvedNssm set $ServiceName AppRotateFiles 1 | Out-Null
  & $ResolvedNssm set $ServiceName AppRotateOnline 1 | Out-Null
  & $ResolvedNssm set $ServiceName AppRotateBytes 10485760 | Out-Null
  & $ResolvedNssm set $ServiceName AppEnvironmentExtra $envBlock | Out-Null
  & $ResolvedNssm set $ServiceName AppThrottle 1500 | Out-Null
  & $ResolvedNssm set $ServiceName AppExit Default Restart | Out-Null
}

function Get-ServiceSafe {
  return Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
}

function Show-ServiceStatus {
  $service = Get-ServiceSafe
  $paths = Get-ServicePathSet

  if (-not $service) {
    Write-Host "Service '$ServiceName' is not installed."
    return
  }

  Write-Host "Name: $($service.Name)"
  Write-Host "Status: $($service.Status)"
  Write-Host "DisplayName: $($service.DisplayName)"
  Write-Host "Logs: $($paths.LogsDirectory)"

  if (Test-Path -LiteralPath $paths.WatchdogStatusFile) {
    Write-Host "Watchdog status:"
    Get-Content -LiteralPath $paths.WatchdogStatusFile
  }
}

function Show-Logs {
  $paths = Get-ServicePathSet
  foreach ($logFile in @($paths.StdoutLog, $paths.StderrLog)) {
    if (-not (Test-Path -LiteralPath $logFile)) {
      Write-Host "Missing log file: $logFile"
      continue
    }

    Write-Host "==== $logFile ===="
    Get-Content -LiteralPath $logFile -Tail $LogTail
  }
}

$resolvedNssm = if ($Action -in @("install", "update", "restart", "uninstall")) { Resolve-NssmPath -RequestedPath $NssmPath } else { $null }
$paths = if ($Action -ne "status" -and $Action -ne "logs") { Ensure-ServicePaths } else { $null }

switch ($Action) {
  "install" {
    Configure-Service -ResolvedNssm $resolvedNssm -Paths $paths
    Start-Service -Name $ServiceName
  }
  "update" {
    Configure-Service -ResolvedNssm $resolvedNssm -Paths $paths
    Restart-Service -Name $ServiceName -Force
  }
  "restart" {
    $service = Get-ServiceSafe
    if (-not $service) {
      throw "Service '$ServiceName' is not installed."
    }
    Restart-Service -Name $ServiceName -Force
  }
  "uninstall" {
    $service = Get-ServiceSafe
    if ($service) {
      if ($service.Status -ne "Stopped") {
        Stop-Service -Name $ServiceName -Force
      }
      & $resolvedNssm remove $ServiceName confirm | Out-Null
    }
  }
  "status" {
    Show-ServiceStatus
  }
  "logs" {
    Show-Logs
  }
}
