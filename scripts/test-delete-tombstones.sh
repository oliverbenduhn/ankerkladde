#!/usr/bin/env bash
# Oeffentlicher API-Vertrag fuer reversibles Loeschen.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-18107}"
TMP_DIR="$(mktemp -d)"
TEST_DATA_DIR="$TMP_DIR/data"
SERVER_LOG="$TMP_DIR/server.log"
API_KEY="delete-tombstone-test-api-key"
ADMIN_API_KEY="delete-tombstone-admin-api-key"

cleanup() {
    if [[ -n "${RACE_LOCK_PID:-}" ]]; then
        kill "$RACE_LOCK_PID" >/dev/null 2>&1 || true
        wait "$RACE_LOCK_PID" >/dev/null 2>&1 || true
    fi
    if [[ -n "${SERVER_PID:-}" ]]; then
        kill "$SERVER_PID" >/dev/null 2>&1 || true
        wait "$SERVER_PID" >/dev/null 2>&1 || true
    fi
    chmod -R u+w "$TMP_DIR" >/dev/null 2>&1 || true
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
    echo "$1" >&2
    if [[ -f "$SERVER_LOG" ]]; then
        tail -n 80 "$SERVER_LOG" >&2 || true
    fi
    exit 1
}

mkdir -p "$TEST_DATA_DIR"

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
    $stmt->execute([":api_key" => $argv[3], ":username" => "testadmin"]);
' "$ROOT_DIR" "$API_KEY" "$ADMIN_API_KEY"

PHP_CLI_SERVER_WORKERS=2 \
EINKAUF_DATA_DIR="$TEST_DATA_DIR" \
EINKAUF_TRUST_PROXY_HEADERS=0 \
WS_NOTIFY_URL="http://127.0.0.1:1/notify" \
php -S "127.0.0.1:$PORT" -t "$ROOT_DIR/public" "$ROOT_DIR/public/router.php" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:$PORT/login.php" >/dev/null 2>&1; then
        break
    fi
    sleep 0.25
done
kill -0 "$SERVER_PID" >/dev/null 2>&1 || fail "Testserver konnte nicht gestartet werden."

api_get() {
    curl -fsS -H "X-Api-Key: $API_KEY" "http://127.0.0.1:$PORT/api.php?$1"
}

api_post() {
    local action=$1
    local request_id=$2
    local output_file=$3
    shift 3
    curl -sS \
        -H "X-Api-Key: $API_KEY" \
        -H "X-Idempotency-Key: $request_id" \
        -X POST \
        "$@" \
        -o "$output_file" \
        -w '%{http_code}' \
        "http://127.0.0.1:$PORT/api.php?action=$action"
}

CATEGORY_ID="$(api_get 'action=categories_list' | php -r '
    $payload = json_decode(file_get_contents("php://stdin"), true);
    foreach (($payload["categories"] ?? []) as $category) {
        if (($category["type"] ?? "") === "list_quantity") {
            echo (int) $category["id"];
            exit;
        }
    }
    exit(1);
')"
[[ "$CATEGORY_ID" -gt 0 ]] || fail "Keine Mengenliste gefunden."

ADD_BODY="$TMP_DIR/add.json"
ADD_STATUS="$(api_post add add-single "$ADD_BODY" \
    --data-urlencode "category_id=$CATEGORY_ID" \
    --data-urlencode 'name=Tombstone Milch' \
    --data-urlencode 'quantity=2x')"
[[ "$ADD_STATUS" == "201" ]] || fail "Item-Anlage lieferte HTTP $ADD_STATUS."
ITEM_ID="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["id"] ?? 0);' "$ADD_BODY")"
ITEM_REVISION="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["revision"] ?? 0);' "$ADD_BODY")"
[[ "$ITEM_ID" -gt 0 && "$ITEM_REVISION" -gt 0 ]] || fail "Item-Anlage lieferte kein kanonisches Item."

DELETION_ID="delete-single-001"
DELETE_BODY="$TMP_DIR/delete.json"
DELETE_STATUS="$(api_post delete delete-single-request "$DELETE_BODY" \
    --data-urlencode "id=$ITEM_ID" \
    --data-urlencode "expected_revision=$ITEM_REVISION" \
    --data-urlencode "deletion_id=$DELETION_ID")"
[[ "$DELETE_STATUS" == "200" ]] || fail "Delete-Staging lieferte HTTP $DELETE_STATUS."

php -r '
    $payload = json_decode(file_get_contents($argv[1]), true);
    if (($payload["deletion_id"] ?? "") !== $argv[2]) {
        fwrite(STDERR, "Delete-Antwort enthaelt deletion_id nicht.\n");
        exit(1);
    }
    if (($payload["deletion_state"] ?? "") !== "staged") {
        fwrite(STDERR, "Delete-Antwort enthaelt deletion_state=staged nicht.\n");
        exit(1);
    }
    if ((int) ($payload["deleted_id"] ?? 0) !== (int) $argv[3]) {
        fwrite(STDERR, "Bestehender deleted_id-Vertrag ging verloren.\n");
        exit(1);
    }
' "$DELETE_BODY" "$DELETION_ID" "$ITEM_ID" || fail "Delete-Staging-Antwort ist nicht kanonisch."

if api_get "action=list&category_id=$CATEGORY_ID" | grep -q 'Tombstone Milch'; then
    fail "Gestagtes Item blieb in der Hauptliste sichtbar."
fi

echo "Slice 1 ok: Einzel-Delete wird CAS-atomar als Tombstone gestagt."

UNDO_BODY="$TMP_DIR/undo.json"
UNDO_STATUS="$(api_post undo_delete undo-single-request "$UNDO_BODY" \
    --data-urlencode "deletion_id=$DELETION_ID" \
    --data-urlencode "item_ids[]=$ITEM_ID")"
[[ "$UNDO_STATUS" == "200" ]] || fail "Undo lieferte HTTP $UNDO_STATUS."

RESTORED_REVISION="$(php -r '
    $payload = json_decode(file_get_contents($argv[1]), true);
    if (($payload["deletion_id"] ?? "") !== $argv[2] || ($payload["deletion_state"] ?? "") !== "restored") {
        fwrite(STDERR, "Undo-Antwort enthaelt keinen restored-Zustand.\n");
        exit(1);
    }
    $items = $payload["restored_items"] ?? [];
    if (count($items) !== 1 || (int) ($items[0]["id"] ?? 0) !== (int) $argv[3]) {
        fwrite(STDERR, "Undo stellte nicht exakt dieselbe Item-ID wieder her.\n");
        exit(1);
    }
    if (($items[0]["name"] ?? "") !== "Tombstone Milch" || ($items[0]["quantity"] ?? "") !== "2x") {
        fwrite(STDERR, "Undo verlor Item-Rohdaten.\n");
        exit(1);
    }
    $revision = (int) ($items[0]["revision"] ?? 0);
    if ($revision <= (int) $argv[4]) {
        fwrite(STDERR, "Undo-Revision ist nicht strikt hoeher als die terminale Revision.\n");
        exit(1);
    }
    echo $revision;
