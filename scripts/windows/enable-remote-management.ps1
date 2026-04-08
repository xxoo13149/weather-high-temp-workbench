param(
  [string]$PublicKey = ""
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Please run this script from an elevated PowerShell session."
  }
}

function Ensure-OpenSshServer {
  $capability = Get-WindowsCapability -Online | Where-Object Name -like "OpenSSH.Server*"
  if (-not $capability) {
    throw "OpenSSH.Server capability is unavailable on this machine."
  }

  if ($capability.State -ne "Installed") {
    Add-WindowsCapability -Online -Name $capability.Name | Out-Null
  }

  Set-Service -Name sshd -StartupType Automatic
  Start-Service -Name sshd

  if (-not (Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule `
      -Name "OpenSSH-Server-In-TCP" `
      -DisplayName "OpenSSH Server (TCP-In)" `
      -Direction Inbound `
      -Action Allow `
      -Protocol TCP `
      -LocalPort 22 | Out-Null
  }
}

function Set-AdministratorAuthorizedKey {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Key
  )

  $sshDir = Join-Path $env:ProgramData "ssh"
  $authorizedKeysPath = Join-Path $sshDir "administrators_authorized_keys"

  if (-not (Test-Path $sshDir)) {
    New-Item -ItemType Directory -Path $sshDir -Force | Out-Null
  }

  $normalized = $Key.Trim()
  if (-not $normalized) {
    return
  }

  Set-Content -Path $authorizedKeysPath -Value $normalized -Encoding ascii

  & icacls $authorizedKeysPath /inheritance:r | Out-Null
  & icacls $authorizedKeysPath /grant "Administrators:F" | Out-Null
  & icacls $authorizedKeysPath /grant "SYSTEM:F" | Out-Null
}

function Ensure-WinRm {
  Set-Service -Name WinRM -StartupType Automatic
  Enable-PSRemoting -Force -SkipNetworkProfileCheck
}

Assert-Administrator
Ensure-OpenSshServer

if ($PublicKey.Trim()) {
  Set-AdministratorAuthorizedKey -Key $PublicKey
  Restart-Service -Name sshd
}

Ensure-WinRm

Write-Host ""
Write-Host "Remote management is ready."
Write-Host "Open ports:"
Write-Host "  SSH   : 22"
Write-Host "  WinRM : 5985"
Write-Host ""
Write-Host "Quick checks:"
Write-Host "  Get-Service sshd, WinRM"
Write-Host "  netstat -ano | findstr :22"
Write-Host "  netstat -ano | findstr :5985"
