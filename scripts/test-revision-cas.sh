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

# Zusatz: list_due_date muss status setzen koennen (Bugfix fuer PDO-Binding-Typenmismatch)
TODO_CAT_ID="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=categories_list" \
    | php -r '
        $payload = json_decode(file_get_contents("php://stdin"), true);
        foreach (($payload["categories"] ?? []) as $cat) {
            if (($cat["type"] ?? "") === "list_due_date") { echo (int) ($cat["id"] ?? 0); exit; }
        }
        exit(1);
    ')"
TODO_BODY="$TMP_DIR/todo.json"
curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "category_id=$TODO_CAT_ID" \
    --data-urlencode 'name=Test-Todo' \
    -o "$TODO_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=add" >/dev/null
TODO_ID="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["id"] ?? 0);' "$TODO_BODY")"
TODO_REV="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["revision"] ?? 0);' "$TODO_BODY")"

# Status darf nicht stumm ignoriert werden.
curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "id=$TODO_ID" \
    --data-urlencode 'name=Test-Todo' \
    --data-urlencode 'barcode=' \
    --data-urlencode 'quantity=' \
    --data-urlencode 'due_date=2026-08-01' \
    --data-urlencode 'due_time=' \
    --data-urlencode 'priority=' \
    --data-urlencode 'content=' \
    --data-urlencode 'status=in_progress' \
    --data-urlencode "expected_revision=$TODO_REV" \
    -o "$TMP_DIR/todo-update.json" \
    "http://127.0.0.1:$PORT/api.php?action=update" >/dev/null
php -r '
    $payload = json_decode(file_get_contents($argv[1]), true);
    if (($payload["item"]["status"] ?? "") !== "in_progress") {
        fwrite(STDERR, "Status wurde nicht gespeichert (Bug-Regression).\n");
        exit(1);
    }
' "$TMP_DIR/todo-update.json"
echo "Status-Bugfix ok: list_due_date speichert status korrekt"

# Probe: ohne 'status'-Key im Request behalten wir den bestehenden Wert (nicht auf '' setzen).
# Das ist der entscheidende Bug: vorher/nachher wurde fehlender Status als '' interpretiert.
echo "=== Add TODO mit status=in_progress ==="
TODO_ADD_BODY="$TMP_DIR/todo-add2.json"
curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "category_id=$TODO_CAT_ID" \
    --data-urlencode 'name=Status-Hold-Test' \
    -o "$TODO_ADD_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=add" >/dev/null
TODO_ID2="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["id"] ?? 0);' "$TODO_ADD_BODY")"
TODO_REV2="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["revision"] ?? 0);' "$TODO_ADD_BODY")"

# Status auf 'in_progress' setzen
curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "id=$TODO_ID2" \
    --data-urlencode 'name=Status-Hold-Test' \
    --data-urlencode "status=in_progress" \
    --data-urlencode "expected_revision=$TODO_REV2" \
    -o "$TMP_DIR/todo-set-status.json" \
    "http://127.0.0.1:$PORT/api.php?action=update" >/dev/null
TODO_REV2="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["item"]["revision"] ?? 0);' "$TMP_DIR/todo-set-status.json")"
php -r '
    $p = json_decode(file_get_contents($argv[1]), true);
    if (($p["item"]["status"] ?? "") !== "in_progress") { fwrite(STDERR, "status konnte nicht gesetzt werden.\n"); exit(1); }
' "$TMP_DIR/todo-set-status.json"

# Jetzt Update OHNE status-Key: bestehender status MUSS erhalten bleiben.
curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "id=$TODO_ID2" \
    --data-urlencode 'name=Status-Hold-Test-bearbeitet' \
    --data-urlencode "expected_revision=$TODO_REV2" \
    -o "$TMP_DIR/todo-preserve.json" \
    "http://127.0.0.1:$PORT/api.php?action=update" >/dev/null