' "$UNDO_BODY" "$DELETION_ID" "$ITEM_ID" "$((ITEM_REVISION + 1))")" || fail "Undo-Antwort ist nicht kanonisch."

UNDO_RETRY_BODY="$TMP_DIR/undo-retry.json"
UNDO_RETRY_STATUS="$(api_post undo_delete undo-single-retry "$UNDO_RETRY_BODY" \
    --data-urlencode "deletion_id=$DELETION_ID" \
    --data-urlencode "item_ids[]=$ITEM_ID")"
[[ "$UNDO_RETRY_STATUS" == "200" ]] || fail "Undo-Retry lieferte HTTP $UNDO_RETRY_STATUS."
php -r '
    $payload = json_decode(file_get_contents($argv[1]), true);
    if (($payload["deletion_state"] ?? "") !== "restored") {
        fwrite(STDERR, "Undo-Retry verlor restored-Zustand.\n");
        exit(1);
    }
    if ((int) ($payload["restored_items"][0]["revision"] ?? 0) !== (int) $argv[2]) {
        fwrite(STDERR, "Undo-Retry erhoehte die Revision erneut.\n");
        exit(1);
    }
' "$UNDO_RETRY_BODY" "$RESTORED_REVISION" || fail "Undo-Retry ist nicht idempotent."

echo "Slice 2 ok: Undo stellt ID und Daten mit strikt hoeherer Revision idempotent wieder her."

add_done_item() {
    local name=$1
    local request_suffix=$2
    local add_file="$TMP_DIR/add-$request_suffix.json"
    local add_status
    add_status="$(api_post add "add-$request_suffix" "$add_file" \
        --data-urlencode "category_id=$CATEGORY_ID" \
        --data-urlencode "name=$name")"
    [[ "$add_status" == "201" ]] || fail "Batch-Item-Anlage lieferte HTTP $add_status."
    local item_id
    local item_revision
    item_id="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["id"] ?? 0);' "$add_file")"
    item_revision="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["revision"] ?? 0);' "$add_file")"

    local toggle_file="$TMP_DIR/toggle-$request_suffix.json"
    local toggle_status
    toggle_status="$(api_post toggle "toggle-$request_suffix" "$toggle_file" \
        --data-urlencode "id=$item_id" \
        --data-urlencode 'done=1' \
        --data-urlencode "expected_revision=$item_revision")"
    [[ "$toggle_status" == "200" ]] || fail "Batch-Item-Toggle lieferte HTTP $toggle_status."
    local done_revision
    done_revision="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["item"]["revision"] ?? 0);' "$toggle_file")"
    [[ "$item_id" -gt 0 && "$done_revision" -gt "$item_revision" ]] || fail "Batch-Item wurde nicht kanonisch erledigt."

    printf '%s:%s\n' "$item_id" "$done_revision"
}

IFS=: read -r CLEAR_ITEM_A CLEAR_REV_A <<<"$(add_done_item 'Tombstone Batch A' 'batch-a')"
IFS=: read -r CLEAR_ITEM_B CLEAR_REV_B <<<"$(add_done_item 'Tombstone Batch B' 'batch-b')"

STALE_CLEAR_ITEMS="$(php -r 'echo json_encode([
    ["id" => (int) $argv[1], "expected_revision" => (int) $argv[2]],
    ["id" => (int) $argv[3], "expected_revision" => (int) $argv[4] - 1],
]);' "$CLEAR_ITEM_A" "$CLEAR_REV_A" "$CLEAR_ITEM_B" "$CLEAR_REV_B")"
REJECTED_DELETION_ID="clear-rejected-001"
STALE_CLEAR_BODY="$TMP_DIR/clear-stale.json"
STALE_CLEAR_STATUS="$(api_post clear clear-stale-request "$STALE_CLEAR_BODY" \
    --data-urlencode "category_id=$CATEGORY_ID" \
    --data-urlencode "items=$STALE_CLEAR_ITEMS" \
    --data-urlencode "deletion_id=$REJECTED_DELETION_ID")"
[[ "$STALE_CLEAR_STATUS" == "409" ]] || fail "Veralteter Clear lieferte HTTP $STALE_CLEAR_STATUS statt 409."

LIST_AFTER_REJECT="$TMP_DIR/list-after-reject.json"
api_get "action=list&category_id=$CATEGORY_ID" >"$LIST_AFTER_REJECT"
php -r '
    $payload = json_decode(file_get_contents($argv[1]), true);
    $ids = array_map(static fn(array $item): int => (int) $item["id"], $payload["items"] ?? []);
    foreach ([(int) $argv[2], (int) $argv[3]] as $expected) {
        if (!in_array($expected, $ids, true)) {
            fwrite(STDERR, "CAS-Fehler hat einen Teil des Clear-Batches geloescht.\n");
            exit(1);
        }
    }
' "$LIST_AFTER_REJECT" "$CLEAR_ITEM_A" "$CLEAR_ITEM_B" || fail "Clear war bei CAS-Konflikt nicht atomar."

REORDERED_UNDO_BODY="$TMP_DIR/reordered-undo.json"
REORDERED_UNDO_STATUS="$(api_post undo_delete reordered-undo-request "$REORDERED_UNDO_BODY" \
    --data-urlencode "deletion_id=$REJECTED_DELETION_ID" \
    --data-urlencode "item_ids[]=$CLEAR_ITEM_A" \
    --data-urlencode "item_ids[]=$CLEAR_ITEM_B")"
[[ "$REORDERED_UNDO_STATUS" == "200" ]] || fail "Offline-Undo nach abgelehntem Stage lieferte HTTP $REORDERED_UNDO_STATUS."
grep -q '"deletion_state":"not_staged"' "$REORDERED_UNDO_BODY" \
    || fail "Offline-Undo erkannte den abgelehnten Stage nicht als sicheren no-op."

CLEAR_ITEMS="$(php -r 'echo json_encode([
    ["id" => (int) $argv[1], "expected_revision" => (int) $argv[2]],
    ["id" => (int) $argv[3], "expected_revision" => (int) $argv[4]],
]);' "$CLEAR_ITEM_A" "$CLEAR_REV_A" "$CLEAR_ITEM_B" "$CLEAR_REV_B")"
CLEAR_DELETION_ID="clear-batch-001"
CLEAR_BODY="$TMP_DIR/clear.json"
CLEAR_STATUS="$(api_post clear clear-batch-request "$CLEAR_BODY" \
    --data-urlencode "category_id=$CATEGORY_ID" \
    --data-urlencode "items=$CLEAR_ITEMS" \
    --data-urlencode "deletion_id=$CLEAR_DELETION_ID")"
