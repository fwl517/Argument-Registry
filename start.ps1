# ============================================================================
# Political Society Database -- daily start script (Windows / PowerShell)
# ----------------------------------------------------------------------------
# Run this every time you want to bring the website up:
#
#     powershell -ExecutionPolicy Bypass -File start.ps1
#
# It will:
#   1. Check that PostgreSQL is running.
#   2. Start the Node web server.
#   3. Open your default browser at the site once it's ready.
#
# Press Ctrl+C in this terminal to stop the website.
# ============================================================================

$ErrorActionPreference = 'Stop'

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

function Write-Ok($msg)   { Write-Host $msg -ForegroundColor Green }
function Write-Warn($msg) { Write-Host $msg -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host $msg -ForegroundColor Red }

$EnvFile = Join-Path $ProjectDir '.env'
if (-not (Test-Path $EnvFile)) {
    Write-Err 'No .env file found. Run setup.ps1 first.'
    exit 1
}

# Load .env into the current process.
$envVars = @{}
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') {
        $envVars[$Matches[1]] = $Matches[2]
        Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
    }
}
$Port = if ($envVars['PORT']) { $envVars['PORT'] } else { '3000' }

# ---- 1. PostgreSQL reachable? --------------------------------------------
Write-Host 'Checking PostgreSQL...' -ForegroundColor Cyan

$pgOk = $false
if (Get-Command pg_isready -ErrorAction SilentlyContinue) {
    & pg_isready -q -h localhost
    if ($LASTEXITCODE -eq 0) { $pgOk = $true }
} else {
    & psql $envVars['DATABASE_URL'] -c 'SELECT 1' *> $null
    if ($LASTEXITCODE -eq 0) { $pgOk = $true }
}

if (-not $pgOk) {
    Write-Err 'PostgreSQL is not running, or .env points at a database it cannot reach.'
    Write-Host ''
    Write-Host 'Start PostgreSQL via Services (services.msc) -- the entry is called something'
    Write-Host 'like "postgresql-x64-15". Right-click and choose Start. Then run start.ps1 again.'
    exit 1
}
Write-Ok 'PostgreSQL is up.'

# ---- 2. open the browser shortly after the server starts -----------------
$Url = "http://localhost:$Port/"

Start-Job -ScriptBlock {
    param($url)
    Start-Sleep -Seconds 2
    Start-Process $url
} -ArgumentList $Url | Out-Null

# ---- 3. run the server (foreground) --------------------------------------
Write-Host ''
Write-Host "Starting the website at $Url" -ForegroundColor Cyan
Write-Warn 'Press Ctrl+C in this window to stop it.'
Write-Host ''

& npm start
