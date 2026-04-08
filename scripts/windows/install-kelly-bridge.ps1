param(
  [Parameter(Mandatory = $true)]
  [string]$BridgeSharedSecret,
  [string]$Branch = "codex/implement-kelly-bridge-integration",
  [string]$InstallDir = "C:\weather-kelly-bridge",
  [string]$TaskName = "WeatherKellyBridge",
  [int]$Port = 8080,
  [int]$PublicPort = 80,
  [string]$BindHost = "127.0.0.1",
  [string]$NodeVersion = "22.22.1",
  [int]$HttpTimeoutMs = 12000,
  [int]$NodeMaxOldSpaceSizeMb = 256
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Please run this script from an elevated PowerShell session."
  }
}

function Remove-PathIfExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PathToRemove
  )

  if (Test-Path $PathToRemove) {
    Remove-Item -LiteralPath $PathToRemove -Recurse -Force
  }
}

function Ensure-Directory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PathToCreate
  )

  if (-not (Test-Path $PathToCreate)) {
    New-Item -ItemType Directory -Path $PathToCreate -Force | Out-Null
  }
}

function Download-File {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath
  )

  Invoke-WebRequest -Uri $Url -OutFile $OutputPath
}

function Ensure-NodeRuntime {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [Parameter(Mandatory = $true)]
    [string]$RuntimeRoot
  )

  $runtimeDir = Join-Path $RuntimeRoot ("node-v{0}-win-x64" -f $Version)
  $nodeExe = Join-Path $runtimeDir "node.exe"
  if (Test-Path $nodeExe) {
    return $runtimeDir
  }

  Ensure-Directory -PathToCreate $RuntimeRoot

  $zipPath = Join-Path $env:TEMP ("node-v{0}-win-x64.zip" -f $Version)
  $url = "https://nodejs.org/dist/v{0}/node-v{0}-win-x64.zip" -f $Version
  Download-File -Url $url -OutputPath $zipPath
  Expand-Archive -Path $zipPath -DestinationPath $RuntimeRoot -Force

  return $runtimeDir
}

function Get-RepoZipUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BranchName
  )

  return "https://github.com/xxoo13149/weather-high-temp-workbench/archive/refs/heads/{0}.zip" -f $BranchName
}

function Expand-Repository {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BranchName,
    [Parameter(Mandatory = $true)]
    [string]$DestinationRoot
  )

  Ensure-Directory -PathToCreate $DestinationRoot

  $zipPath = Join-Path $env:TEMP "weather-kelly-bridge-source.zip"
  Download-File -Url (Get-RepoZipUrl -BranchName $BranchName) -OutputPath $zipPath

  $extractRoot = Join-Path $DestinationRoot "extract"
  Remove-PathIfExists -PathToRemove $extractRoot
  Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force

  $repoRoot = Get-ChildItem -Path $extractRoot -Directory | Select-Object -First 1
  if (-not $repoRoot) {
    throw "Failed to unpack repository archive."
  }

  $appRoot = Join-Path $DestinationRoot "app"
  Remove-PathIfExists -PathToRemove $appRoot
  Move-Item -LiteralPath $repoRoot.FullName -Destination $appRoot

  return $appRoot
}

function Invoke-Cli {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory
  )

  $process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList $Arguments `
    -WorkingDirectory $WorkingDirectory `
    -Wait `
    -PassThru `
    -NoNewWindow

  if ($process.ExitCode -ne 0) {
    throw ("Command failed with exit code {0}: {1} {2}" -f $process.ExitCode, $FilePath, ($Arguments -join " "))
  }
}

function Configure-MachineEnvironment {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SharedSecretValue,
    [Parameter(Mandatory = $true)]
    [string]$BindHost,
    [Parameter(Mandatory = $true)]
    [int]$BindPort,
    [Parameter(Mandatory = $true)]
    [int]$TimeoutMs
  )

  [Environment]::SetEnvironmentVariable("HOST", $BindHost, "Machine")
  [Environment]::SetEnvironmentVariable("PORT", $BindPort.ToString(), "Machine")
  [Environment]::SetEnvironmentVariable("HTTP_TIMEOUT_MS", $TimeoutMs.ToString(), "Machine")
  [Environment]::SetEnvironmentVariable("KELLY_BRIDGE_SHARED_SECRET", $SharedSecretValue, "Machine")
}

function Ensure-FirewallRule {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ListenPort,
    [string]$RuleName = ("KellyBridge-{0}" -f $ListenPort),
    [string]$DisplayName = ("Kelly Bridge TCP {0}" -f $ListenPort)
  )

  if (-not (Get-NetFirewallRule -Name $RuleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule `
      -Name $RuleName `
      -DisplayName $DisplayName `
      -Direction Inbound `
      -Action Allow `
      -Protocol TCP `
      -LocalPort $ListenPort | Out-Null
  }
}

function Ensure-PublicPortProxy {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ListenPort,
    [Parameter(Mandatory = $true)]
    [int]$TargetPort,
    [string]$ListenAddress = "0.0.0.0",
    [string]$TargetAddress = "127.0.0.1"
  )

  Set-Service -Name iphlpsvc -StartupType Automatic
  if ((Get-Service -Name iphlpsvc).Status -ne "Running") {
    Start-Service -Name iphlpsvc
  }

  & netsh interface portproxy delete v4tov4 listenport=$ListenPort listenaddress=$ListenAddress | Out-Null
  & netsh interface portproxy add v4tov4 listenport=$ListenPort listenaddress=$ListenAddress connectport=$TargetPort connectaddress=$TargetAddress | Out-Null
}

