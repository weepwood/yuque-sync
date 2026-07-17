$ErrorActionPreference = "Stop"

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
  throw "cloudflared was not found. Install it first and ensure it is in PATH."
}

$port = 8787
if (Test-Path ".env") {
  $line = Get-Content ".env" | Where-Object { $_ -match '^PORT=' } | Select-Object -First 1
  if ($line) {
    $port = [int]($line.Split('=', 2)[1].Trim())
  }
}

Write-Host "Starting Cloudflare Quick Tunnel for http://127.0.0.1:$port"
Write-Host "Append your MCP_PATH value to the HTTPS URL printed by cloudflared."
cloudflared tunnel --url "http://127.0.0.1:$port"
