#!/usr/bin/env bash
# ============================================================================
# Political Society Database — first-time setup script (macOS / Linux)
# ----------------------------------------------------------------------------
# Run this once, in a terminal, from inside the project folder:
#
#     bash setup.sh
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
# Re-running is safe — the script skips steps that are already done.
# ============================================================================

set -u  # treat unset variables as errors
# (we deliberately do NOT use `set -e` — we want to print friendly errors
# instead of dying silently if a step fails.)

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# ---- pretty printing -------------------------------------------------------
bold()   { printf '\033[1m%s\033[0m\n' "$1"; }
green()  { printf '\033[32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[33m%s\033[0m\n' "$1"; }
red()    { printf '\033[31m%s\033[0m\n' "$1"; }
rule()   { printf '%s\n' '----------------------------------------------------------------'; }

step() {
  echo
  rule
  bold "  $1"
  rule
}

die() {
  red "ERROR: $1"
  echo
  echo "Setup did not finish. Fix the problem above and run \`bash setup.sh\` again."
  exit 1
}

# ---- step 1: check prerequisites ------------------------------------------
step "Step 1 of 8 — checking prerequisites"

if ! command -v node >/dev/null 2>&1; then
  red "Node.js is not installed (or not on your PATH)."
  echo
  echo "Install Node.js 20 or newer from https://nodejs.org (pick the LTS"
  echo "download), then run \`bash setup.sh\` again."
  exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 20 ]; then
  red "Node.js version $(node --version) is too old (need 20 or newer)."
  echo "Install a newer version from https://nodejs.org and run \`bash setup.sh\` again."
  exit 1
fi
green "Node.js $(node --version) — OK"

if ! command -v psql >/dev/null 2>&1; then
  red "PostgreSQL is not installed (or \`psql\` is not on your PATH)."
  echo
  echo "Install PostgreSQL 15 or newer:"
  echo "  • Official installer:  https://www.postgresql.org/download/"
  echo "  • macOS (Homebrew):    brew install postgresql@15 && brew services start postgresql@15"
  echo "  • Debian/Ubuntu:       sudo apt update && sudo apt install postgresql"
  echo
  echo "Then run \`bash setup.sh\` again."
  exit 1
fi
green "PostgreSQL $(psql --version | awk '{print $3}') — OK"

# ---- step 2: install npm dependencies -------------------------------------
step "Step 2 of 8 — installing project dependencies"

if [ -d "$PROJECT_DIR/node_modules" ]; then
  yellow "node_modules already exists — re-running \`npm install\` to make sure it's up to date."
fi
npm install || die "\`npm install\` failed. Check the message above (usually a network problem)."
green "Dependencies installed."

# ---- step 3: collect configuration ----------------------------------------
step "Step 3 of 8 — settings"

echo "Answer a couple of questions. Press Enter to accept the [default] in brackets."
echo

# Existing .env handling
ENV_FILE="$PROJECT_DIR/.env"
KEEP_EXISTING_ENV=0
if [ -f "$ENV_FILE" ]; then
  yellow "A .env file already exists at $ENV_FILE"
  read -r -p "  Keep it and skip the database-creation step? [Y/n] " ans
  case "${ans:-Y}" in
    [Nn]*) KEEP_EXISTING_ENV=0 ;;
    *)     KEEP_EXISTING_ENV=1 ;;
  esac
fi

if [ "$KEEP_EXISTING_ENV" -eq 1 ]; then
  green "Keeping existing .env."
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
else
  # Pick a sensible default for the uploads folder.
  DEFAULT_FILE_STORE="$HOME/political-society-files"

  read -r -p "  Database name [political_society]: " DB_NAME
  DB_NAME="${DB_NAME:-political_society}"

  read -r -p "  Database username [psdb_app]: " DB_USER
  DB_USER="${DB_USER:-psdb_app}"

  while :; do
    read -r -s -p "  Choose a strong password for $DB_USER (will not echo): " DB_PASS
    echo
    read -r -s -p "  Type the same password again: " DB_PASS2
    echo
    if [ -z "$DB_PASS" ]; then
      red "Password cannot be empty."
    elif [ "$DB_PASS" != "$DB_PASS2" ]; then
      red "The two passwords don't match. Try again."
    else
      break
    fi
  done

  read -r -p "  Folder for uploaded files [$DEFAULT_FILE_STORE]: " FILE_STORE_PATH
  FILE_STORE_PATH="${FILE_STORE_PATH:-$DEFAULT_FILE_STORE}"

  read -r -p "  Port the website listens on [3000]: " PORT
  PORT="${PORT:-3000}"

  DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