php -r '
    $p = json_decode(file_get_contents($argv[1]), true);
    if (($p["item"]["status"] ?? "") !== "in_progress") {
        fwrite(STDERR, "Status wurde durch Update ohne status-Key ueberschrieben (Bug-Regression).\n");
        exit(1);
    }
    if (($p["item"]["name"] ?? "") !== "Status-Hold-Test-bearbeitet") {
        fwrite(STDERR, "Name wurde nicht aktualisiert.\n"); exit(1);
    }
' "$TMP_DIR/todo-preserve.json"
echo "Status-Hold ok: fehlender status-Key ueberschreibt bestehenden status nicht"

# Probe: Teilupdate (nur name) darf vorhandenes content (Notiz) NICHT ueberschreiben.
# Das ist der User-Bug: Notiz-Titel umbenannt -> Notiz-Inhalt weg.
NOTE_CAT_ID="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=categories_list" \
    | php -r '
        $payload = json_decode(file_get_contents("php://stdin"), true);
        foreach (($payload["categories"] ?? []) as $cat) {
            if (($cat["type"] ?? "") === "notes") { echo (int) ($cat["id"] ?? 0); exit; }
        }
        exit(1);
    ')"
NOTE_BODY="$TMP_DIR/note-add.json"
curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "category_id=$NOTE_CAT_ID" \
    --data-urlencode 'name=NotizTitel' \
    --data-urlencode 'content=<p>Wichtiger Notiz-Inhalt</p>' \
    -o "$NOTE_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=add" >/dev/null
NOTE_ID="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["id"] ?? 0);' "$NOTE_BODY")"
NOTE_REV="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["revision"] ?? 0);' "$NOTE_BODY")"

# Jetzt nur den Titel aendern: KEIN 'content' im Body.
curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "id=$NOTE_ID" \
    --data-urlencode 'name=NotizTitel - bearbeitet' \
    --data-urlencode "expected_revision=$NOTE_REV" \
    -o "$TMP_DIR/note-update.json" \
    "http://127.0.0.1:$PORT/api.php?action=update" >/dev/null
php -r '
    $payload = json_decode(file_get_contents($argv[1]), true);
    $item = $payload["item"] ?? null;
    if (!is_array($item)) { fwrite(STDERR, "Update-Antwort enthaelt kein item.\n"); exit(1); }
    if (($item["name"] ?? "") !== "NotizTitel - bearbeitet") {
        fwrite(STDERR, "Titel wurde nicht uebernommen.\n"); exit(1);
    }
    if (($item["content"] ?? null) !== "<p>Wichtiger Notiz-Inhalt</p>") {
        fwrite(STDERR, sprintf(
            "BUG: Notiz-Inhalt wurde ueberschrieben. content=%s\n",
            var_export($item["content"] ?? null, true)
        ));
        exit(1);
    }
' "$TMP_DIR/note-update.json"
echo "Notiz-Hold ok: Teilupdate (nur Titel) loescht den Notiz-Inhalt nicht"

# Issue #65, erste vertikale Scheibe: Erledigt-Status nutzt denselben CAS-Vertrag.
TOGGLE_MISSING_REQUEST_BODY="$TMP_DIR/toggle-missing-request.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "id=$ITEM_ID" --data-urlencode 'done=1' --data-urlencode 'expected_revision=3' \
    -w '%{http_code}' -o "$TOGGLE_MISSING_REQUEST_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=toggle")" == "428" ]]
grep -q '"error_key":"error.idempotency_key_required"' "$TOGGLE_MISSING_REQUEST_BODY" \
    || { echo "Toggle ohne Request-ID: error_key falsch." >&2; exit 1; }

TOGGLE_MISSING_BODY="$TMP_DIR/toggle-missing.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-toggle-missing' -X POST \
    --data-urlencode "id=$ITEM_ID" \
    --data-urlencode 'done=1' \
    -w '%{http_code}' \
    -o "$TOGGLE_MISSING_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=toggle")" == "428" ]]
grep -q '"error_key":"error.revision_required"' "$TOGGLE_MISSING_BODY" \
    || { echo "Toggle ohne Revision: error_key falsch." >&2; exit 1; }

TOGGLE_BODY="$TMP_DIR/toggle.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-toggle-main' -X POST \
    --data-urlencode "id=$ITEM_ID" \
    --data-urlencode 'done=1' \
    --data-urlencode 'expected_revision=3' \
    -w '%{http_code}' \
    -o "$TOGGLE_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=toggle")" == "200" ]]
