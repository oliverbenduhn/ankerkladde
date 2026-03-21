#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-18080}"
TMP_DIR="$(mktemp -d)"
COOKIE_JAR="$TMP_DIR/cookies.txt"
INDEX_HTML="$TMP_DIR/index.html"
SERVER_LOG="$TMP_DIR/server.log"
TEST_DATA_DIR="$TMP_DIR/data"

cleanup() {
    if [[ -n "${SERVER_PID:-}" ]]; then
        kill "$SERVER_PID" >/dev/null 2>&1 || true
        wait "$SERVER_PID" >/dev/null 2>&1 || true
    fi
    rm -rf "$TMP_DIR"
}

trap cleanup EXIT

mkdir -p "$TEST_DATA_DIR"

EINKAUF_DATA_DIR="$TEST_DATA_DIR" php -S "127.0.0.1:$PORT" -t "$ROOT_DIR/public" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
        break
    fi
    sleep 0.25
done

curl -fsS -c "$COOKIE_JAR" "http://127.0.0.1:$PORT/" >"$INDEX_HTML"
CSRF_TOKEN="$(sed -n 's/.*name="csrf-token" content="\([^"]*\)".*/\1/p' "$INDEX_HTML" | head -n 1)"

if [[ -z "$CSRF_TOKEN" ]]; then
    echo "CSRF-Token konnte nicht aus der HTML-Antwort gelesen werden." >&2
    exit 1
fi

status_code() {
    local output_file=$1
    shift
    curl -sS -o "$output_file" -w '%{http_code}' "$@"
}

LIST_BODY="$TMP_DIR/list.json"
ADD_BODY="$TMP_DIR/add.json"
TOGGLE_BODY="$TMP_DIR/toggle.json"
CLEAR_BODY="$TMP_DIR/clear.json"
FORBIDDEN_BODY="$TMP_DIR/forbidden.json"
NOT_FOUND_BODY="$TMP_DIR/not-found.txt"

[[ "$(status_code "$LIST_BODY" "http://127.0.0.1:$PORT/api.php?action=list")" == "200" ]]
grep -q '"items"' "$LIST_BODY"

[[ "$(status_code "$FORBIDDEN_BODY" -X POST -d 'name=Milch' "http://127.0.0.1:$PORT/api.php?action=add")" == "403" ]]
grep -q 'Sicherheits-Token' "$FORBIDDEN_BODY"

[[ "$(status_code "$ADD_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d 'name=Milch&quantity=2x' "http://127.0.0.1:$PORT/api.php?action=add")" == "201" ]]
ITEM_ID="$(sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' "$ADD_BODY" | head -n 1)"

if [[ -z "$ITEM_ID" ]]; then
    echo "Artikel-ID konnte nicht aus der Add-Antwort gelesen werden." >&2
    exit 1
fi

[[ "$(status_code "$TOGGLE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d "id=$ITEM_ID&done=1" "http://127.0.0.1:$PORT/api.php?action=toggle")" == "200" ]]
grep -q 'Status aktualisiert' "$TOGGLE_BODY"

[[ "$(status_code "$CLEAR_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST "http://127.0.0.1:$PORT/api.php?action=clear")" == "200" ]]
grep -q '"deleted":1' "$CLEAR_BODY"

[[ "$(status_code "$NOT_FOUND_BODY" "http://127.0.0.1:$PORT/data/einkaufsliste.db")" == "404" ]]
[[ "$(status_code "$NOT_FOUND_BODY" "http://127.0.0.1:$PORT/.git/config")" == "404" ]]

echo "Smoke-Test erfolgreich."
