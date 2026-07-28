#!/usr/bin/env bash
# Eigenstaendiger Test fuer den Revisionsvertrag normaler Item-Bearbeitung (#61).
# Prueft die 5 Acceptance Criteria:
# 1. Items beginnen mit Revision 1; Create-Antwort enthaelt die Revision.
# 2. CAS-Update erhoeht die Revision genau einmal.
# 3. 428 (revision_required), 422 (revision_invalid), 409 (item_revision_conflict).
# 4. Browser uebernimmt nach Erfolg direkt das vollstaendige kanonische Item.
# 5. API-Key-Clients erhalten denselben Vertrag wie Browser-Sessions.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-18097}"
TMP_DIR="$(mktemp -d)"
COOKIE_JAR="$TMP_DIR/cookies.txt"
TEST_DATA_DIR="$TMP_DIR/data"
API_KEY="revision-test-api-key-xyz"

cleanup() {
    if [[ -n "${SERVER_PID:-}" ]]; then
        kill "$SERVER_PID" >/dev/null 2>&1 || true
        wait "$SERVER_PID" >/dev/null 2>&1 || true
    fi
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$TEST_DATA_DIR"
SERVER_LOG="$TMP_DIR/server.log"

PHP_CLI_SERVER_WORKERS=2 EINKAUF_DATA_DIR="$TEST_DATA_DIR" EINKAUF_TRUST_PROXY_HEADERS=0 php \
    -d upload_max_filesize=500M \
    -d post_max_size=520M \
    -S "127.0.0.1:$PORT" \
    -t "$ROOT_DIR/public" "$ROOT_DIR/public/router.php" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:$PORT/login.php" >/dev/null 2>&1; then
        break
    fi
    sleep 0.25
done

# Test-User anlegen + API-Key setzen
EINKAUF_DATA_DIR="$TEST_DATA_DIR" \
EINKAUF_ADMIN_USER=testadmin \
EINKAUF_ADMIN_PASS=adminpass123 \
EINKAUF_REGULAR_USER=testuser \
EINKAUF_REGULAR_PASS=userpass123 \
php "$ROOT_DIR/scripts/create-admin.php" >/dev/null

EINKAUF_DATA_DIR="$TEST_DATA_DIR" php -r '
    require $argv[1] . "/security.php";
    require $argv[1] . "/db.php";
    $db = getDatabase();
    $stmt = $db->prepare("UPDATE users SET api_key = :api_key, api_key_created_at = CURRENT_TIMESTAMP WHERE username = :username");
    $stmt->execute([":api_key" => $argv[2], ":username" => "testuser"]);
' "$ROOT_DIR" "$API_KEY" >/dev/null

# Login als testuser
LOGIN_HTML="$TMP_DIR/login.html"
curl -fsS -c "$COOKIE_JAR" "http://127.0.0.1:$PORT/login.php" >"$LOGIN_HTML"
LOGIN_CSRF="$(sed -n 's/.*name="csrf_token" value="\([^"]*\)".*/\1/p' "$LOGIN_HTML" | head -n 1)"
[[ -n "$LOGIN_CSRF" ]] || { echo "Login-CSRF fehlt." >&2; exit 1; }

INDEX_HTML="$TMP_DIR/index.html"
curl -fsS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST \
    --data-urlencode "username=testuser" \
    --data-urlencode "password=userpass123" \
    --data-urlencode "csrf_token=$LOGIN_CSRF" \
    -L "http://127.0.0.1:$PORT/login.php" >"$INDEX_HTML"
CSRF_TOKEN="$(sed -n 's/.*name="csrf-token" content="\([^"]*\)".*/\1/p' "$INDEX_HTML" | head -n 1)"
[[ -n "$CSRF_TOKEN" ]] || { echo "Index-CSRF fehlt." >&2; exit 1; }

# Kategorien laden (legt daily_notes automatisch an)
CATS_BODY="$TMP_DIR/cats.json"
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=categories_list" >"$CATS_BODY"
SHOPPING_CATEGORY_ID="$(php -r '
    $payload = json_decode(file_get_contents($argv[1]), true);
    foreach (($payload["categories"] ?? []) as $cat) {
        if (($cat["type"] ?? "") === "list_quantity") { echo (int) ($cat["id"] ?? 0); exit; }
    }
    exit(1);
' "$CATS_BODY")"
[[ -n "$SHOPPING_CATEGORY_ID" ]] || { echo "Einkaufs-Kategorie fehlt." >&2; exit 1; }

# AC1: Create-Antwort enthaelt revision=1
ADD_BODY="$TMP_DIR/add.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "category_id=$SHOPPING_CATEGORY_ID" \
    --data-urlencode 'name=Milch' \
    --data-urlencode 'quantity=2x' \
    -w '%{http_code}' \
    -o "$ADD_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=add")" == "201" ]]
ITEM_ID="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["id"] ?? 0);' "$ADD_BODY")"
ITEM_REVISION="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["revision"] ?? 0);' "$ADD_BODY")"
[[ "$ITEM_ID" -gt 0 ]] || { echo "Add lieferte keine ID." >&2; exit 1; }
[[ "$ITEM_REVISION" == "1" ]] || { echo "Add lieferte revision=$ITEM_REVISION, erwartet 1." >&2; exit 1; }
echo "AC1 ok: revision=1 in Create-Antwort"

# AC3 Teil 1: 428 bei fehlender expected_revision
MISSING_BODY="$TMP_DIR/missing.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "id=$ITEM_ID" \
    --data-urlencode 'name=Should-Fail-428' \
    -w '%{http_code}' \
    -o "$MISSING_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=update")" == "428" ]]
grep -q '"error_key":"error.revision_required"' "$MISSING_BODY" || { echo "428-Body hat falschen error_key." >&2; exit 1; }
echo "AC3 ok: 428 revision_required"

# AC3 Teil 2: 422 bei ungueltiger expected_revision (0)
INVALID_BODY="$TMP_DIR/invalid.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "id=$ITEM_ID" \
    --data-urlencode 'name=Should-Fail-422' \
    --data-urlencode 'expected_revision=0' \
    -w '%{http_code}' \
    -o "$INVALID_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=update")" == "422" ]]
