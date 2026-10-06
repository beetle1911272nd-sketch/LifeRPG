$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot

Write-Host "Starting REAL LIFE RPG Sandbox..." -ForegroundColor Cyan

& (Join-Path $PSScriptRoot "diagnose.ps1") -AllowMissingDependencies
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Environment is incomplete. Install Node.js and run this script again." -ForegroundColor Yellow
    exit $LASTEXITCODE
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "node_modules") -PathType Container)) {
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    npm.cmd install
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed."
    }
}

Write-Host "Open http://localhost:5173/ in your browser." -ForegroundColor Green
npm.cmd run dev
