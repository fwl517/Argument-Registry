# ============================================================================
# Political Society Database -- first-time setup script (Windows / PowerShell)
# ----------------------------------------------------------------------------
# Run this once, in PowerShell, from inside the project folder:
#
#     powershell -ExecutionPolicy Bypass -File setup.ps1
#
# It will:
#   1. Check that Node.js (>= 20) and PostgreSQL (psql) are installed.
#   2. Install the project's Node dependencies (npm install).
#   3. Ask you for a database password and where to keep uploaded files.
#   4. Create the database + database user inside PostgreSQL.
#   5. Write a .env settings file.
#   6. Build the database structure.
#   7. Create the uploads folder.
#   8. Create the Root administrator account and print its one-time password.
#
# Re-running is safe -- the script skips steps that are already done.
# ============================================================================

$ErrorActionPreference = 'Stop'

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

function Write-Step($n, $title) {
    Write-Host ''
    Write-Host '----------------------------------------------------------------'
    Write-Host ("  Step $n of 8 -- $title") -ForegroundColor Cyan
    Write-Host '----------------------------------------------------------------'
}
function Write-Ok($msg)   { Write-Host $msg -ForegroundColor Green }
function Write-Warn($msg) { Write-Host $msg -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host $msg -ForegroundColor Red }
function Stop-Setup($msg) {
    Write-Err "ERROR: $msg"
    Write-Host ''
    Write-Host 'Setup did not finish. Fix the problem above and run setup.ps1 again.'
    exit 1
}

# ---- step 1: check prerequisites ------------------------------------------
Write-Step 1 'checking prerequisites'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Err 'Node.js is not installed (or not on your PATH).'
    Write-Host ''
    Write-Host 'Install Node.js 20 or newer from https://nodejs.org (pick the LTS'
    Write-Host 'download), then run setup.ps1 again.'
    exit 1
}

$nodeVersion = (node --version) -replace '^v',''
$nodeMajor = [int]($nodeVersion -split '\.')[0]
if ($nodeMajor -lt 20) {
    Stop-Setup "Node.js version $nodeVersion is too old (need 20 or newer)."
}
Write-Ok "Node.js v$nodeVersion -- OK"

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    Write-Err 'PostgreSQL is not installed (or psql is not on your PATH).'
    Write-Host ''
    Write-Host 'Install PostgreSQL 15 or newer from https://www.postgresql.org/download/windows/'
    Write-Host 'During install, write down the password you set for the postgres user.'
    Write-Host ''
    Write-Host 'If you already installed it but PowerShell does not find psql, add'
    Write-Host '  C:\Program Files\PostgreSQL\<version>\bin'
    Write-Host 'to your PATH and re-open PowerShell.'
    exit 1
}
$psqlVersion = (psql --version).Split(' ')[2]
Write-Ok "PostgreSQL $psqlVersion -- OK"

# ---- step 2: install npm dependencies -------------------------------------
Write-Step 2 'installing project dependencies'

if (Test-Path "$ProjectDir\node_modules") {
    Write-Warn 'node_modules already exists -- re-running npm install to make sure it is up to date.'
}
& npm install
if ($LASTEXITCODE -ne 0) { Stop-Setup '`npm install` failed (usually a network problem).' }
Write-Ok 'Dependencies installed.'

# ---- step 3: collect configuration ----------------------------------------
Write-Step 3 'settings'

Write-Host 'Answer a couple of questions. Press Enter to accept the [default] in brackets.'
Write-Host ''

$EnvFile = Join-Path $ProjectDir '.env'
$KeepExistingEnv = $false
if (Test-Path $EnvFile) {
    Write-Warn "A .env file already exists at $EnvFile"
    $ans = Read-Host '  Keep it and skip the database-creation step? [Y/n]'
    if ([string]::IsNullOrWhiteSpace($ans) -or $ans -match '^[Yy]') {
        $KeepExistingEnv = $true
    }
}

if ($KeepExistingEnv) {
    Write-Ok 'Keeping existing .env.'
    # Parse the .env so we know PORT / FILE_STORE_PATH later.
    $envVars = @{}
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') {
            $envVars[$Matches[1]] = $Matches[2]
        }
    }
    $DatabaseUrl   = $envVars['DATABASE_URL']
    $FileStorePath = $envVars['FILE_STORE_PATH']
    $Port          = if ($envVars['PORT']) { $envVars['PORT'] } else { '3000' }
} else {
    $DefaultFileStore = Join-Path $HOME 'political-society-files'

    $DbName = Read-Host '  Database name [political_society]'
    if ([string]::IsNullOrWhiteSpace($DbName)) { $DbName = 'political_society' }

    $DbUser = Read-Host '  Database username [psdb_app]'
    if ([string]::IsNullOrWhiteSpace($DbUser)) { $DbUser = 'psdb_app' }

    while ($true) {
        $sec1 = Read-Host "  Choose a strong password for $DbUser" -AsSecureString
        $sec2 = Read-Host '  Type the same password again' -AsSecureString
        $b1 = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec1)
        $b2 = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec2)
        $p1 = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($b1)
        $p2 = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($b2)
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b1) | Out-Null
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b2) | Out-Null
        if ([string]::IsNullOrEmpty($p1)) {
            Write-Err 'Password cannot be empty.'
        } elseif ($p1 -ne $p2) {
            Write-Err 'The two passwords do not match. Try again.'
        } else {
            $DbPass = $p1
            break
        }
    }

    $FileStorePath = Read-Host "  Folder for uploaded files [$DefaultFileStore]"
    if ([string]::IsNullOrWhiteSpace($FileStorePath)) { $FileStorePath = $DefaultFileStore }

    $Port = Read-Host '  Port the website listens on [3000]'
    if ([string]::IsNullOrWhiteSpace($Port)) { $Port = '3000' }

    $DatabaseUrl = "postgresql://${DbUser}:${DbPass}@localhost:5432/${DbName}"
}