grep -q '"error_key":"error.revision_invalid"' "$INVALID_BODY" || { echo "422-Body hat falschen error_key." >&2; exit 1; }
echo "AC3 ok: 422 revision_invalid"

# AC2 + AC4: CAS-Happy-Path, Revision steigt auf 2, vollstaendiges Item in Response
HAPPY_BODY="$TMP_DIR/happy.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "id=$ITEM_ID" \
    --data-urlencode 'name=Hafermilch' \
    --data-urlencode 'quantity=3x' \
    --data-urlencode "expected_revision=$ITEM_REVISION" \
    -w '%{http_code}' \
    -o "$HAPPY_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=update")" == "200" ]]
php -r '
    $payload = json_decode(file_get_contents($argv[1]), true);
    $item = $payload["item"] ?? null;
    if (!is_array($item)) { fwrite(STDERR, "Update-Antwort enthaelt kein item (AC4).\n"); exit(1); }
    $expectedId = (int) $argv[2];
    if ((int) ($item["id"] ?? 0) !== $expectedId) { fwrite(STDERR, "item.id falsch.\n"); exit(1); }
    $expectedRev = (int) $argv[3];
    if ((int) ($item["revision"] ?? 0) !== $expectedRev + 1) {
        fwrite(STDERR, "Revision nicht um genau 1 erhoeht (AC2).\n");
        exit(1);
    }
' "$HAPPY_BODY" "$ITEM_ID" "$ITEM_REVISION"
echo "AC2+AC4 ok: CAS erhoeht revision auf 2 und liefert vollstaendiges item"

# AC3 Teil 3: 409 Konflikt mit altem expected_revision
CONFLICT_BODY="$TMP_DIR/conflict.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "id=$ITEM_ID" \
    --data-urlencode 'name=Should-Not-Persist' \
    --data-urlencode 'expected_revision=1' \
    -w '%{http_code}' \
    -o "$CONFLICT_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=update")" == "409" ]]