php -r '
    $item = json_decode(file_get_contents($argv[1]), true)["item"] ?? null;
    if (!is_array($item) || (int) ($item["done"] ?? 0) !== 1 || (int) ($item["revision"] ?? 0) !== 4) {
        fwrite(STDERR, "Toggle liefert kein kanonisches Item mit Revision 4.\n"); exit(1);
    }
' "$TOGGLE_BODY"

# Gleiches Ziel mit alter Revision ist Erfolg ohne zweite Revisionserhoehung.
TOGGLE_SAME_BODY="$TMP_DIR/toggle-same.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-toggle-same' -X POST \
    --data-urlencode "id=$ITEM_ID" \
    --data-urlencode 'done=1' \
    --data-urlencode 'expected_revision=3' \
    -w '%{http_code}' \
    -o "$TOGGLE_SAME_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=toggle")" == "200" ]]
php -r '
    $item = json_decode(file_get_contents($argv[1]), true)["item"] ?? null;
    if (!is_array($item) || (int) ($item["done"] ?? 0) !== 1 || (int) ($item["revision"] ?? 0) !== 4) {
        fwrite(STDERR, "Identisches Toggle-Ziel ist nicht idempotent.\n"); exit(1);
    }
' "$TOGGLE_SAME_BODY"

# Unabhaengige Inhaltsaenderung erzeugt erst 409; Rebase auf current_revision wendet das Ziel an.
curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "id=$ITEM_ID" \
    --data-urlencode 'name=Via-ApiKey-mit-Inhaltsaenderung' \
    --data-urlencode 'expected_revision=4' \
    -o "$TMP_DIR/toggle-independent-update.json" \
    "http://127.0.0.1:$PORT/api.php?action=update" >/dev/null
TOGGLE_CONFLICT_BODY="$TMP_DIR/toggle-conflict.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-toggle-rebase' -X POST \
    --data-urlencode "id=$ITEM_ID" \
    --data-urlencode 'done=0' \
    --data-urlencode 'expected_revision=4' \
    -w '%{http_code}' \
    -o "$TOGGLE_CONFLICT_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=toggle")" == "409" ]]
grep -q '"current_revision":5' "$TOGGLE_CONFLICT_BODY" \
    || { echo "Toggle-Konflikt liefert nicht current_revision=5." >&2; exit 1; }
TOGGLE_REBASED_BODY="$TMP_DIR/toggle-rebased.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-toggle-rebase' -X POST \
    --data-urlencode "id=$ITEM_ID" \
    --data-urlencode 'done=0' \
    --data-urlencode 'expected_revision=5' \
    -w '%{http_code}' \
    -o "$TOGGLE_REBASED_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=toggle")" == "200" ]]
php -r '
    $item = json_decode(file_get_contents($argv[1]), true)["item"] ?? null;
    if (!is_array($item) || (int) ($item["done"] ?? 1) !== 0 || (int) ($item["revision"] ?? 0) !== 6
        || ($item["name"] ?? "") !== "Via-ApiKey-mit-Inhaltsaenderung") {
        fwrite(STDERR, "Rebased Toggle hat Inhalt/Ziel/Revision nicht erhalten.\n"); exit(1);
    }
' "$TOGGLE_REBASED_BODY"
TOGGLE_REPLAY_BODY="$TMP_DIR/toggle-replay.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-toggle-rebase' -X POST \
    --data-urlencode "id=$ITEM_ID" --data-urlencode 'done=0' --data-urlencode 'expected_revision=5' \
    -w '%{http_code}' -o "$TOGGLE_REPLAY_BODY" "http://127.0.0.1:$PORT/api.php?action=toggle")" == "200" ]]
grep -q '"idempotent_replay":1' "$TOGGLE_REPLAY_BODY" || { echo "Toggle-Replay wurde erneut ausgefuehrt." >&2; exit 1; }
echo "Issue #65 Toggle ok: CAS, idempotentes Ziel und Rebase-Vertrag"

