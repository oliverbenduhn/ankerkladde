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
ADD_SECOND_BODY="$TMP_DIR/add-second.json"
REORDER_BODY="$TMP_DIR/reorder.json"
REORDERED_LIST_BODY="$TMP_DIR/reordered-list.json"
INVALID_REORDER_BODY="$TMP_DIR/reorder-invalid.json"
DUPLICATE_REORDER_BODY="$TMP_DIR/reorder-duplicate.json"
UPDATE_BODY="$TMP_DIR/update.json"
INVALID_UPDATE_BODY="$TMP_DIR/update-invalid.json"
TOGGLE_BODY="$TMP_DIR/toggle.json"
POST_TOGGLE_LIST_BODY="$TMP_DIR/post-toggle-list.json"
CLEAR_BODY="$TMP_DIR/clear.json"
POST_CLEAR_LIST_BODY="$TMP_DIR/post-clear-list.json"
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

[[ "$(status_code "$ADD_SECOND_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d 'name=Brot&quantity=1' "http://127.0.0.1:$PORT/api.php?action=add")" == "201" ]]
SECOND_ITEM_ID="$(sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' "$ADD_SECOND_BODY" | head -n 1)"

if [[ -z "$SECOND_ITEM_ID" ]]; then
    echo "Zweite Artikel-ID konnte nicht aus der Add-Antwort gelesen werden." >&2
    exit 1
fi

[[ "$(status_code "$REORDER_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d "ids[]=$SECOND_ITEM_ID&ids[]=$ITEM_ID" "http://127.0.0.1:$PORT/api.php?action=reorder")" == "200" ]]
grep -q 'Reihenfolge aktualisiert' "$REORDER_BODY"

[[ "$(status_code "$INVALID_REORDER_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d "ids[]=$SECOND_ITEM_ID" "http://127.0.0.1:$PORT/api.php?action=reorder")" == "422" ]]
grep -q 'Reihenfolge passt nicht zur aktuellen Liste' "$INVALID_REORDER_BODY"

[[ "$(status_code "$DUPLICATE_REORDER_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d "ids[]=$SECOND_ITEM_ID&ids[]=$SECOND_ITEM_ID" "http://127.0.0.1:$PORT/api.php?action=reorder")" == "422" ]]
grep -q 'Ungültige Reihenfolge' "$DUPLICATE_REORDER_BODY"

[[ "$(status_code "$REORDERED_LIST_BODY" "http://127.0.0.1:$PORT/api.php?action=list")" == "200" ]]

SECOND_POS="$(grep -bo "\"id\":$SECOND_ITEM_ID" "$REORDERED_LIST_BODY" | head -n 1 | cut -d: -f1)"
FIRST_POS="$(grep -bo "\"id\":$ITEM_ID" "$REORDERED_LIST_BODY" | head -n 1 | cut -d: -f1)"

if [[ -z "$SECOND_POS" || -z "$FIRST_POS" || "$SECOND_POS" -ge "$FIRST_POS" ]]; then
    echo "Neu sortierte Reihenfolge wurde nicht korrekt gespeichert." >&2
    exit 1
fi

[[ "$(status_code "$UPDATE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d "id=$ITEM_ID&name=Hafermilch&quantity=3x" "http://127.0.0.1:$PORT/api.php?action=update")" == "200" ]]
grep -q 'Artikel aktualisiert' "$UPDATE_BODY"

[[ "$(status_code "$INVALID_UPDATE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d "id=$ITEM_ID&name=   &quantity=1" "http://127.0.0.1:$PORT/api.php?action=update")" == "422" ]]
grep -q 'Bitte gib einen Artikelnamen ein' "$INVALID_UPDATE_BODY"

[[ "$(status_code "$REORDERED_LIST_BODY" "http://127.0.0.1:$PORT/api.php?action=list")" == "200" ]]
grep -q "\"name\":\"Hafermilch\"" "$REORDERED_LIST_BODY"
grep -q "\"quantity\":\"3x\"" "$REORDERED_LIST_BODY"

[[ "$(status_code "$TOGGLE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d "id=$ITEM_ID&done=1" "http://127.0.0.1:$PORT/api.php?action=toggle")" == "200" ]]
grep -q 'Status aktualisiert' "$TOGGLE_BODY"

[[ "$(status_code "$POST_TOGGLE_LIST_BODY" "http://127.0.0.1:$PORT/api.php?action=list")" == "200" ]]
SECOND_POS="$(grep -bo "\"id\":$SECOND_ITEM_ID" "$POST_TOGGLE_LIST_BODY" | head -n 1 | cut -d: -f1)"
FIRST_POS="$(grep -bo "\"id\":$ITEM_ID" "$POST_TOGGLE_LIST_BODY" | head -n 1 | cut -d: -f1)"

if [[ -z "$SECOND_POS" || -z "$FIRST_POS" || "$SECOND_POS" -ge "$FIRST_POS" ]]; then
    echo "Reihenfolge blieb nach dem Toggle nicht stabil." >&2
    exit 1
fi

[[ "$(status_code "$CLEAR_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST "http://127.0.0.1:$PORT/api.php?action=clear")" == "200" ]]
grep -q '"deleted":1' "$CLEAR_BODY"

[[ "$(status_code "$POST_CLEAR_LIST_BODY" "http://127.0.0.1:$PORT/api.php?action=list")" == "200" ]]
grep -q "\"id\":$SECOND_ITEM_ID" "$POST_CLEAR_LIST_BODY"
if grep -q "\"id\":$ITEM_ID" "$POST_CLEAR_LIST_BODY"; then
    echo "Erledigter Artikel wurde durch clear nicht entfernt." >&2
    exit 1
fi

[[ "$(status_code "$NOT_FOUND_BODY" "http://127.0.0.1:$PORT/data/einkaufsliste.db")" == "404" ]]
[[ "$(status_code "$NOT_FOUND_BODY" "http://127.0.0.1:$PORT/.git/config")" == "404" ]]

echo "Smoke-Test erfolgreich."