[[ "$CLEAR_STATUS" == "200" ]] || fail "Batch-Clear lieferte HTTP $CLEAR_STATUS."
php -r '
    $payload = json_decode(file_get_contents($argv[1]), true);
    if (($payload["deletion_id"] ?? "") !== $argv[2] || ($payload["deletion_state"] ?? "") !== "staged") {
        fwrite(STDERR, "Clear-Antwort enthaelt keinen staged-Batch.\n");
        exit(1);
    }
    if ((int) ($payload["deleted"] ?? 0) !== 2 || count($payload["deleted_items"] ?? []) !== 2) {
        fwrite(STDERR, "Bestehender Clear-Antwortvertrag ging verloren.\n");
        exit(1);
    }
' "$CLEAR_BODY" "$CLEAR_DELETION_ID" || fail "Clear-Antwort ist nicht kanonisch."

CLEAR_UNDO_BODY="$TMP_DIR/clear-undo.json"
CLEAR_UNDO_STATUS="$(api_post undo_delete clear-undo-request "$CLEAR_UNDO_BODY" \
    --data-urlencode "deletion_id=$CLEAR_DELETION_ID" \
    --data-urlencode "item_ids[]=$CLEAR_ITEM_A" \
    --data-urlencode "item_ids[]=$CLEAR_ITEM_B")"
[[ "$CLEAR_UNDO_STATUS" == "200" ]] || fail "Batch-Undo lieferte HTTP $CLEAR_UNDO_STATUS."
php -r '
    $payload = json_decode(file_get_contents($argv[1]), true);
    $items = $payload["restored_items"] ?? [];
    $byId = [];
    foreach ($items as $item) $byId[(int) $item["id"]] = $item;
    foreach ([(int) $argv[2], (int) $argv[3]] as $id) {
        if (!isset($byId[$id]) || (int) ($byId[$id]["done"] ?? 0) !== 1) {
            fwrite(STDERR, "Batch-Undo stellte ID oder done-Zustand nicht exakt wieder her.\n");
            exit(1);
        }
    }
' "$CLEAR_UNDO_BODY" "$CLEAR_ITEM_A" "$CLEAR_ITEM_B" || fail "Batch-Undo ist nicht exakt."

echo "Slice 3 ok: Clear ist batch-atomar, Offline-Reihenfolge sicher und vollstaendig reversibel."

IMAGE_CATEGORY_ID="$(api_get 'action=categories_list' | php -r '
    $payload = json_decode(file_get_contents("php://stdin"), true);
    foreach (($payload["categories"] ?? []) as $category) {
        if (($category["type"] ?? "") === "images") {
            echo (int) $category["id"];
            exit;
        }
    }
    exit(1);
')"
[[ "$IMAGE_CATEGORY_ID" -gt 0 ]] || fail "Keine Bilder-Kategorie gefunden."

IMAGE_UPLOAD_BODY="$TMP_DIR/image-upload.json"
IMAGE_UPLOAD_STATUS="$(api_post upload image-upload-request "$IMAGE_UPLOAD_BODY" \
    -F "category_id=$IMAGE_CATEGORY_ID" \
    -F 'name=Tombstone Bild' \
    -F "attachment=@$ROOT_DIR/public/icons/favicon.png;type=image/png")"
[[ "$IMAGE_UPLOAD_STATUS" == "201" ]] || fail "Bild-Upload lieferte HTTP $IMAGE_UPLOAD_STATUS."
IMAGE_ITEM_ID="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["id"] ?? 0);' "$IMAGE_UPLOAD_BODY")"
[[ "$IMAGE_ITEM_ID" -gt 0 ]] || fail "Bild-Upload lieferte keine Item-ID."

IMAGE_ORIGINAL_PATH="$(find "$TEST_DATA_DIR/uploads/images" -maxdepth 1 -type f ! -name 'thumb-*' | head -n 1)"
[[ -n "$IMAGE_ORIGINAL_PATH" && -f "$IMAGE_ORIGINAL_PATH" ]] || fail "Gespeicherte Bilddatei fehlt."
IMAGE_STORED_NAME="$(basename "$IMAGE_ORIGINAL_PATH")"
IMAGE_THUMB_PATH="$TEST_DATA_DIR/uploads/images/thumb-${IMAGE_STORED_NAME%.*}.jpg"
if [[ ! -f "$IMAGE_THUMB_PATH" ]]; then
    php -r 'if (!copy($argv[1], $argv[2])) exit(1);' "$IMAGE_ORIGINAL_PATH" "$IMAGE_THUMB_PATH" \
        || fail "Thumbnail-Testfixture konnte nicht angelegt werden."
fi

IMAGE_DELETE_ID="delete-image-undo-001"
IMAGE_DELETE_BODY="$TMP_DIR/image-delete.json"
IMAGE_DELETE_STATUS="$(api_post delete image-delete-request "$IMAGE_DELETE_BODY" \
    --data-urlencode "id=$IMAGE_ITEM_ID" \
    --data-urlencode 'expected_revision=1' \
    --data-urlencode "deletion_id=$IMAGE_DELETE_ID")"
[[ "$IMAGE_DELETE_STATUS" == "200" ]] || fail "Bild-Delete lieferte HTTP $IMAGE_DELETE_STATUS."
[[ -f "$IMAGE_ORIGINAL_PATH" && -f "$IMAGE_THUMB_PATH" ]] \
    || fail "Stage löschte Bilddatei oder Thumbnail vor Finalize."

IMAGE_UNDO_BODY="$TMP_DIR/image-undo.json"
IMAGE_UNDO_STATUS="$(api_post undo_delete image-undo-request "$IMAGE_UNDO_BODY" \
    --data-urlencode "deletion_id=$IMAGE_DELETE_ID" \
    --data-urlencode "item_ids[]=$IMAGE_ITEM_ID")"
[[ "$IMAGE_UNDO_STATUS" == "200" ]] || fail "Bild-Undo lieferte HTTP $IMAGE_UNDO_STATUS."
IMAGE_RESTORED_REVISION="$(php -r '
    $payload = json_decode(file_get_contents($argv[1]), true);
    $item = $payload["restored_items"][0] ?? null;
    if (!is_array($item)
        || (int) ($item["id"] ?? 0) !== (int) $argv[2]
        || (int) ($item["has_attachment"] ?? 0) !== 1
        || ($item["attachment_original_name"] ?? "") !== "favicon.png"
        || ($item["attachment_media_type"] ?? "") !== "image/png"
        || !is_string($item["attachment_preview_url"] ?? null)) {
        fwrite(STDERR, "Bild-Undo verlor Attachment-Metadaten.\n");
        exit(1);
    }
    echo (int) $item["revision"];
