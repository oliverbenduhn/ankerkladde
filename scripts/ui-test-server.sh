#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PLAYWRIGHT_PORT:-4173}"
HOST="${PLAYWRIGHT_HOST:-127.0.0.1}"
DATA_DIR="${EINKAUF_UI_TEST_DATA_DIR:-${ROOT_DIR}/.tmp/ui-test-data-${PORT}}"
SERVER_LOG="${EINKAUF_UI_TEST_SERVER_LOG:-${ROOT_DIR}/.tmp/ui-test-server-${PORT}.log}"

if ! command -v php >/dev/null 2>&1; then
  echo "Fehler: php ist nicht installiert oder nicht im PATH." >&2
  exit 1
fi

if ! php -r 'exit(extension_loaded("pdo_sqlite") ? 0 : 1);'; then
  echo "Fehler: die lokale PHP-Installation hat kein pdo_sqlite-Modul." >&2
  echo "Bitte pdo_sqlite aktivieren oder die Tests in einer PHP-/Docker-Umgebung mit SQLite-Support starten." >&2
  exit 1
fi

# Vor jeder Bereinigung abbrechen, wenn auf diesem Port bereits ein Server
# laeuft. Sonst koennte ein zweiter Playwright-Start die Daten des aktiven
# Laufs loeschen, bevor php -S an der Portbelegung scheitert.
if php -r '$socket = @stream_socket_client("tcp://'"${HOST}:${PORT}"'", $errno, $errstr, 0.2); exit(is_resource($socket) ? 0 : 1);'; then
  echo "Fehler: ${HOST}:${PORT} wird bereits verwendet. Setze PLAYWRIGHT_PORT auf einen freien Port." >&2
  exit 1
fi

rm -rf "${DATA_DIR}"
mkdir -p "${DATA_DIR}"

export EINKAUF_DATA_DIR="${DATA_DIR}"
export ANKERKLADDE_CANONICAL_HOST=""
export EINKAUF_ADMIN_USER="${EINKAUF_ADMIN_USER:-playwright-admin}"
export EINKAUF_ADMIN_PASS="${EINKAUF_ADMIN_PASS:-playwright-pass}"
export EINKAUF_REGULAR_USER="${EINKAUF_REGULAR_USER:-playwright-user}"
export EINKAUF_REGULAR_PASS="${EINKAUF_REGULAR_PASS:-playwright-pass}"
# ponytail: Flow-Tests teilen sich bei fullyParallel denselben Nutzer und
# raeumen sich so gegenseitig die Vorbedingungen weg (#74). Pro Worker einen
# eigenen Nutzer anlegen, damit parallele Slots nichts voneinander sehen.
PW_WORKER_COUNT="${PW_WORKER_COUNT:-1}"
export ANKERKLADDE_WS_CLIENT_URL="${ANKERKLADDE_WS_CLIENT_URL:-ws://${HOST}:3000}"
export WS_NOTIFY_URL="${WS_NOTIFY_URL:-http://127.0.0.1:3000/notify}"

php "${ROOT_DIR}/scripts/create-admin.php" >/dev/null
EINKAUF_DEMO_RELATIVE_DATES=1 EINKAUF_DEMO_USER="${EINKAUF_REGULAR_USER}" php "${ROOT_DIR}/scripts/seed-demo-data.php" >/dev/null
# Die Referenz bleibt während der Suite unangetastet. Jeder Flow setzt seinen
# Worker-Nutzer daraus zurück, damit Tests derselben Worker-Slot-Queue keine
# Kategorien, Präferenzen oder Items an den Folgetest vererben.
PW_USERS="playwright-template" PW_PASS="${EINKAUF_REGULAR_PASS}" \
    php "${ROOT_DIR}/scripts/create-test-users.php" >/dev/null
EINKAUF_DEMO_RELATIVE_DATES=1 EINKAUF_DEMO_USER="playwright-template" \
    php "${ROOT_DIR}/scripts/seed-demo-data.php" >/dev/null

if [[ "${PW_WORKER_COUNT}" -gt 1 ]]; then
    slotUsers=""
    for slot in $(seq 1 $((PW_WORKER_COUNT - 1))); do
        slotUsers="${slotUsers:+${slotUsers},}playwright-user-${slot}"
    done
    if [[ -n "${slotUsers}" ]]; then
        PW_USERS="${slotUsers}" PW_PASS="${EINKAUF_REGULAR_PASS}" \
            php "${ROOT_DIR}/scripts/create-test-users.php" >/dev/null
        # Slot-User brauchen denselben Ausgangsbestand wie playwright-user,
        # sonst laufen Flows auf Slot > 0 gegen eine leere Liste.
        for slot in $(seq 1 $((PW_WORKER_COUNT - 1))); do
            EINKAUF_DEMO_RELATIVE_DATES=1 EINKAUF_DEMO_USER="playwright-user-${slot}" \
                php "${ROOT_DIR}/scripts/seed-demo-data.php" >/dev/null
        done
    fi
fi

# Bewusst ohne PHP_CLI_SERVER_WORKERS: mehrere Server-Prozesse auf derselben
# SQLite-Datei liessen quer durch die Suite Requests scheitern (#74).
# Nur das requestweise PHP-Server-Protokoll landet in einer portisolierten
# Datei. Fehler aus Voraussetzungen und Seed bleiben oben auf stderr sichtbar.
mkdir -p "$(dirname "${SERVER_LOG}")"
: > "${SERVER_LOG}"
exec php -S "${HOST}:${PORT}" -t "${ROOT_DIR}/public" 2>>"${SERVER_LOG}"