# ---- step 4: create database + user ---------------------------------------
if (-not $KeepExistingEnv) {
    Write-Step 4 'creating the database and user inside PostgreSQL'

    Write-Host 'PostgreSQL will prompt for the postgres user password you set during install.'
    Write-Host ''

    # Escape any single quote in the chosen password for the SQL literal.
    $sqlPass = $DbPass -replace "'", "''"

    $sql = @"
DO `$do`$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DbUser') THEN
    CREATE ROLE "$DbUser" LOGIN PASSWORD '$sqlPass';
  ELSE
    ALTER ROLE "$DbUser" WITH LOGIN PASSWORD '$sqlPass';
  END IF;
END
`$do`$;

SELECT 'CREATE DATABASE "$DbName" OWNER "$DbUser"'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$DbName')\gexec

GRANT ALL PRIVILEGES ON DATABASE "$DbName" TO "$DbUser";
"@

    $tmp = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $tmp -Value $sql -Encoding ASCII
    & psql -U postgres -d postgres -h localhost -v ON_ERROR_STOP=1 -f $tmp
    $rc = $LASTEXITCODE
    Remove-Item $tmp -ErrorAction SilentlyContinue
    if ($rc -ne 0) {
        Stop-Setup 'Could not create the database. Check that PostgreSQL is running and the postgres password was correct.'
    }

    $grant = "GRANT ALL ON SCHEMA public TO `"$DbUser`";"
    $tmp2 = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $tmp2 -Value $grant -Encoding ASCII
    & psql -U postgres -d $DbName -h localhost -v ON_ERROR_STOP=1 -f $tmp2 | Out-Null
    Remove-Item $tmp2 -ErrorAction SilentlyContinue

    Write-Ok "Database `"$DbName`" and user `"$DbUser`" are ready."
}

# ---- step 5: write the .env file ------------------------------------------
if (-not $KeepExistingEnv) {
    Write-Step 5 'writing the .env settings file'

    $envBody = @"
# Generated by setup.ps1 on $(Get-Date)
DATABASE_URL=$DatabaseUrl
FILE_STORE_PATH=$FileStorePath
PORT=$Port
NODE_ENV=development
COOKIE_SECURE=false
"@
    Set-Content -Path $EnvFile -Value $envBody -Encoding ASCII
    Write-Ok "Wrote $EnvFile"
}

# ---- step 6: build the schema ---------------------------------------------
Write-Step 6 'building the database structure'

$env:PGPASSWORD = $null  # don't let any old value interfere
& psql $DatabaseUrl -v ON_ERROR_STOP=1 -f "$ProjectDir\db\schema.sql" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Stop-Setup 'Could not apply the database schema. Check the database password in .env.'
}
Write-Ok 'Database schema applied.'

# ---- step 7: create the uploads folder ------------------------------------
Write-Step 7 'creating the uploads folder'

if (-not (Test-Path $FileStorePath)) {
    New-Item -ItemType Directory -Force -Path $FileStorePath | Out-Null
}
Write-Ok "Uploads folder ready: $FileStorePath"

# ---- step 8: seed the Root account ----------------------------------------
Write-Step 8 'creating the Root administrator account'

# Load .env into the current process so seed-root.js can read DATABASE_URL.
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') {
        Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
    }
}

& node "$ProjectDir\scripts\seed-root.js"
if ($LASTEXITCODE -ne 0) {
    Write-Warn "seed-root did not create an account (exit code $LASTEXITCODE)."
    Write-Warn 'If the message above says a Root already exists, that is fine -- it was left alone.'
    Write-Warn 'Any OTHER error above means the Root was NOT created; fix it and re-run `node scripts\seed-root.js`.'
}

# ---- done -----------------------------------------------------------------
Write-Host ''
Write-Host '----------------------------------------------------------------'
Write-Ok   '  SETUP COMPLETE'
Write-Host '----------------------------------------------------------------'
Write-Host ''
Write-Host 'Start the website by running:'
Write-Host ''
Write-Host '    powershell -ExecutionPolicy Bypass -File start.ps1'
Write-Host ''
Write-Host "Then sign in at http://localhost:$Port/login.html using the Root"
Write-Host 'username and the temporary password shown above. You will be asked to'
Write-Host 'set a new password on first sign-in.'
Write-Host ''