php -r '
    $payload = json_decode(file_get_contents($argv[1]), true);
    if (($payload["error_key"] ?? "") !== "error.item_revision_conflict") {
        fwrite(STDERR, "Konflikt-Body hat falschen error_key.\n"); exit(1);
    }
    if ((int) ($payload["expected_revision"] ?? -1) !== 1) {
        fwrite(STDERR, "Konflikt-Body: expected_revision falsch.\n"); exit(1);
    }
    if ((int) ($payload["current_revision"] ?? -1) !== 2) {
        fwrite(STDERR, "Konflikt-Body: current_revision falsch.\n"); exit(1);
    }
    $item = $payload["item"] ?? null;
    if (!is_array($item) || (int) ($item["id"] ?? 0) !== (int) $argv[2] || (int) ($item["revision"] ?? 0) !== 2) {
        fwrite(STDERR, "Konflikt-Body enthaelt kein vollstaendiges aktuelles item (AC3+AC4).\n");
        exit(1);
    }
' "$CONFLICT_BODY" "$ITEM_ID"
echo "AC3 ok: 409 item_revision_conflict mit vollstaendigem aktuellen Item"

# Serverliste pruefen: kein "Should-Not-Persist" geschrieben (Konflikt darf nicht teilweise schreiben)
LIST_BODY="$TMP_DIR/list.json"
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list&category_id=$SHOPPING_CATEGORY_ID" >"$LIST_BODY"
if grep -q '"name":"Should-Not-Persist"' "$LIST_BODY"; then
    echo "AC3 fail: 409-Konflikt hat teilweise geschrieben." >&2
    exit 1
fi
echo "AC3 ok: 409-Konflikt hat keinen Schreib-Effekt"

# AC5: API-Key-Client mit demselben Vertrag (kein Sonderweg)
APIKEY_BODY="$TMP_DIR/apikey.json"
[[ "$(curl -sS -H "X-Api-Key: $API_KEY" -X POST \
    --data-urlencode "id=$ITEM_ID" \
    --data-urlencode 'name=Via-ApiKey' \
    --data-urlencode 'quantity=2x' \
    --data-urlencode 'expected_revision=2' \
    -w '%{http_code}' \
    -o "$APIKEY_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=update")" == "200" ]]
php -r '
    $payload = json_decode(file_get_contents($argv[1]), true);
    if ((int) ($payload["item"]["revision"] ?? 0) !== 3) {
        fwrite(STDERR, "API-Key-Update hat revision nicht auf 3 erhoeht.\n");
        exit(1);
    }
' "$APIKEY_BODY"
echo "AC5 ok: API-Key-Client liefert identischen 200+item-Vertrag"

APIKEY_CONFLICT_BODY="$TMP_DIR/apikey-conflict.json"
[[ "$(curl -sS -H "X-Api-Key: $API_KEY" -X POST \
    --data-urlencode "id=$ITEM_ID" \
    --data-urlencode 'name=Should-Not-Either' \
    --data-urlencode 'expected_revision=1' \
    -w '%{http_code}' \
    -o "$APIKEY_CONFLICT_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=update")" == "409" ]]
grep -q '"error_key":"error.item_revision_conflict"' "$APIKEY_CONFLICT_BODY" \
    || { echo "AC5 fail: API-Key-Konflikt-Body hat falschen error_key." >&2; exit 1; }
echo "AC5 ok: API-Key-Client liefert identischen 409-Vertrag"

# 404-Fallback: Update auf nicht existierendes Item liefert 404, nicht 409
NOTFOUND_BODY="$TMP_DIR/notfound.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "id=9999999" \
    --data-urlencode 'name=No-Such-Item' \
    --data-urlencode 'expected_revision=1' \
    -w '%{http_code}' \
    -o "$NOTFOUND_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=update")" == "404" ]]
grep -q '"error_key":"error.item_not_found"' "$NOTFOUND_BODY" \
    || { echo "404-Fallback: error_key falsch." >&2; exit 1; }
echo "404-Fallback ok: 404 bei nicht existierender item_id"

echo "Alle Revisions-ACs (#61) bestanden."
