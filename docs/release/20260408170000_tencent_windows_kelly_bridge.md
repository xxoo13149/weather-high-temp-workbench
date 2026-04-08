# Tencent Windows Kelly Bridge Deployment

## Purpose
- Deploy the dedicated Kelly bridge onto a Tencent Cloud Windows server.
- Keep the public website on `lukaluka.fun`.
- Keep `/api/weather/kelly` and `/api/weather/kelly/stream` behind the existing Cloudflare Worker.

## Prerequisites
- Windows Server 2019 or 2022
- Administrator PowerShell
- Public internet access from the server
- Cloudflare Worker already deployed for `lukaluka.fun`

## Step 1: Enable Remote Management
Run this once from an elevated PowerShell session on the server:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
$script = "$env:TEMP\enable-remote-management.ps1"
Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/xxoo13149/weather-high-temp-workbench/codex/implement-kelly-bridge-integration/scripts/windows/enable-remote-management.ps1" `
  -OutFile $script
powershell -ExecutionPolicy Bypass -File $script -PublicKey "<your-public-key>"
```

This enables:
- OpenSSH on port `22`
- WinRM on port `5985`

## Step 2: Install the Bridge
Run this once from an elevated PowerShell session on the server:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
$script = "$env:TEMP\install-kelly-bridge.ps1"
Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/xxoo13149/weather-high-temp-workbench/codex/implement-kelly-bridge-integration/scripts/windows/install-kelly-bridge.ps1" `
  -OutFile $script
powershell -ExecutionPolicy Bypass -File $script -BridgeSharedSecret "<shared-secret>"
```

The installer will:
- Download Node.js `22.22.1`
- Download the repository archive for branch `codex/implement-kelly-bridge-integration`
- Install dependencies
- Build `dist/kelly-bridge.js`
- Keep the bridge listening on loopback `127.0.0.1:8080`
- Expose a public HTTP entry on TCP `80` that forwards to `127.0.0.1:8080`
- Register a Windows startup task named `WeatherKellyBridge`
- Start the task immediately and verify `/healthz`

## Step 3: Cloudflare Worker Settings
Worker variables:
- `KELLY_BRIDGE_BASE_URL`
- `KELLY_BRIDGE_SHARED_SECRET`

Recommended value:
- `KELLY_BRIDGE_BASE_URL=http://kelly-bridge.lukaluka.fun`

## Validation
- Local server check:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/healthz
```

- Public bridge check:

```powershell
Invoke-RestMethod http://kelly-bridge.lukaluka.fun/healthz
```

- Public same-origin check:
  - `https://lukaluka.fun/api/weather/kelly?...`
  - `https://lukaluka.fun/healthz`

## Notes
- The bridge remains secret-protected even when the HTTP entry is open publicly.
- Keeping Node on `8080` and forwarding `80 -> 8080` avoids the unstable direct-`8080` path that some Tencent Windows setups exhibit.
- The bridge is launched by Scheduled Tasks, not `sc.exe`, because a plain Node process is not a real Windows Service and is less reliable when registered directly with SCM.
- The public site should continue to use same-origin `lukaluka.fun` endpoints.
