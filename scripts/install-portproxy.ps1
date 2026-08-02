# Forward opensteam.lol ports to local services (requires hosts entry + Admin for 443).
$ErrorActionPreference = 'Stop'

netsh interface portproxy delete v4tov4 listenport=80 listenaddress=127.0.0.1 2>$null | Out-Null
netsh interface portproxy add v4tov4 listenport=80 listenaddress=127.0.0.1 connectport=3000 connectaddress=127.0.0.1
Write-Host '[ok] http://opensteam.lol -> http://127.0.0.1:3000'

if (Test-Path (Join-Path (Split-Path $PSScriptRoot -Parent) 'certs\opensteam.lol.pem')) {
  netsh interface portproxy delete v4tov4 listenport=443 listenaddress=127.0.0.1 2>$null | Out-Null
  netsh interface portproxy add v4tov4 listenport=443 listenaddress=127.0.0.1 connectport=3443 connectaddress=127.0.0.1
  Write-Host '[ok] https://opensteam.lol -> https://127.0.0.1:3443'
}