' "$IMAGE_UNDO_BODY" "$IMAGE_ITEM_ID")" || fail "Bild-Undo stellte Attachment nicht exakt wieder her."
curl -fsS -H "X-Api-Key: $API_KEY" \
    "http://127.0.0.1:$PORT/media.php?item_id=$IMAGE_ITEM_ID" \
    -o "$TMP_DIR/restored-image.png" \
    || fail "Wiederhergestelltes Attachment ist nicht abrufbar."
cmp -s "$ROOT_DIR/public/icons/favicon.png" "$TMP_DIR/restored-image.png" \
    || fail "Wiederhergestellte Attachment-Datei ist nicht bytegenau."

FINAL_DELETE_ID="delete-image-final-001"
FINAL_DELETE_BODY="$TMP_DIR/image-delete-final.json"
FINAL_DELETE_STATUS="$(api_post delete image-delete-final-request "$FINAL_DELETE_BODY" \
    --data-urlencode "id=$IMAGE_ITEM_ID" \
    --data-urlencode "expected_revision=$IMAGE_RESTORED_REVISION" \
    --data-urlencode "deletion_id=$FINAL_DELETE_ID")"
[[ "$FINAL_DELETE_STATUS" == "200" ]] || fail "Finaler Bild-Stage lieferte HTTP $FINAL_DELETE_STATUS."
[[ -f "$IMAGE_ORIGINAL_PATH" && -f "$IMAGE_THUMB_PATH" ]] \
    || fail "Finaler Stage löschte Attachment zu früh."

FINALIZE_BODY="$TMP_DIR/finalize.json"
FINALIZE_STATUS="$(api_post finalize_delete image-finalize-request "$FINALIZE_BODY" \
    --data-urlencode "deletion_id=$FINAL_DELETE_ID")"
[[ "$FINALIZE_STATUS" == "200" ]] || fail "Finalize lieferte HTTP $FINALIZE_STATUS."
grep -q '"deletion_state":"purged"' "$FINALIZE_BODY" \
    || fail "Finalize-Antwort enthält keinen purged-Zustand."
[[ ! -e "$IMAGE_ORIGINAL_PATH" && ! -e "$IMAGE_THUMB_PATH" ]] \
    || fail "Finalize löschte Bilddatei und Thumbnail nicht."

PURGED_UNDO_BODY="$TMP_DIR/purged-undo.json"
PURGED_UNDO_STATUS="$(api_post undo_delete purged-undo-request "$PURGED_UNDO_BODY" \
    --data-urlencode "deletion_id=$FINAL_DELETE_ID" \
    --data-urlencode "item_ids[]=$IMAGE_ITEM_ID")"
[[ "$PURGED_UNDO_STATUS" == "410" ]] || fail "Undo nach Purge lieferte HTTP $PURGED_UNDO_STATUS statt 410."
grep -q '"error_key":"error.deletion_purged"' "$PURGED_UNDO_BODY" \
    || fail "Undo nach Purge lieferte keinen klaren deletion_purged-Fehler."

echo "Slice 4 ok: Attachment bleibt bis Finalize, Undo ist bytegenau, Purge löscht Datei und Thumbnail."

GC_UPLOAD_BODY="$TMP_DIR/gc-upload.json"
GC_UPLOAD_STATUS="$(api_post upload gc-upload-request "$GC_UPLOAD_BODY" \
    -F "category_id=$IMAGE_CATEGORY_ID" \
    -F 'name=Tombstone GC Bild' \
    -F "attachment=@$ROOT_DIR/public/icons/favicon.png;type=image/png")"
[[ "$GC_UPLOAD_STATUS" == "201" ]] || fail "GC-Bild-Upload lieferte HTTP $GC_UPLOAD_STATUS."
GC_ITEM_ID="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["id"] ?? 0);' "$GC_UPLOAD_BODY")"
GC_ORIGINAL_PATH="$(find "$TEST_DATA_DIR/uploads/images" -maxdepth 1 -type f ! -name 'thumb-*' | head -n 1)"
[[ -n "$GC_ORIGINAL_PATH" && -f "$GC_ORIGINAL_PATH" ]] || fail "GC-Bilddatei fehlt."
GC_STORED_NAME="$(basename "$GC_ORIGINAL_PATH")"
GC_THUMB_PATH="$TEST_DATA_DIR/uploads/images/thumb-${GC_STORED_NAME%.*}.jpg"
if [[ ! -f "$GC_THUMB_PATH" ]]; then
    php -r 'if (!copy($argv[1], $argv[2])) exit(1);' "$GC_ORIGINAL_PATH" "$GC_THUMB_PATH" \
        || fail "GC-Thumbnail-Testfixture konnte nicht angelegt werden."
fi

GC_DELETION_ID="delete-image-gc-001"
GC_DELETE_BODY="$TMP_DIR/gc-delete.json"
GC_DELETE_STATUS="$(api_post delete gc-delete-request "$GC_DELETE_BODY" \
    --data-urlencode "id=$GC_ITEM_ID" \
    --data-urlencode 'expected_revision=1' \
    --data-urlencode "deletion_id=$GC_DELETION_ID")"
[[ "$GC_DELETE_STATUS" == "200" ]] || fail "GC-Stage lieferte HTTP $GC_DELETE_STATUS."
[[ -f "$GC_ORIGINAL_PATH" && -f "$GC_THUMB_PATH" ]] || fail "GC-Stage löschte Dateien zu früh."

EINKAUF_DATA_DIR="$TEST_DATA_DIR" php -r '
    $db = new PDO("sqlite:" . getenv("EINKAUF_DATA_DIR") . "/einkaufsliste.db");
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $stmt = $db->prepare("UPDATE deletion_tombstones SET expires_at = datetime(\"now\", \"-1 minute\") WHERE deletion_id = :deletion_id");
    $stmt->execute([":deletion_id" => $argv[1]]);
' "$GC_DELETION_ID"

api_get 'action=categories_list' >/dev/null
[[ ! -e "$GC_ORIGINAL_PATH" && ! -e "$GC_THUMB_PATH" ]] \
    || fail "Abgelaufener Tombstone wurde vom API-GC nicht bereinigt."

GC_UNDO_BODY="$TMP_DIR/gc-undo.json"
GC_UNDO_STATUS="$(api_post undo_delete gc-undo-request "$GC_UNDO_BODY" \
    --data-urlencode "deletion_id=$GC_DELETION_ID" \
    --data-urlencode "item_ids[]=$GC_ITEM_ID")"
[[ "$GC_UNDO_STATUS" == "410" ]] || fail "Undo nach GC lieferte HTTP $GC_UNDO_STATUS statt 410."
grep -q '"error_key":"error.deletion_purged"' "$GC_UNDO_BODY" \
    || fail "Undo nach GC ist nicht eindeutig als purged erkennbar."

