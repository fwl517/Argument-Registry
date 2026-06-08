#!/usr/bin/env bash
# ============================================================================
# Political Society Database — daily start script (macOS / Linux)
# ----------------------------------------------------------------------------
# Run this every time you want to bring the website up:
#
#     bash start.sh
#
# It will:
#   1. Check that PostgreSQL is running.
#   2. Start the Node web server.
#   3. Open your default browser at the site once it's ready.
#
# Press Ctrl+C in this terminal to stop the website.
# ============================================================================

set -u
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

bold()   { printf '\033[1m%s\033[0m\n' "$1"; }
green()  { printf '\033[32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[33m%s\033[0m\n' "$1"; }
red()    { printf '\033[31m%s\033[0m\n' "$1"; }

if [ ! -f "$PROJECT_DIR/.env" ]; then
  red "No .env file found. Run \`bash setup.sh\` first."
  exit 1
fi

# Load .env so we know PORT and DATABASE_URL.
set -a; . "$PROJECT_DIR/.env"; set +a
PORT="${PORT:-3000}"

# ---- 1. PostgreSQL reachable? --------------------------------------------
bold "Checking PostgreSQL…"

PG_OK=0
if command -v pg_isready >/dev/null 2>&1; then
  if pg_isready -q -h localhost; then PG_OK=1; fi
else
  # No pg_isready — try a tiny connect.
  if psql "$DATABASE_URL" -c 'SELECT 1' >/dev/null 2>&1; then PG_OK=1; fi
fi

if [ "$PG_OK" -eq 0 ]; then
  red "PostgreSQL is not running, or .env points at a database it can't reach."
  echo
  echo "Start PostgreSQL, then try again:"
  case "$(uname -s)" in
    Darwin) echo "    macOS (Homebrew):  brew services start postgresql@15" ;;
    Linux)  echo "    Linux (systemd):   sudo systemctl start postgresql" ;;
  esac
  exit 1
fi
green "PostgreSQL is up."

# ---- 2. open the browser shortly after the server starts -----------------
URL="http://localhost:${PORT}/"

open_browser() {
  sleep 2
  case "$(uname -s)" in
    Darwin) open "$URL" 2>/dev/null ;;
    Linux)
      if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
      elif command -v gnome-open >/dev/null 2>&1; then gnome-open "$URL" >/dev/null 2>&1
      fi
      ;;
  esac
}
open_browser &
BROWSER_PID=$!

# Make sure the background browser-launcher doesn't outlive us.
trap 'kill "$BROWSER_PID" 2>/dev/null || true' EXIT

# ---- 3. run the server (foreground) --------------------------------------
echo
bold "Starting the website at $URL"
yellow "Press Ctrl+C in this window to stop it."
echo

exec npm start