# Workflow-Status: gleicher Vertrag, einschliesslich abweichender paralleler Absicht.
STATUS_BODY="$TMP_DIR/status-cas.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-status-main' -X POST \
    --data-urlencode "id=$TODO_ID" --data-urlencode 'status=waiting' --data-urlencode 'expected_revision=2' \
    -w '%{http_code}' -o "$STATUS_BODY" "http://127.0.0.1:$PORT/api.php?action=status")" == "200" ]]
php -r '
    $item = json_decode(file_get_contents($argv[1]), true)["item"] ?? null;
    if (($item["status"] ?? null) !== "waiting" || (int) ($item["revision"] ?? 0) !== 3) exit(1);
' "$STATUS_BODY"
STATUS_REPLAY_BODY="$TMP_DIR/status-replay.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-status-main' -X POST \
    --data-urlencode "id=$TODO_ID" --data-urlencode 'status=waiting' --data-urlencode 'expected_revision=2' \
    -w '%{http_code}' -o "$STATUS_REPLAY_BODY" "http://127.0.0.1:$PORT/api.php?action=status")" == "200" ]]
grep -q '"idempotent_replay":1' "$STATUS_REPLAY_BODY" || { echo "Status-Replay wurde erneut ausgefuehrt." >&2; exit 1; }
STATUS_SAME_BODY="$TMP_DIR/status-same.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-status-same' -X POST \
    --data-urlencode "id=$TODO_ID" --data-urlencode 'status=waiting' --data-urlencode 'expected_revision=2' \
    -w '%{http_code}' -o "$STATUS_SAME_BODY" "http://127.0.0.1:$PORT/api.php?action=status")" == "200" ]]
grep -q '"revision":3' "$STATUS_SAME_BODY" || { echo "Status-Ziel erhoehte Revision erneut." >&2; exit 1; }
STATUS_CONFLICT_BODY="$TMP_DIR/status-conflict.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-status-conflict' -X POST \
    --data-urlencode "id=$TODO_ID" --data-urlencode 'status=' --data-urlencode 'expected_revision=2' \
    -w '%{http_code}' -o "$STATUS_CONFLICT_BODY" "http://127.0.0.1:$PORT/api.php?action=status")" == "409" ]]
grep -q '"current_revision":3' "$STATUS_CONFLICT_BODY" || { echo "Status-Konfliktpayload unvollstaendig." >&2; exit 1; }
echo "Issue #65 Workflow-Status ok: CAS, idempotentes Ziel, abweichende Absicht"

# Pin-Status: CAS + kanonisches Item + idempotentes Ziel.
PIN_BODY="$TMP_DIR/pin-cas.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-pin-main' -X POST \
    --data-urlencode "id=$ITEM_ID" --data-urlencode 'is_pinned=1' --data-urlencode 'expected_revision=6' \
    -w '%{http_code}' -o "$PIN_BODY" "http://127.0.0.1:$PORT/api.php?action=pin")" == "200" ]]
php -r '
    $item = json_decode(file_get_contents($argv[1]), true)["item"] ?? null;
    if ((int) ($item["is_pinned"] ?? 0) !== 1 || (int) ($item["revision"] ?? 0) !== 7) exit(1);
' "$PIN_BODY"
PIN_REPLAY_BODY="$TMP_DIR/pin-replay.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-pin-main' -X POST \
    --data-urlencode "id=$ITEM_ID" --data-urlencode 'is_pinned=1' --data-urlencode 'expected_revision=6' \
    -w '%{http_code}' -o "$PIN_REPLAY_BODY" "http://127.0.0.1:$PORT/api.php?action=pin")" == "200" ]]
grep -q '"idempotent_replay":1' "$PIN_REPLAY_BODY" || { echo "Pin-Replay wurde erneut ausgefuehrt." >&2; exit 1; }
PIN_SAME_BODY="$TMP_DIR/pin-same.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-pin-same' -X POST \
    --data-urlencode "id=$ITEM_ID" --data-urlencode 'is_pinned=1' --data-urlencode 'expected_revision=6' \
    -w '%{http_code}' -o "$PIN_SAME_BODY" "http://127.0.0.1:$PORT/api.php?action=pin")" == "200" ]]
