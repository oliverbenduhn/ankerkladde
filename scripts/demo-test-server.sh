#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PHP_PORT="${PLAYWRIGHT_PORT:-4173}"
PHP_HOST="${PLAYWRIGHT_HOST:-127.0.0.1}"
WS_PORT="${WS_PORT:-3000}"
WS_HOST="${WS_HOST:-127.0.0.1}"

WS_PID=""

cleanup() {
  if [[ -n "${WS_PID}" ]] && kill -0 "${WS_PID}" >/dev/null 2>&1; then
    kill "${WS_PID}" >/dev/null 2>&1 || true
    wait "${WS_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if ! command -v node >/dev/null 2>&1; then
  echo "Fehler: node ist nicht installiert oder nicht im PATH." >&2
  exit 1
fi

if [[ ! -d "${ROOT_DIR}/websocket-server/node_modules" ]]; then
  echo "Fehler: websocket-server/node_modules fehlt. Bitte zuerst ausführen:" >&2
  echo "  cd websocket-server && npm install" >&2
  exit 1
fi

export WS_HOST
export WS_PORT
export PLAYWRIGHT_HOST="${PHP_HOST}"
export PLAYWRIGHT_PORT="${PHP_PORT}"
export ANKERKLADDE_WS_CLIENT_URL="${ANKERKLADDE_WS_CLIENT_URL:-ws://${WS_HOST}:${WS_PORT}}"
export WS_NOTIFY_URL="${WS_NOTIFY_URL:-http://${WS_HOST}:${WS_PORT}/notify}"

echo "Starte WebSocket: ws://${WS_HOST}:${WS_PORT}"
(cd "${ROOT_DIR}/websocket-server" && npm start) &
WS_PID="$!"

echo "Starte Demo-Testserver: http://${PHP_HOST}:${PHP_PORT}/login.php"
echo "Login: playwright-user / playwright-pass"
exec bash "${ROOT_DIR}/scripts/ui-test-server.sh"
