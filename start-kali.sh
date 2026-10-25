#!/usr/bin/env bash
# ===========================================================================
#  INFRAvx / Infracentra - Kali Linux launcher (DEMO MODE)
#  Usage:  ./start-kali.sh
#  Starts the Vite DEV server on port 5173. Demo Mode needs NO backend,
#  NO Docker, NO Postgres: all 16 services + Advanced Ticketing are
#  simulated in the browser. On the login page keep "DEMO MODE" ON.
# ===========================================================================
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. Install it first:"
  echo "  sudo apt update && sudo apt install -y nodejs npm   # or: nvm install --lts"
  exit 1
fi

[ -d node_modules ] || { echo "[SETUP] First run: installing dependencies..."; npm install; }

echo
echo " Starting DEMO at  http://localhost:5173"
echo " Login page -> keep \"DEMO MODE\" toggled ON, pick any demo account."
echo " (Kali browser: http://127.0.0.1:5173 — always use 127.0.0.1, not localhost)"
echo
npm run dev