echo "Slice 5 ok: Opportunistischer GC bereinigt abgelaufene Tombstones und markiert sie dauerhaft als purged."

EARLY_ADD_BODY="$TMP_DIR/early-undo-add.json"
EARLY_ADD_STATUS="$(api_post add early-undo-add-request "$EARLY_ADD_BODY" \
    --data-urlencode "category_id=$CATEGORY_ID" \
    --data-urlencode 'name=Undo vor Stage')"
[[ "$EARLY_ADD_STATUS" == "201" ]] || fail "Early-Undo-Item-Anlage lieferte HTTP $EARLY_ADD_STATUS."
EARLY_ITEM_ID="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["id"] ?? 0);' "$EARLY_ADD_BODY")"
EARLY_ITEM_REVISION="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["revision"] ?? 0);' "$EARLY_ADD_BODY")"
EARLY_DELETION_ID="delete-reordered-early-001"

EARLY_UNDO_BODY="$TMP_DIR/early-undo.json"
EARLY_UNDO_STATUS="$(api_post undo_delete early-undo-request "$EARLY_UNDO_BODY" \
    --data-urlencode "deletion_id=$EARLY_DELETION_ID" \
    --data-urlencode "item_ids[]=$EARLY_ITEM_ID")"
[[ "$EARLY_UNDO_STATUS" == "200" ]] || fail "Undo vor Stage lieferte HTTP $EARLY_UNDO_STATUS."
grep -q '"deletion_state":"not_staged"' "$EARLY_UNDO_BODY" \
    || fail "Undo vor Stage wurde nicht als not_staged erkannt."

LATE_STAGE_BODY="$TMP_DIR/late-stage.json"
LATE_STAGE_STATUS="$(api_post delete late-stage-request "$LATE_STAGE_BODY" \
    --data-urlencode "id=$EARLY_ITEM_ID" \
    --data-urlencode "expected_revision=$EARLY_ITEM_REVISION" \
    --data-urlencode "deletion_id=$EARLY_DELETION_ID")"
[[ "$LATE_STAGE_STATUS" == "409" ]] || fail "Verspäteter Stage nach frühem Undo lieferte HTTP $LATE_STAGE_STATUS statt 409."
grep -q '"error_key":"error.deletion_id_conflict"' "$LATE_STAGE_BODY" \
    || fail "Verspäteter Stage wurde nicht eindeutig abgelehnt."
api_get "action=list&category_id=$CATEGORY_ID" | php -r '
    $payload = json_decode(file_get_contents("php://stdin"), true);
    foreach (($payload["items"] ?? []) as $item) {
        if ((int) ($item["id"] ?? 0) === (int) $argv[1]) exit(0);
    }
    fwrite(STDERR, "Verspäteter Stage löschte Item trotz vorherigem Undo.\n");
    exit(1);
' "$EARLY_ITEM_ID" || fail "Offline-Reihenfolge verlor das rückgängig gemachte Item."

echo "Slice 6 ok: Frühes Offline-Undo blockiert eine verspätet eintreffende Stage-Anfrage."

LIFECYCLE_CATEGORY_BODY="$TMP_DIR/lifecycle-category.json"
LIFECYCLE_CATEGORY_STATUS="$(api_post categories_create lifecycle-category-request "$LIFECYCLE_CATEGORY_BODY" \
    --data-urlencode 'name=Tombstone Lebensdauer' \
    --data-urlencode 'type=list_quantity')"
[[ "$LIFECYCLE_CATEGORY_STATUS" == "201" ]] || fail "Lifecycle-Kategorie lieferte HTTP $LIFECYCLE_CATEGORY_STATUS."
LIFECYCLE_CATEGORY_ID="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["category"]["id"] ?? 0);' "$LIFECYCLE_CATEGORY_BODY")"

LIFECYCLE_ADD_BODY="$TMP_DIR/lifecycle-add.json"
LIFECYCLE_ADD_STATUS="$(api_post add lifecycle-add-request "$LIFECYCLE_ADD_BODY" \
    --data-urlencode "category_id=$LIFECYCLE_CATEGORY_ID" \
    --data-urlencode 'name=Kategorie muss bleiben')"
[[ "$LIFECYCLE_ADD_STATUS" == "201" ]] || fail "Lifecycle-Item lieferte HTTP $LIFECYCLE_ADD_STATUS."
LIFECYCLE_ITEM_ID="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["id"] ?? 0);' "$LIFECYCLE_ADD_BODY")"
LIFECYCLE_DELETION_ID="delete-category-lifecycle-001"

LIFECYCLE_DELETE_BODY="$TMP_DIR/lifecycle-delete.json"
LIFECYCLE_DELETE_STATUS="$(api_post delete lifecycle-delete-request "$LIFECYCLE_DELETE_BODY" \
    --data-urlencode "id=$LIFECYCLE_ITEM_ID" \
    --data-urlencode 'expected_revision=1' \
    --data-urlencode "deletion_id=$LIFECYCLE_DELETION_ID")"
[[ "$LIFECYCLE_DELETE_STATUS" == "200" ]] || fail "Lifecycle-Stage lieferte HTTP $LIFECYCLE_DELETE_STATUS."

DELETE_CATEGORY_BODY="$TMP_DIR/lifecycle-category-delete.json"
DELETE_CATEGORY_STATUS="$(api_post categories_delete lifecycle-category-delete-request "$DELETE_CATEGORY_BODY" \
    --data-urlencode "category_id=$LIFECYCLE_CATEGORY_ID")"
[[ "$DELETE_CATEGORY_STATUS" == "422" ]] || fail "Kategorie mit aktivem Tombstone lieferte beim Löschen HTTP $DELETE_CATEGORY_STATUS statt 422."
grep -q '"error_key":"error.category_not_empty"' "$DELETE_CATEGORY_BODY" \
    || fail "Aktiver Tombstone schützt Kategorie nicht mit bestehendem category_not_empty-Vertrag."

LIFECYCLE_UNDO_BODY="$TMP_DIR/lifecycle-undo.json"
LIFECYCLE_UNDO_STATUS="$(api_post undo_delete lifecycle-undo-request "$LIFECYCLE_UNDO_BODY" \
    --data-urlencode "deletion_id=$LIFECYCLE_DELETION_ID" \
    --data-urlencode "item_ids[]=$LIFECYCLE_ITEM_ID")"
[[ "$LIFECYCLE_UNDO_STATUS" == "200" ]] || fail "Undo nach Kategorie-Löschversuch lieferte HTTP $LIFECYCLE_UNDO_STATUS."
grep -q '"deletion_state":"restored"' "$LIFECYCLE_UNDO_BODY" \
    || fail "Undo nach Kategorie-Löschversuch stellte Item nicht wieder her."