grep -q '"revision":7' "$PIN_SAME_BODY" || { echo "Pin-Ziel erhoehte Revision erneut." >&2; exit 1; }
PIN_CONFLICT_BODY="$TMP_DIR/pin-conflict.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-pin-conflict' -X POST \
    --data-urlencode "id=$ITEM_ID" --data-urlencode 'is_pinned=0' --data-urlencode 'expected_revision=6' \
    -w '%{http_code}' -o "$PIN_CONFLICT_BODY" "http://127.0.0.1:$PORT/api.php?action=pin")" == "409" ]]
echo "Issue #65 Pin-Status ok: CAS, idempotentes Ziel, Konfliktpayload"

# Verschieben: gleiche Typen, atomarer Revisionsvergleich und kanonisches Item.
MOVE_CATEGORY_BODY="$TMP_DIR/move-category.json"
curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode 'name=Zweite Einkaufsliste' --data-urlencode 'type=list_quantity' \
    -o "$MOVE_CATEGORY_BODY" "http://127.0.0.1:$PORT/api.php?action=categories_create" >/dev/null
MOVE_CATEGORY_ID="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["category"]["id"] ?? json_decode(file_get_contents($argv[1]), true)["id"] ?? 0);' "$MOVE_CATEGORY_BODY")"
[[ "$MOVE_CATEGORY_ID" -gt 0 ]] || { echo "Move-Testkategorie fehlt." >&2; exit 1; }
MOVE_BODY="$TMP_DIR/move-cas.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-move-main' -X POST \
    --data-urlencode "id=$ITEM_ID" --data-urlencode "target_category_id=$MOVE_CATEGORY_ID" --data-urlencode 'expected_revision=7' \
    -w '%{http_code}' -o "$MOVE_BODY" "http://127.0.0.1:$PORT/api.php?action=move")" == "200" ]]
php -r '
    $item = json_decode(file_get_contents($argv[1]), true)["item"] ?? null;
    if ((int) ($item["category_id"] ?? 0) !== (int) $argv[2] || (int) ($item["revision"] ?? 0) !== 8) exit(1);
' "$MOVE_BODY" "$MOVE_CATEGORY_ID"
MOVE_REPLAY_BODY="$TMP_DIR/move-replay.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-move-main' -X POST \
    --data-urlencode "id=$ITEM_ID" --data-urlencode "target_category_id=$MOVE_CATEGORY_ID" --data-urlencode 'expected_revision=7' \
    -w '%{http_code}' -o "$MOVE_REPLAY_BODY" "http://127.0.0.1:$PORT/api.php?action=move")" == "200" ]]
grep -q '"idempotent_replay":1' "$MOVE_REPLAY_BODY" || { echo "Move-Replay wurde erneut ausgefuehrt." >&2; exit 1; }
MOVE_SAME_BODY="$TMP_DIR/move-same.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-move-same' -X POST \
    --data-urlencode "id=$ITEM_ID" --data-urlencode "target_category_id=$MOVE_CATEGORY_ID" --data-urlencode 'expected_revision=7' \
    -w '%{http_code}' -o "$MOVE_SAME_BODY" "http://127.0.0.1:$PORT/api.php?action=move")" == "200" ]]
grep -q '"revision":8' "$MOVE_SAME_BODY" || { echo "Move-Ziel erhoehte Revision erneut." >&2; exit 1; }
MOVE_CONFLICT_BODY="$TMP_DIR/move-conflict.json"
[[ "$(curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -H 'X-Idempotency-Key: revision-move-conflict' -X POST \
    --data-urlencode "id=$ITEM_ID" --data-urlencode "target_category_id=$SHOPPING_CATEGORY_ID" --data-urlencode 'expected_revision=7' \
    -w '%{http_code}' -o "$MOVE_CONFLICT_BODY" "http://127.0.0.1:$PORT/api.php?action=move")" == "409" ]]
echo "Issue #65 Move ok: CAS, idempotentes Ziel, Konfliktpayload"

echo "Alle Revisions-ACs (#61) bestanden."