fi

# ---- step 4: create database + user ---------------------------------------
if [ "$KEEP_EXISTING_ENV" -eq 0 ]; then
  step "Step 4 of 8 — creating the database and user inside PostgreSQL"

  echo "This step needs access to PostgreSQL as a superuser."
  echo "On Debian/Ubuntu this usually means running \`sudo -u postgres psql\`;"
  echo "on the official installer / Windows it means the \`postgres\` superuser password."
  echo

  # Build the SQL we want to run. Idempotent: we check for existence first.
  SQL=$(cat <<EOF
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE "${DB_USER}" LOGIN PASSWORD '${DB_PASS//\'/\'\'}';
  ELSE
    ALTER ROLE "${DB_USER}" WITH LOGIN PASSWORD '${DB_PASS//\'/\'\'}';
  END IF;
END
\$\$;

SELECT 'CREATE DATABASE "${DB_NAME}" OWNER "${DB_USER}"'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}')\gexec

GRANT ALL PRIVILEGES ON DATABASE "${DB_NAME}" TO "${DB_USER}";
EOF
  )

  SCHEMA_GRANT="GRANT ALL ON SCHEMA public TO \"${DB_USER}\";"

  # Try peer auth first (works out of the box on Debian/Ubuntu apt installs).
  CREATED=0
  if command -v sudo >/dev/null 2>&1 && sudo -n -u postgres psql -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
    yellow "Using \`sudo -u postgres psql\` (peer auth)."
    echo "$SQL"          | sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 >/dev/null && CREATED=1
    echo "$SCHEMA_GRANT" | sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 >/dev/null
  fi

  # Try direct connection as `postgres` (works on macOS Homebrew where the
  # current user is the DB superuser, and on the official installer when the
  # user types the postgres password).
  if [ "$CREATED" -eq 0 ]; then
    yellow "Trying to connect as the \`postgres\` superuser."
    echo "  (PostgreSQL may prompt for the postgres user's password.)"
    if echo "$SQL" | psql -U postgres -d postgres -v ON_ERROR_STOP=1 -h localhost >/dev/null; then
      CREATED=1
      echo "$SCHEMA_GRANT" | psql -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -h localhost >/dev/null
    fi
  fi

  if [ "$CREATED" -eq 0 ]; then
    die "Could not create the database. Make sure PostgreSQL is running and you can log in as the \`postgres\` superuser."
  fi
  green "Database \"$DB_NAME\" and user \"$DB_USER\" are ready."
fi

# ---- step 5: write the .env file ------------------------------------------
if [ "$KEEP_EXISTING_ENV" -eq 0 ]; then
  step "Step 5 of 8 — writing the .env settings file"

  cat > "$ENV_FILE" <<EOF
# Generated by setup.sh on $(date)
DATABASE_URL=${DATABASE_URL}
FILE_STORE_PATH=${FILE_STORE_PATH}
PORT=${PORT}
NODE_ENV=development
COOKIE_SECURE=false
EOF
  chmod 600 "$ENV_FILE"
  green "Wrote $ENV_FILE (readable only by you)."
fi

# ---- step 6: build the schema ---------------------------------------------
step "Step 6 of 8 — building the database structure"

if ! psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$PROJECT_DIR/db/schema.sql" >/dev/null; then
  die "Could not apply the database schema. Check that the database password in .env matches what you set."
fi
green "Database schema applied."

# ---- step 7: create the uploads folder ------------------------------------
step "Step 7 of 8 — creating the uploads folder"

mkdir -p "$FILE_STORE_PATH" || die "Could not create $FILE_STORE_PATH"
green "Uploads folder ready: $FILE_STORE_PATH"

# ---- step 8: seed the Root account ----------------------------------------
step "Step 8 of 8 — creating the Root administrator account"

# Run seed-root with .env loaded into the environment. It will refuse (and
# exit non-zero) if a Root already exists, which is fine on a re-run.
set -a; . "$ENV_FILE"; set +a
if node "$PROJECT_DIR/scripts/seed-root.js"; then
  :  # success — the script printed the temporary password.
else
  yellow "(seed-root reported that a Root account already exists — leaving it alone.)"
fi

# ---- done -----------------------------------------------------------------
echo
rule
green "  SETUP COMPLETE"
rule
echo
echo "Start the website by running:"
echo
echo "    bash start.sh"
echo
echo "Then sign in at http://localhost:${PORT:-3000}/login.html using the Root"
echo "username and the temporary password shown above. You will be asked to"
echo "set a new password on first sign-in."
echo