LIFECYCLE_RESTORED_REVISION="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["restored_items"][0]["revision"] ?? 0);' "$LIFECYCLE_UNDO_BODY")"

LIFECYCLE_FINAL_DELETION_ID="delete-category-lifecycle-final-001"
LIFECYCLE_FINAL_STAGE_BODY="$TMP_DIR/lifecycle-final-stage.json"
LIFECYCLE_FINAL_STAGE_STATUS="$(api_post delete lifecycle-final-stage-request "$LIFECYCLE_FINAL_STAGE_BODY" \
    --data-urlencode "id=$LIFECYCLE_ITEM_ID" \
    --data-urlencode "expected_revision=$LIFECYCLE_RESTORED_REVISION" \
    --data-urlencode "deletion_id=$LIFECYCLE_FINAL_DELETION_ID")"
[[ "$LIFECYCLE_FINAL_STAGE_STATUS" == "200" ]] || fail "Lifecycle-Final-Stage lieferte HTTP $LIFECYCLE_FINAL_STAGE_STATUS."
LIFECYCLE_FINALIZE_BODY="$TMP_DIR/lifecycle-finalize.json"
LIFECYCLE_FINALIZE_STATUS="$(api_post finalize_delete lifecycle-finalize-request "$LIFECYCLE_FINALIZE_BODY" \
    --data-urlencode "deletion_id=$LIFECYCLE_FINAL_DELETION_ID")"
[[ "$LIFECYCLE_FINALIZE_STATUS" == "200" ]] || fail "Lifecycle-Finalize lieferte HTTP $LIFECYCLE_FINALIZE_STATUS."

DELETE_RELEASED_CATEGORY_BODY="$TMP_DIR/lifecycle-category-delete-released.json"
DELETE_RELEASED_CATEGORY_STATUS="$(api_post categories_delete lifecycle-category-delete-released-request "$DELETE_RELEASED_CATEGORY_BODY" \
    --data-urlencode "category_id=$LIFECYCLE_CATEGORY_ID")"
[[ "$DELETE_RELEASED_CATEGORY_STATUS" == "200" ]] || fail "Kategorie blieb nach Undo+neuem Finalize mit HTTP $DELETE_RELEASED_CATEGORY_STATUS gesperrt."

echo "Slice 7 ok: Stage schützt die Kategorie; Undo/Finalize geben sie ohne Cleanup-Metadatenverlust frei."

MALFORMED_UNDO_BODY="$TMP_DIR/malformed-undo.json"
MALFORMED_UNDO_STATUS="$(api_post undo_delete malformed-undo-request "$MALFORMED_UNDO_BODY" \
    --data-urlencode 'deletion_id=delete-malformed-item-ids-001' \
    --data-urlencode 'item_ids={not-json')"
[[ "$MALFORMED_UNDO_STATUS" == "422" ]] \
    || fail "Malformed item_ids-JSON lieferte HTTP $MALFORMED_UNDO_STATUS statt 422."
grep -q '"error_key":"error.invalid_params"' "$MALFORMED_UNDO_BODY" \
    || fail "Malformed item_ids-JSON lieferte keinen stabilen invalid_params-Fehler."

echo "Slice 8 ok: Ungültiges item_ids-JSON kann keine frühe Undo-Barriere umgehen."

RACE_ADD_A_BODY="$TMP_DIR/idempotency-race-add-a.json"
RACE_ADD_B_BODY="$TMP_DIR/idempotency-race-add-b.json"
[[ "$(api_post add idempotency-race-add-a "$RACE_ADD_A_BODY" \
    --data-urlencode "category_id=$CATEGORY_ID" \
    --data-urlencode 'name=Idempotenz Rennen A')" == "201" ]] \
    || fail "Idempotenz-Race-Item A konnte nicht angelegt werden."
[[ "$(api_post add idempotency-race-add-b "$RACE_ADD_B_BODY" \
    --data-urlencode "category_id=$CATEGORY_ID" \
    --data-urlencode 'name=Idempotenz Rennen B')" == "201" ]] \
    || fail "Idempotenz-Race-Item B konnte nicht angelegt werden."
RACE_ITEM_A="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["id"] ?? 0);' "$RACE_ADD_A_BODY")"
RACE_ITEM_B="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["id"] ?? 0);' "$RACE_ADD_B_BODY")"
RACE_REV_A="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["revision"] ?? 0);' "$RACE_ADD_A_BODY")"
RACE_REV_B="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["revision"] ?? 0);' "$RACE_ADD_B_BODY")"

# Halte kurz eine SQLite-Schreibsperre: Im alten Select-dann-Mutate-Ablauf
# passieren dadurch beide Requests den leeren Idempotency-SELECT, bevor ihre
# Tombstone-Transaktionen fortfahren. Eine echte atomare Reservierung blockiert
# dagegen schon vor dem ersten SELECT und lässt nur einen Body gewinnen.
RACE_LOCK_READY="$TMP_DIR/idempotency-race-lock-ready"
RACE_LOCK_RELEASE="$TMP_DIR/idempotency-race-lock-release"
EINKAUF_DATA_DIR="$TEST_DATA_DIR" php -r '
    $db = new PDO("sqlite:" . getenv("EINKAUF_DATA_DIR") . "/einkaufsliste.db");
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->exec("PRAGMA busy_timeout = 3000");
    $db->exec("BEGIN IMMEDIATE");
    file_put_contents($argv[1], "ready");
    for ($attempt = 0; $attempt < 100 && !is_file($argv[2]); $attempt++) usleep(50000);
    $db->exec("COMMIT");
' "$RACE_LOCK_READY" "$RACE_LOCK_RELEASE" &
RACE_LOCK_PID=$!
for _ in $(seq 1 40); do
    [[ -f "$RACE_LOCK_READY" ]] && break
    sleep 0.05
done
[[ -f "$RACE_LOCK_READY" ]] || fail "SQLite-Race-Sperre wurde nicht aktiv."

api_post delete shared-delete-idempotency-key "$TMP_DIR/idempotency-race-a.json" \
    --data-urlencode "id=$RACE_ITEM_A" \
    --data-urlencode "expected_revision=$RACE_REV_A" \
    --data-urlencode 'deletion_id=idempotency-race-delete-a' \
    >"$TMP_DIR/idempotency-race-a.status" &
RACE_PID_A=$!
api_post delete shared-delete-idempotency-key "$TMP_DIR/idempotency-race-b.json" \
    --data-urlencode "id=$RACE_ITEM_B" \
    --data-urlencode "expected_revision=$RACE_REV_B" \
    --data-urlencode 'deletion_id=idempotency-race-delete-b' \
    >"$TMP_DIR/idempotency-race-b.status" &
