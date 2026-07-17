$ErrorActionPreference = "Stop"

Write-Host "Checking Node.js..."
$nodeVersionRaw = node --version
if (-not $nodeVersionRaw) {
  throw "Node.js was not found. Install Node.js 20 or newer."
}

$major = [int](($nodeVersionRaw -replace '^v', '').Split('.')[0])
if ($major -lt 20) {
  throw "Node.js 20 or newer is required. Current version: $nodeVersionRaw"
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example. Fill in Yuque credentials before starting."
}

npm install
npm run check

Write-Host "Setup complete. Edit .env, then run scripts\start-windows.ps1"
