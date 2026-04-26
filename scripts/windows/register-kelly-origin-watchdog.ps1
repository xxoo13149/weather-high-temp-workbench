[CmdletBinding()]
param(
  [string]$TaskName = "weather-kelly-origin-watchdog",
  [string]$ScriptPath = "C:\weather-kelly-bridge\scripts\windows\watch-kelly-origin.ps1",
  [string]$RunAsUser = "SYSTEM",
  [string]$RunAsPassword = "",
  [string]$ServiceName = "weather-kelly-origin",
  [string]$StatusFile = "C:\weather-kelly-bridge\logs\watchdog-status.json",
  [string]$HealthUrl = "http://127.0.0.1:8081/healthz",
  [string]$SmokeBaseUrl = "http://127.0.0.1:8081",
  [string]$SmokeLocationIds = "miami_mia,toronto_yyz,shanghai_pvg",
  [string]$SmokeUrl = "",
  [int]$Port = 8081
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ScriptPath)) {
  throw "Watchdog script not found at $ScriptPath"
}

$escapedScriptPath = $ScriptPath.Replace('"', '""')
$powershellPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$taskParts = @(
  "`"$powershellPath`"",
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", "`"$escapedScriptPath`"",
  "-ServiceName", "`"$ServiceName`"",
  "-StatusFile", "`"$StatusFile`"",
  "-HealthUrl", "`"$HealthUrl`"",
  "-Port", $Port
)

if ($SmokeUrl) {
  $taskParts += @("-SmokeUrl", "`"$SmokeUrl`"")
} else {
  $taskParts += @(
    "-SmokeBaseUrl", "`"$SmokeBaseUrl`"",
    "-SmokeLocationIds", "`"$SmokeLocationIds`""
  )
}

$taskCommand = $taskParts -join " "

$createArgs = @(
  "/Create",
  "/F",
  "/TN", $TaskName,
  "/SC", "MINUTE",
  "/MO", "1",
  "/RL", "HIGHEST",
  "/TR", $taskCommand
)

if ($RunAsUser -eq "SYSTEM") {
  $createArgs += @("/RU", "SYSTEM")
} else {
  if (-not $RunAsPassword) {
    throw "RunAsPassword is required when RunAsUser is not SYSTEM."
  }

  $createArgs += @("/RU", $RunAsUser, "/RP", $RunAsPassword)
}

& schtasks.exe @createArgs | Out-Null