RACE_PID_B=$!
sleep 0.25
: >"$RACE_LOCK_RELEASE"
wait "$RACE_LOCK_PID"
unset RACE_LOCK_PID
wait "$RACE_PID_A"
wait "$RACE_PID_B"
RACE_STATUS_A="$(<"$TMP_DIR/idempotency-race-a.status")"
RACE_STATUS_B="$(<"$TMP_DIR/idempotency-race-b.status")"
RACE_STATUSES="$(printf '%s\n%s\n' "$RACE_STATUS_A" "$RACE_STATUS_B" | sort | tr '\n' ' ' | sed 's/ $//')"
[[ "$RACE_STATUSES" == "200 422" ]] \
    || fail "Parallele Requests mit kollidierendem Idempotency-Key lieferten [$RACE_STATUS_A,$RACE_STATUS_B] statt genau 200+422."
EINKAUF_DATA_DIR="$TEST_DATA_DIR" php -r '
    $db = new PDO("sqlite:" . getenv("EINKAUF_DATA_DIR") . "/einkaufsliste.db");
    $staged = (int) $db->query("SELECT COUNT(*) FROM deletion_tombstones WHERE deletion_id IN (\"idempotency-race-delete-a\", \"idempotency-race-delete-b\")")->fetchColumn();
    $live = (int) $db->query("SELECT COUNT(*) FROM items WHERE id IN (" . (int) $argv[1] . ", " . (int) $argv[2] . ")")->fetchColumn();
    if ($staged !== 1 || $live !== 1) exit(1);
' "$RACE_ITEM_A" "$RACE_ITEM_B" \
    || fail "Idempotency-Key-Kollision führte mehr als eine Delete-Mutation aus."

echo "Slice 9 ok: Der Idempotency-Key wird vor parallelen, abweichenden Delete-Mutationen atomar reserviert."

