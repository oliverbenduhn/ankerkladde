#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PLAYWRIGHT_PORT:-4173}"
HOST="${PLAYWRIGHT_HOST:-127.0.0.1}"
DATA_DIR="${ROOT_DIR}/.tmp/ui-test-data"

if ! command -v php >/dev/null 2>&1; then
  echo "Fehler: php ist nicht installiert oder nicht im PATH." >&2
  exit 1
fi

if ! php -m | grep -qi '^pdo_sqlite$'; then
  echo "Fehler: die lokale PHP-Installation hat kein pdo_sqlite-Modul." >&2
  echo "Bitte pdo_sqlite aktivieren oder die Tests in einer PHP-/Docker-Umgebung mit SQLite-Support starten." >&2
  exit 1
fi

rm -rf "${DATA_DIR}"
mkdir -p "${DATA_DIR}"

export EINKAUF_DATA_DIR="${DATA_DIR}"
export ANKERKLADDE_CANONICAL_HOST=""
export EINKAUF_ADMIN_USER="playwright-admin"
export EINKAUF_ADMIN_PASS="playwright-pass"
export EINKAUF_REGULAR_USER="playwright-user"
export EINKAUF_REGULAR_PASS="playwright-pass"
export ANKERKLADDE_WS_CLIENT_URL="${ANKERKLADDE_WS_CLIENT_URL:-ws://${HOST}:3000}"
export WS_NOTIFY_URL="${WS_NOTIFY_URL:-http://127.0.0.1:3000/notify}"

php "${ROOT_DIR}/scripts/create-admin.php" >/dev/null
EINKAUF_DEMO_USER="${EINKAUF_REGULAR_USER}" php "${ROOT_DIR}/scripts/seed-demo-data.php" >/dev/null

exec php -S "${HOST}:${PORT}" -t "${ROOT_DIR}/public"
