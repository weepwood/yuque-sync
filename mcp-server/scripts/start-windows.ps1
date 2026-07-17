$ErrorActionPreference = "Stop"

if (-not (Test-Path ".env")) {
  throw ".env not found. Run scripts\setup-windows.ps1 first."
}

if (-not (Test-Path "node_modules")) {
  npm install
}

if (-not (Test-Path "dist\src\http.js")) {
  npm run build
}

npm start
