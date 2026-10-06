param(
    [switch]$AllowMissingDependencies
)

$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot
$script:failed = $false

function Write-Check {
    param([string]$Name, [bool]$Passed, [string]$Detail)
    if ($Passed) {
        Write-Host "[OK]   $Name - $Detail" -ForegroundColor Green
    } else {
        Write-Host "[NG]   $Name - $Detail" -ForegroundColor Red
        $script:failed = $true
    }
}

Write-Host ""
Write-Host "REAL LIFE RPG Sandbox Environment Diagnostic" -ForegroundColor Cyan
Write-Host "Path: $PSScriptRoot"
Write-Host ""

$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
$nodeDetail = "not installed"
$npmDetail = "not found"
if ($node) { $nodeDetail = node --version }
if ($npm) { $npmDetail = npm.cmd --version }
Write-Check "Node.js" ($null -ne $node) $nodeDetail
Write-Check "npm" ($null -ne $npm) $npmDetail

$requiredFiles = @("package.json", "index.html", "main.jsx", "vite.config.js", "..\app.generated.jsx")
foreach ($file in $requiredFiles) {
    $path = Join-Path $PSScriptRoot $file
    $exists = Test-Path -LiteralPath $path -PathType Leaf
    $fileDetail = "missing"
    if ($exists) { $fileDetail = "found" }
    Write-Check "File $file" $exists $fileDetail
}

$packageLock = Test-Path -LiteralPath (Join-Path $PSScriptRoot "package-lock.json") -PathType Leaf
$nodeModules = Test-Path -LiteralPath (Join-Path $PSScriptRoot "node_modules") -PathType Container
$dependencyDetail = "not installed (run npm install)"
if ($nodeModules) { $dependencyDetail = "node_modules found" }
if ($AllowMissingDependencies -and -not $nodeModules) {
    Write-Host "[INFO] Dependencies - not installed yet; run-sandbox.ps1 will install them" -ForegroundColor Yellow
} else {
    Write-Check "Dependencies" $nodeModules $dependencyDetail
}
$lockDetail = "not created"
if ($packageLock) { $lockDetail = "found" }
Write-Host "[INFO] package-lock.json - $lockDetail" -ForegroundColor DarkGray

$portInUse = $false
if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $portInUse = @(Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue).Count -gt 0
}
$portDetail = "available"
if ($portInUse) { $portDetail = "in use; check an existing Vite process" }
Write-Check "Vite port 5173" (-not $portInUse) $portDetail

Write-Host ""
if ($script:failed) {
    Write-Host "Result: action required" -ForegroundColor Yellow
    exit 1
}

Write-Host "Result: ready to run" -ForegroundColor Green
exit 0