# Zehn dauerhaft fehlschlagende Purge-Retries dürfen einen neu abgelaufenen
# staged Tombstone nicht aus dem gemeinsamen GC-Limit verdrängen.
GC_FAIR_TARGET="$(EINKAUF_DATA_DIR="$TEST_DATA_DIR" php -r '
    $db = new PDO("sqlite:" . getenv("EINKAUF_DATA_DIR") . "/einkaufsliste.db");
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $userId = (int) $db->query("SELECT id FROM users WHERE username = \"testuser\"")->fetchColumn();
    $target = (string) $db->query("SELECT deletion_id FROM deletion_tombstones WHERE user_id = $userId AND state = \"staged\" ORDER BY created_at DESC LIMIT 1")->fetchColumn();
    if ($target === "") exit(1);
    $db->prepare("UPDATE deletion_tombstones SET expires_at = datetime(\"now\", \"-1 minute\") WHERE user_id = :user_id AND deletion_id = :deletion_id")
        ->execute([":user_id" => $userId, ":deletion_id" => $target]);
    $parent = $db->prepare("INSERT INTO deletion_tombstones
        (user_id, deletion_id, operation, state, request_fingerprint, item_count,
         item_ids_json, terminal_revisions_json, created_at, expires_at, purged_at)
        VALUES (:user_id, :deletion_id, \"delete\", \"purged\", :fingerprint, 1,
                :item_ids, :revisions, :created_at, :created_at, :created_at)");
    $payload = $db->prepare("INSERT INTO deletion_tombstone_items
        (user_id, deletion_id, item_id, category_id, item_order, item_json, attachment_json, terminal_revision)
        VALUES (:user_id, :deletion_id, :item_id, NULL, 0, :item_json, :attachment_json, 2)");
    for ($i = 1; $i <= 10; $i++) {
        $deletionId = "blocked-cleanup-" . $i;
        $itemId = 900000 + $i;
        $createdAt = sprintf("2000-01-%02d 00:00:00", $i);
        $parent->execute([
            ":user_id" => $userId,
            ":deletion_id" => $deletionId,
            ":fingerprint" => str_repeat(dechex($i), 64),
            ":item_ids" => json_encode([$itemId]),
            ":revisions" => json_encode([$itemId => 2]),
            ":created_at" => $createdAt,
        ]);
        $payload->execute([
            ":user_id" => $userId,
            ":deletion_id" => $deletionId,
            ":item_id" => $itemId,
            ":item_json" => json_encode(["id" => $itemId]),
            ":attachment_json" => json_encode(["storage_section" => "invalid", "stored_name" => "blocked-$i.bin"]),
        ]);
    }
    echo $target;
')" || fail "GC-Fairness-Fixture konnte nicht angelegt werden."
api_get 'action=categories_list' >/dev/null
GC_FAIR_STATE="$(EINKAUF_DATA_DIR="$TEST_DATA_DIR" php -r '
    $db = new PDO("sqlite:" . getenv("EINKAUF_DATA_DIR") . "/einkaufsliste.db");
    $db->exec("PRAGMA foreign_keys = ON");
    $stmt = $db->prepare("SELECT state FROM deletion_tombstones WHERE deletion_id = :deletion_id");
    $stmt->execute([":deletion_id" => $argv[1]]);
    $state = (string) $stmt->fetchColumn();
    $db->exec("DELETE FROM deletion_tombstones WHERE deletion_id LIKE \"blocked-cleanup-%\"");
    echo $state;
' "$GC_FAIR_TARGET")"
[[ "$GC_FAIR_STATE" == "purged" ]] \
    || fail "Zehn alte Cleanup-Retries ließen den abgelaufenen Stage-Tombstone im Zustand $GC_FAIR_STATE verhungern."

echo "Slice 10 ok: Abgelaufene Stages und fehlgeschlagene Datei-Retries haben getrennte faire GC-Limits."

USER_DELETE_UPLOAD_BODY="$TMP_DIR/user-delete-upload.json"
USER_DELETE_UPLOAD_STATUS="$(api_post upload user-delete-upload-request "$USER_DELETE_UPLOAD_BODY" \
    -F "category_id=$IMAGE_CATEGORY_ID" \
    -F 'name=Tombstone User Cascade' \
    -F "attachment=@$ROOT_DIR/public/icons/favicon.png;type=image/png")"
[[ "$USER_DELETE_UPLOAD_STATUS" == "201" ]] || fail "User-Cascade-Upload lieferte HTTP $USER_DELETE_UPLOAD_STATUS."
USER_DELETE_ITEM_ID="$(php -r 'echo (int) (json_decode(file_get_contents($argv[1]), true)["id"] ?? 0);' "$USER_DELETE_UPLOAD_BODY")"
USER_DELETE_ORIGINAL_PATH="$(find "$TEST_DATA_DIR/uploads/images" -maxdepth 1 -type f ! -name 'thumb-*' | head -n 1)"
[[ -n "$USER_DELETE_ORIGINAL_PATH" && -f "$USER_DELETE_ORIGINAL_PATH" ]] || fail "User-Cascade-Attachment fehlt."
USER_DELETE_STORED_NAME="$(basename "$USER_DELETE_ORIGINAL_PATH")"
USER_DELETE_THUMB_PATH="$TEST_DATA_DIR/uploads/images/thumb-${USER_DELETE_STORED_NAME%.*}.jpg"
if [[ ! -f "$USER_DELETE_THUMB_PATH" ]]; then
    php -r 'if (!copy($argv[1], $argv[2])) exit(1);' "$USER_DELETE_ORIGINAL_PATH" "$USER_DELETE_THUMB_PATH" \
        || fail "User-Cascade-Thumbnail konnte nicht angelegt werden."
fi

USER_DELETE_DELETION_ID="delete-user-cascade-001"
USER_DELETE_STAGE_BODY="$TMP_DIR/user-delete-stage.json"
USER_DELETE_STAGE_STATUS="$(api_post delete user-delete-stage-request "$USER_DELETE_STAGE_BODY" \
    --data-urlencode "id=$USER_DELETE_ITEM_ID" \
    --data-urlencode 'expected_revision=1' \
    --data-urlencode "deletion_id=$USER_DELETE_DELETION_ID")"
[[ "$USER_DELETE_STAGE_STATUS" == "200" ]] || fail "User-Cascade-Stage lieferte HTTP $USER_DELETE_STAGE_STATUS."

# Simuliere einen transienten Dateisystemfehler: Der User darf trotzdem atomar
# verschwinden, aber der letzte Cleanup-Nachweis muss bis zum Retry bestehen.
chmod 0500 "$TEST_DATA_DIR/uploads/images"

ADMIN_COOKIE_JAR="$TMP_DIR/admin-cookies.txt"
ADMIN_LOGIN_HTML="$TMP_DIR/admin-login.html"
curl -fsS -c "$ADMIN_COOKIE_JAR" "http://127.0.0.1:$PORT/login.php" >"$ADMIN_LOGIN_HTML"
ADMIN_LOGIN_CSRF="$(sed -n 's/.*name="csrf_token" value="\([^"]*\)".*/\1/p' "$ADMIN_LOGIN_HTML" | head -n 1)"
[[ -n "$ADMIN_LOGIN_CSRF" ]] || fail "Admin-Login-CSRF fehlt."
ADMIN_PAGE="$TMP_DIR/admin-page.html"
curl -fsS -b "$ADMIN_COOKIE_JAR" -c "$ADMIN_COOKIE_JAR" -X POST \
    --data-urlencode 'username=testadmin' \
    --data-urlencode 'password=adminpass123' \
    --data-urlencode "csrf_token=$ADMIN_LOGIN_CSRF" \
    -L "http://127.0.0.1:$PORT/login.php" >"$ADMIN_PAGE"
ADMIN_CSRF="$(sed -n 's/.*name="csrf_token" value="\([^"]*\)".*/\1/p' "$ADMIN_PAGE" | head -n 1)"
[[ -n "$ADMIN_CSRF" ]] || fail "Admin-Seiten-CSRF fehlt."
TEST_USER_ID="$(EINKAUF_DATA_DIR="$TEST_DATA_DIR" php -r '
    $db = new PDO("sqlite:" . getenv("EINKAUF_DATA_DIR") . "/einkaufsliste.db");
    echo (int) $db->query("SELECT id FROM users WHERE username = \"testuser\"")->fetchColumn();
')"

ADMIN_DELETE_BODY="$TMP_DIR/admin-user-delete.html"
ADMIN_DELETE_STATUS="$(curl -sS -b "$ADMIN_COOKIE_JAR" -c "$ADMIN_COOKIE_JAR" -X POST \
    --data-urlencode 'action=delete' \
    --data-urlencode "user_id=$TEST_USER_ID" \
    --data-urlencode "csrf_token=$ADMIN_CSRF" \
    -o "$ADMIN_DELETE_BODY" \
    -w '%{http_code}' \
    "http://127.0.0.1:$PORT/admin.php")"
[[ "$ADMIN_DELETE_STATUS" == "200" ]] || fail "Admin-Nutzerlöschung lieferte HTTP $ADMIN_DELETE_STATUS."
[[ -e "$USER_DELETE_ORIGINAL_PATH" && -e "$USER_DELETE_THUMB_PATH" ]] \
    || fail "Der simulierte Cleanup-Fehler trat nicht wie erwartet auf."
EINKAUF_DATA_DIR="$TEST_DATA_DIR" php -r '
    $db = new PDO("sqlite:" . getenv("EINKAUF_DATA_DIR") . "/einkaufsliste.db");
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->exec("PRAGMA foreign_keys = ON");
    if ((int) $db->query("SELECT COUNT(*) FROM users WHERE username = \"testuser\"")->fetchColumn() !== 0) exit(1);
    if ((int) $db->query("SELECT COUNT(*) FROM deletion_tombstones WHERE user_id = " . (int) $argv[1])->fetchColumn() !== 0) exit(1);
    if ((int) $db->query("SELECT COUNT(*) FROM attachment_cleanup_jobs")->fetchColumn() < 1) exit(1);
    if ($db->query("PRAGMA foreign_key_check")->fetchAll(PDO::FETCH_ASSOC) !== []) exit(1);
' "$TEST_USER_ID" || fail "Admin-Nutzerlöschung ließ Tombstone- oder FK-Reste zurück."

chmod 0700 "$TEST_DATA_DIR/uploads/images"
EINKAUF_DATA_DIR="$TEST_DATA_DIR" php -r '
    $db = new PDO("sqlite:" . getenv("EINKAUF_DATA_DIR") . "/einkaufsliste.db");
    $db->exec("UPDATE attachment_cleanup_jobs SET next_attempt_at = datetime(\"now\", \"-1 minute\")");
'
curl -fsS -H "X-Api-Key: $ADMIN_API_KEY" \
    "http://127.0.0.1:$PORT/api.php?action=categories_list" >/dev/null \
    || fail "Cleanup-Retry konnte nicht über die öffentliche API ausgelöst werden."
[[ ! -e "$USER_DELETE_ORIGINAL_PATH" && ! -e "$USER_DELETE_THUMB_PATH" ]] \
    || fail "Persistenter Cleanup-Job löschte Attachment und Thumbnail beim Retry nicht."
EINKAUF_DATA_DIR="$TEST_DATA_DIR" php -r '
    $db = new PDO("sqlite:" . getenv("EINKAUF_DATA_DIR") . "/einkaufsliste.db");
    if ((int) $db->query("SELECT COUNT(*) FROM attachment_cleanup_jobs")->fetchColumn() !== 0) exit(1);
' || fail "Erfolgreicher Cleanup-Retry ließ Job-Metadaten zurück."

echo "Slice 11 ok: User-Cascade bewahrt Dateifehler persistent auf und GC bereinigt sie idempotent."
