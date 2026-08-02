# Makes opensteam.lol resolve on this PC and documents public DNS setup.
# Run as Administrator for the hosts file step.

$ErrorActionPreference = 'Stop'
$Domain = 'opensteam.lol'
$HostsFile = "$env:SystemRoot\System32\drivers\etc\hosts"
$Entry = "127.0.0.1`t$Domain"
$Root = Split-Path $PSScriptRoot -Parent

Write-Host "`n=== OpenSteam domain setup ($Domain) ===`n"

# 1) Local hosts entry (Admin required)
$existing = @(Get-Content $HostsFile -ErrorAction SilentlyContinue) | Where-Object { $_ -match [regex]::Escape($Domain) }
if ($existing) {
    Write-Host "[ok] Hosts file already contains $Domain"
} else {
    try {
        Add-Content -Path $HostsFile -Value "`n# OpenSteam local site`n$Entry" -Encoding ascii
        Write-Host "[ok] Added to hosts: $Entry"
    } catch {
        Write-Host "[!] Could not edit hosts file (run PowerShell as Administrator): $_"
        Write-Host "    Manually add this line to $HostsFile :"
        Write-Host "    $Entry"
    }
}

# 2) Sync app env to opensteam.lol
Push-Location $Root
node scripts/sync-oauth-urls.js
Pop-Location

Write-Host @"

Next steps for https://$Domain to work everywhere:

A) You own $Domain (recommended)
   1. Add the domain in Cloudflare (free plan is fine)
   2. Zero Trust -> Networks -> Tunnels -> Create tunnel
   3. Public hostname: $Domain -> http://127.0.0.1:3000
   4. Discord Developer Portal (gen app 1532867690031484969):
      Redirect URI: https://$Domain/api/auth/callback/discord
   5. Restart: pm2 restart manifest-web manifest-bot --update-env

B) Local-only (until DNS is live)
   - After hosts entry: use Cloudflare quick tunnel OR http://${Domain}:3000
   - OAuth redirect must match the URL you open in the browser exactly

Restart stack after env change:
  cd $Root
  pm2 restart manifest-web manifest-bot --update-env

"@