function Reset-StartupTask {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$NodeExePath,
    [Parameter(Mandatory = $true)]
    [string]$EntryPath,
    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory,
    [Parameter(Mandatory = $true)]
    [string]$SharedSecretValue,
    [Parameter(Mandatory = $true)]
    [string]$BindHost,
    [Parameter(Mandatory = $true)]
    [int]$BindPort,
    [Parameter(Mandatory = $true)]
    [int]$TimeoutMs,
    [Parameter(Mandatory = $true)]
    [int]$MaxOldSpaceSizeMb
  )

  $existing = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false
  }

  $outLog = Join-Path $WorkingDirectory "bridge-task.out.log"
  $errLog = Join-Path $WorkingDirectory "bridge-task.err.log"
  $quotedNode = '"' + $NodeExePath + '"'
  $quotedEntry = '"' + $EntryPath + '"'
  $cmdLine = (
    '/c set HOST={0}&& set PORT={1}&& set HTTP_TIMEOUT_MS={2}&& set KELLY_BRIDGE_SHARED_SECRET={3}&& {4} --max-old-space-size={5} {6} 1>>"{7}" 2>>"{8}"' -f
      $BindHost,
      $BindPort,
      $TimeoutMs,
      $SharedSecretValue,
      $quotedNode,
      $MaxOldSpaceSizeMb,
      $quotedEntry,
      $outLog,
      $errLog
  )

  $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $cmdLine -WorkingDirectory $WorkingDirectory
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
}

function Start-StartupTask {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$EntryPath
  )

  $orphanedCmd = Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($EntryPath) }
  foreach ($process in $orphanedCmd) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }

  Start-ScheduledTask -TaskName $Name
}

function Wait-For-Health {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  for ($attempt = 1; $attempt -le 20; $attempt++) {
    try {
      $response = Invoke-RestMethod -Uri $Url -TimeoutSec 10
      if ($response.ok -eq $true -and $response.service -eq "kelly-bridge") {
        return $response
      }
    } catch {
      Start-Sleep -Seconds 3
    }
  }

  throw "Kelly bridge health check failed after startup."
}

Assert-Administrator

Ensure-Directory -PathToCreate $InstallDir
$runtimeRoot = Join-Path $InstallDir "runtime"
$runtimeDir = Ensure-NodeRuntime -Version $NodeVersion -RuntimeRoot $runtimeRoot
$nodeExe = Join-Path $runtimeDir "node.exe"
$corepackCmd = Join-Path $runtimeDir "corepack.cmd"

$appRoot = Expand-Repository -BranchName $Branch -DestinationRoot $InstallDir

Invoke-Cli -FilePath $corepackCmd -Arguments @("pnpm", "install", "--frozen-lockfile") -WorkingDirectory $appRoot
Invoke-Cli -FilePath $corepackCmd -Arguments @("pnpm", "run", "build:server") -WorkingDirectory $appRoot

Configure-MachineEnvironment `
  -SharedSecretValue $BridgeSharedSecret `
  -BindHost $BindHost `
  -BindPort $Port `
  -TimeoutMs $HttpTimeoutMs

if ($PublicPort -gt 0 -and $PublicPort -ne $Port) {
  Ensure-PublicPortProxy -ListenPort $PublicPort -TargetPort $Port
  Ensure-FirewallRule -ListenPort $PublicPort -RuleName ("KellyBridge-{0}" -f $PublicPort) -DisplayName ("Kelly Bridge TCP {0}" -f $PublicPort)
}

$entryPath = Join-Path $appRoot "dist\kelly-bridge.js"
if (-not (Test-Path $entryPath)) {
  throw "Bridge entry file was not built successfully: $entryPath"
}

Reset-StartupTask `
  -Name $TaskName `
  -NodeExePath $nodeExe `
  -EntryPath $entryPath `
  -WorkingDirectory $appRoot `
  -SharedSecretValue $BridgeSharedSecret `
  -BindHost $BindHost `
  -BindPort $Port `
  -TimeoutMs $HttpTimeoutMs `
  -MaxOldSpaceSizeMb $NodeMaxOldSpaceSizeMb
Start-StartupTask -Name $TaskName -EntryPath $entryPath

$health = Wait-For-Health -Url ("http://127.0.0.1:{0}/healthz" -f $Port)

Write-Host ""
Write-Host "Kelly bridge deployed successfully."
Write-Host ("Task       : {0}" -f $TaskName)
Write-Host ("InstallDir : {0}" -f $InstallDir)
Write-Host ("Health URL : http://127.0.0.1:{0}/healthz" -f $Port)
if ($PublicPort -gt 0 -and $PublicPort -ne $Port) {
  Write-Host ("Public URL : http://<server-host>/healthz (forwarded from {0} -> {1})" -f $PublicPort, $Port)
}
Write-Host ("Build ID   : {0}" -f $health.buildId)
