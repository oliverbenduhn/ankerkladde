#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-18080}"
TMP_DIR="$(mktemp -d)"
COOKIE_JAR="$TMP_DIR/cookies.txt"
INDEX_HTML="$TMP_DIR/index.html"
SERVER_LOG="$TMP_DIR/server.log"
TEST_DATA_DIR="$TMP_DIR/data"
MANIFEST_HEADERS="$TMP_DIR/manifest-headers.txt"
MANIFEST_BODY="$TMP_DIR/manifest.json"

cleanup() {
    if [[ -n "${SERVER_PID:-}" ]]; then
        kill "$SERVER_PID" >/dev/null 2>&1 || true
        wait "$SERVER_PID" >/dev/null 2>&1 || true
    fi
    if [[ -n "${SUBPATH_SERVER_PID:-}" ]]; then
        kill "$SUBPATH_SERVER_PID" >/dev/null 2>&1 || true
        wait "$SUBPATH_SERVER_PID" >/dev/null 2>&1 || true
    fi
    rm -rf "$TMP_DIR"
}

trap cleanup EXIT

mkdir -p "$TEST_DATA_DIR"

PHP_CLI_SERVER_WORKERS=4 EINKAUF_DATA_DIR="$TEST_DATA_DIR" EINKAUF_TRUST_PROXY_HEADERS=0 php \
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

# Seed test users into the fresh database
EINKAUF_DATA_DIR="$TEST_DATA_DIR" \
EINKAUF_ADMIN_USER=testadmin \
EINKAUF_ADMIN_PASS=adminpass123 \
EINKAUF_REGULAR_USER=testuser \
EINKAUF_REGULAR_PASS=userpass123 \
php "$ROOT_DIR/scripts/create-admin.php"

JOURNAL_CONCURRENCY_API_KEY="smoke-journal-concurrency-key"
EINKAUF_DATA_DIR="$TEST_DATA_DIR" php -r '
    require $argv[1] . "/security.php";
    require $argv[1] . "/db.php";
    $db = getDatabase();
    $stmt = $db->prepare("UPDATE users SET api_key = :api_key, api_key_created_at = CURRENT_TIMESTAMP WHERE username = :username");
    $stmt->execute([":api_key" => $argv[2], ":username" => "testuser"]);
' "$ROOT_DIR" "$JOURNAL_CONCURRENCY_API_KEY"

# Login as testuser to get a session
LOGIN_HTML="$TMP_DIR/login.html"
curl -fsS -c "$COOKIE_JAR" "http://127.0.0.1:$PORT/login.php" >"$LOGIN_HTML"
LOGIN_CSRF="$(sed -n 's/.*name="csrf_token" value="\([^"]*\)".*/\1/p' "$LOGIN_HTML" | head -n 1)"

if [[ -z "$LOGIN_CSRF" ]]; then
    echo "CSRF-Token konnte nicht aus der Login-Seite gelesen werden." >&2
    exit 1
fi

curl -fsS \
    -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -X POST \
    --data-urlencode "username=testuser" \
    --data-urlencode "password=userpass123" \
    --data-urlencode "csrf_token=$LOGIN_CSRF" \
    -L "http://127.0.0.1:$PORT/login.php" >"$INDEX_HTML"

CSRF_TOKEN="$(sed -n 's/.*name="csrf-token" content="\([^"]*\)".*/\1/p' "$INDEX_HTML" | head -n 1)"

if [[ -z "$CSRF_TOKEN" ]]; then
    echo "CSRF-Token konnte nicht aus der Index-Seite gelesen werden (Login fehlgeschlagen?)." >&2
    exit 1
fi

grep -Eq '<link rel="manifest" href="manifest\.php(\?v=[^"]+)?"' "$INDEX_HTML"
curl -fsS -b "$COOKIE_JAR" -D "$MANIFEST_HEADERS" -o "$MANIFEST_BODY" "http://127.0.0.1:$PORT/manifest.php"
grep -qi '^Content-Type: application/manifest+json' "$MANIFEST_HEADERS"
php -r '
    $manifest = json_decode(file_get_contents($argv[1]), true, 512, JSON_THROW_ON_ERROR);
    $shortcuts = $manifest["shortcuts"] ?? null;
    if (!is_array($shortcuts)) exit(1);
    $names = array_map(static fn(array $shortcut): string => (string) ($shortcut["name"] ?? ""), $shortcuts);
    $urls = array_map(static fn(array $shortcut): string => (string) ($shortcut["url"] ?? ""), $shortcuts);
    if (!in_array("Heute", $names, true) || !in_array("/?screen=journal&date=today", $urls, true)) exit(1);
    if (!in_array("Neue Notiz", $names, true) || !in_array("/?screen=journal&date=today&focus=editor", $urls, true)) exit(1);
    if (!in_array("Barcode scannen", $names, true)) exit(1);
' "$MANIFEST_BODY"
curl -fsS -b "$COOKIE_JAR" -o /dev/null "http://127.0.0.1:$PORT/icon.php?size=144"
curl -fsS -b "$COOKIE_JAR" -o /dev/null "http://127.0.0.1:$PORT/category-icon.php?icon=einkauf"

status_code() {
    local output_file=$1
    shift
    curl -sS -o "$output_file" -w '%{http_code}' "$@"
}

LIST_BODY="$TMP_DIR/list.json"
TODO_CATEGORIES_BODY="$TMP_DIR/todo-categories.json"
ADD_BODY="$TMP_DIR/add.json"
ADD_SECOND_BODY="$TMP_DIR/add-second.json"
UNICODE_ADD_BODY="$TMP_DIR/unicode-add.json"
UNICODE_DELETE_BODY="$TMP_DIR/unicode-delete.json"
UNICODE_LIST_BODY="$TMP_DIR/unicode-list.json"
NOTE_UNICODE_ADD_BODY="$TMP_DIR/note-unicode-add.json"
NOTE_UNICODE_LIST_BODY="$TMP_DIR/note-unicode-list.json"
JOURNAL_EMPTY_BODY="$TMP_DIR/journal-empty.json"
JOURNAL_CREATE_BODY="$TMP_DIR/journal-create.json"
JOURNAL_UPDATE_BODY="$TMP_DIR/journal-update.json"
JOURNAL_SEARCH_BODY="$TMP_DIR/journal-search.json"
JOURNAL_CONCURRENT_DATE="2026-07-18"
TODO_ADD_BODY="$TMP_DIR/todo-add.json"
TODO_LIST_BODY="$TMP_DIR/todo-list.json"
TODAY_BODY="$TMP_DIR/today.json"
TODAY_EXPLICIT_BODY="$TMP_DIR/today-explicit.json"
AGENDA_DATE_BODY="$TMP_DIR/agenda-date.json"
AGENDA_INVALID_BODY="$TMP_DIR/agenda-invalid.json"
TODAY_ADD_BODY="$TMP_DIR/today-add.json"
TODAY_DONE_ADD_BODY="$TMP_DIR/today-done-add.json"
TODAY_TIMED_EARLY_BODY="$TMP_DIR/today-timed-early.json"
TODAY_TIMED_LATE_BODY="$TMP_DIR/today-timed-late.json"
QUICK_ADD_UNKNOWN_BODY="$TMP_DIR/quick-add-unknown.json"
QUICK_ADD_BEFORE_BODY="$TMP_DIR/quick-add-before.json"
QUICK_ADD_AFTER_BODY="$TMP_DIR/quick-add-after.json"
MOVE_CATEGORY_BODY="$TMP_DIR/move-category.json"
MOVE_ADD_BODY="$TMP_DIR/move-add.json"
MOVE_INVALID_BODY="$TMP_DIR/move-invalid.json"
MOVE_BODY="$TMP_DIR/move.json"
MOVE_SOURCE_LIST_BODY="$TMP_DIR/move-source-list.json"
MOVE_TARGET_LIST_BODY="$TMP_DIR/move-target-list.json"
REORDER_BODY="$TMP_DIR/reorder.json"
REORDERED_LIST_BODY="$TMP_DIR/reordered-list.json"
INVALID_REORDER_BODY="$TMP_DIR/reorder-invalid.json"
DUPLICATE_REORDER_BODY="$TMP_DIR/reorder-duplicate.json"
UPDATE_BODY="$TMP_DIR/update.json"
TODO_UPDATE_BODY="$TMP_DIR/todo-update.json"
INVALID_UPDATE_BODY="$TMP_DIR/update-invalid.json"
TOGGLE_BODY="$TMP_DIR/toggle.json"
POST_TOGGLE_LIST_BODY="$TMP_DIR/post-toggle-list.json"
FILES_ADD_BODY="$TMP_DIR/files-add.json"
FILES_LIST_BODY="$TMP_DIR/files-list.json"
BIG_FILES_ADD_BODY="$TMP_DIR/big-files-add.json"
BIG_FILES_LIST_BODY="$TMP_DIR/big-files-list.json"
MEDIA_BODY="$TMP_DIR/media-body.txt"
MEDIA_HEADERS="$TMP_DIR/media-headers.txt"
FILES_DELETE_BODY="$TMP_DIR/files-delete.json"
IMAGE_UPLOAD_BODY="$TMP_DIR/image-upload.json"
IMAGE_LIST_BODY="$TMP_DIR/image-list.json"
IMAGE_MEDIA_BODY="$TMP_DIR/image-media.bin"
IMAGE_MEDIA_HEADERS="$TMP_DIR/image-media-headers.txt"
IMAGE_DOWNLOAD_HEADERS="$TMP_DIR/image-download-headers.txt"
INVALID_IMAGE_BODY="$TMP_DIR/invalid-image.json"
MISSING_UPLOAD_BODY="$TMP_DIR/missing-upload.json"
MISSING_MEDIA_BODY="$TMP_DIR/missing-media.txt"
CLEAR_BODY="$TMP_DIR/clear.json"
POST_CLEAR_LIST_BODY="$TMP_DIR/post-clear-list.json"
FORBIDDEN_BODY="$TMP_DIR/forbidden.json"
NOT_FOUND_BODY="$TMP_DIR/not-found.txt"
REDIRECT_HEADERS="$TMP_DIR/redirect-headers.txt"
SPOOF_REDIRECT_HEADERS="$TMP_DIR/spoof-redirect-headers.txt"
COOKIE_HEADERS="$TMP_DIR/cookie-headers.txt"
SUBPATH_ROOT="$TMP_DIR/subpath-root"
SUBPATH_PORT=$((PORT + 1))
SUBPATH_HTML="$TMP_DIR/subpath-index.html"
SUBPATH_MANIFEST="$TMP_DIR/subpath-manifest.json"
FILE_UPLOAD_SOURCE="$TMP_DIR/Rechnung.txt"
BIG_FILE_UPLOAD_SOURCE="$TMP_DIR/Grosse-Datei.bin"
IMAGE_UPLOAD_SOURCE="$TMP_DIR/Bild.png"
INVALID_IMAGE_SOURCE="$TMP_DIR/kein-bild.txt"

printf 'Smoke attachment\n' >"$FILE_UPLOAD_SOURCE"
truncate -s 26M "$BIG_FILE_UPLOAD_SOURCE"
printf 'not really an image\n' >"$INVALID_IMAGE_SOURCE"
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR9QAAAAASUVORK5CYII=' \
    | base64 -d >"$IMAGE_UPLOAD_SOURCE"

[[ "$(status_code "$LIST_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list")" == "200" ]]
grep -q '"items"' "$LIST_BODY"

[[ "$(status_code "$TODO_CATEGORIES_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=categories_list")" == "200" ]]
TODO_CATEGORY_ID="$(php -r '$payload = json_decode(file_get_contents($argv[1]), true); foreach (($payload["categories"] ?? []) as $category) { if (($category["type"] ?? "") === "list_due_date") { echo (int) ($category["id"] ?? 0); exit; } } exit(1);' "$TODO_CATEGORIES_BODY")"
SHOPPING_CATEGORY_ID="$(php -r '$payload = json_decode(file_get_contents($argv[1]), true); foreach (($payload["categories"] ?? []) as $category) { if (($category["type"] ?? "") === "list_quantity") { echo (int) ($category["id"] ?? 0); exit; } } exit(1);' "$TODO_CATEGORIES_BODY")"
NOTES_CATEGORY_ID="$(php -r '$payload = json_decode(file_get_contents($argv[1]), true); foreach (($payload["categories"] ?? []) as $category) { if (($category["type"] ?? "") === "notes") { echo (int) ($category["id"] ?? 0); exit; } } exit(1);' "$TODO_CATEGORIES_BODY")"
JOURNAL_CATEGORY_ID="$(php -r '$payload = json_decode(file_get_contents($argv[1]), true); foreach (($payload["categories"] ?? []) as $category) { if (($category["type"] ?? "") === "daily_notes") { echo (int) ($category["id"] ?? 0); exit; } } exit(1);' "$TODO_CATEGORIES_BODY")"

if [[ -z "$TODO_CATEGORY_ID" || "$TODO_CATEGORY_ID" -le 0 ]]; then
    echo "Todo-Kategorie konnte nicht aus categories_list gelesen werden." >&2
    exit 1
fi

if [[ -z "$SHOPPING_CATEGORY_ID" || "$SHOPPING_CATEGORY_ID" -le 0 ]]; then
    echo "Einkauf-Kategorie konnte nicht aus categories_list gelesen werden." >&2
    exit 1
fi

if [[ -z "$NOTES_CATEGORY_ID" || "$NOTES_CATEGORY_ID" -le 0 ]]; then
    echo "Notizen-Kategorie konnte nicht aus categories_list gelesen werden." >&2
    exit 1
fi

[[ "$(status_code "$QUICK_ADD_BEFORE_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list&category_id=$SHOPPING_CATEGORY_ID")" == "200" ]]
QUICK_ADD_COUNT_BEFORE="$(php -r '$payload = json_decode(file_get_contents($argv[1]), true); echo count($payload["items"] ?? []);' "$QUICK_ADD_BEFORE_BODY")"
[[ "$(status_code "$QUICK_ADD_UNKNOWN_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST --data-urlencode "active_category_id=$SHOPPING_CATEGORY_ID" --data-urlencode 'input=Milch /unbekannt' "http://127.0.0.1:$PORT/api.php?action=quick_add")" == "422" ]]
php -r '$payload = json_decode(file_get_contents($argv[1]), true); if (($payload["error_key"] ?? "") !== "quick_add.unknown_category" || !array_key_exists("can_escalate_to_ai", $payload)) { fwrite(STDERR, "Quick-Add-Fehlerform ist ungültig.\n"); exit(1); }' "$QUICK_ADD_UNKNOWN_BODY"
[[ "$(status_code "$QUICK_ADD_AFTER_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list&category_id=$SHOPPING_CATEGORY_ID")" == "200" ]]
QUICK_ADD_COUNT_AFTER="$(php -r '$payload = json_decode(file_get_contents($argv[1]), true); echo count($payload["items"] ?? []);' "$QUICK_ADD_AFTER_BODY")"
[[ "$QUICK_ADD_COUNT_AFTER" == "$QUICK_ADD_COUNT_BEFORE" ]]

if [[ -z "$JOURNAL_CATEGORY_ID" || "$JOURNAL_CATEGORY_ID" -le 0 ]]; then
    echo "Journal-Kategorie konnte nicht aus categories_list gelesen werden." >&2
    exit 1
fi

JOURNAL_CATEGORY_COUNT="$(EINKAUF_DATA_DIR="$TEST_DATA_DIR" php -r '$db = new PDO("sqlite:" . getenv("EINKAUF_DATA_DIR") . "/einkaufsliste.db"); echo (int) $db->query("SELECT COUNT(*) FROM categories WHERE type = \"daily_notes\"")->fetchColumn();')"
[[ "$JOURNAL_CATEGORY_COUNT" == "1" ]]

[[ "$(status_code "$JOURNAL_EMPTY_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=journal&date=2026-07-17")" == "200" ]]
php -r '$payload = json_decode(file_get_contents($argv[1]), true); if (($payload["date"] ?? "") !== "2026-07-17" || ($payload["item"] ?? null) !== null) { fwrite(STDERR, "Leerer Journaltag hat unerwartete Daten erzeugt.\n"); exit(1); }' "$JOURNAL_EMPTY_BODY"

JOURNAL_ITEM_COUNT="$(EINKAUF_DATA_DIR="$TEST_DATA_DIR" php -r '$db = new PDO("sqlite:" . getenv("EINKAUF_DATA_DIR") . "/einkaufsliste.db"); echo (int) $db->query("SELECT COUNT(*) FROM items i INNER JOIN categories c ON c.id = i.category_id WHERE c.type = \"daily_notes\"")->fetchColumn();')"
[[ "$JOURNAL_ITEM_COUNT" == "0" ]]

[[ "$(status_code "$JOURNAL_CREATE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST --data-urlencode 'date=2026-07-17' --data-urlencode 'content=<p>JournalFtsTreffer erster Stand</p>' "http://127.0.0.1:$PORT/api.php?action=journal_save")" == "201" ]]
JOURNAL_ITEM_ID="$(php -r '$payload = json_decode(file_get_contents($argv[1]), true); echo (int) ($payload["item"]["id"] ?? 0);' "$JOURNAL_CREATE_BODY")"
[[ "$JOURNAL_ITEM_ID" -gt 0 ]]

[[ "$(status_code "$JOURNAL_UPDATE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST --data-urlencode 'date=2026-07-17' --data-urlencode 'content=<p>JournalFtsTreffer aktualisiert</p>' "http://127.0.0.1:$PORT/api.php?action=journal_save")" == "200" ]]
php -r '$payload = json_decode(file_get_contents($argv[1]), true); if ((int) ($payload["item"]["id"] ?? 0) !== (int) $argv[2] || !str_contains((string) ($payload["item"]["content"] ?? ""), "aktualisiert")) { fwrite(STDERR, "Journal-Upsert hat nicht dasselbe Item aktualisiert.\n"); exit(1); }' "$JOURNAL_UPDATE_BODY" "$JOURNAL_ITEM_ID"

JOURNAL_ITEM_COUNT="$(EINKAUF_DATA_DIR="$TEST_DATA_DIR" php -r '$db = new PDO("sqlite:" . getenv("EINKAUF_DATA_DIR") . "/einkaufsliste.db"); echo (int) $db->query("SELECT COUNT(*) FROM items i INNER JOIN categories c ON c.id = i.category_id WHERE c.type = \"daily_notes\"")->fetchColumn();')"
[[ "$JOURNAL_ITEM_COUNT" == "1" ]]

JOURNAL_CONCURRENT_PIDS=()
for request_number in 1 2 3 4; do
    curl -sS -o "$TMP_DIR/journal-concurrent-$request_number.json" -w '%{http_code}' \
        -H "Authorization: Bearer $JOURNAL_CONCURRENCY_API_KEY" \
        -X POST \
        --data-urlencode "date=$JOURNAL_CONCURRENT_DATE" \
        --data-urlencode "content=<p>Parallel $request_number</p>" \
        "http://127.0.0.1:$PORT/api.php?action=journal_save" \
        >"$TMP_DIR/journal-concurrent-$request_number.status" &
    JOURNAL_CONCURRENT_PIDS+=("$!")
done
for request_pid in "${JOURNAL_CONCURRENT_PIDS[@]}"; do
    wait "$request_pid"
done
for request_number in 1 2 3 4; do
    grep -Eq '^(200|201)$' "$TMP_DIR/journal-concurrent-$request_number.status"
done
JOURNAL_CONCURRENT_COUNT="$(EINKAUF_DATA_DIR="$TEST_DATA_DIR" php -r '$db = new PDO("sqlite:" . getenv("EINKAUF_DATA_DIR") . "/einkaufsliste.db"); $stmt = $db->prepare("SELECT COUNT(*) FROM items i INNER JOIN categories c ON c.id = i.category_id WHERE c.type = :type AND i.due_date = :due_date"); $stmt->execute([":type" => "daily_notes", ":due_date" => $argv[1]]); echo (int) $stmt->fetchColumn();' "$JOURNAL_CONCURRENT_DATE")"
[[ "$JOURNAL_CONCURRENT_COUNT" == "1" ]]

[[ "$(status_code "$JOURNAL_SEARCH_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=search&q=JournalFtsTreffer")" == "200" ]]
php -r '$payload = json_decode(file_get_contents($argv[1]), true); $id = (int) $argv[2]; foreach (($payload["items"] ?? []) as $item) { if ((int) ($item["id"] ?? 0) === $id && ($item["category_type"] ?? "") === "daily_notes") { exit(0); } } fwrite(STDERR, "Journal-Inhalt wurde nicht über FTS gefunden.\n"); exit(1);' "$JOURNAL_SEARCH_BODY" "$JOURNAL_ITEM_ID"

[[ "$(curl -sS -o /dev/null -D "$REDIRECT_HEADERS" -w '%{http_code}' -H 'Host: beispiel.invalid' "http://127.0.0.1:$PORT/")" == "308" ]]
grep -q '^Location: https://ankerkladde\.benduhn\.de/' "$REDIRECT_HEADERS"

[[ "$(curl -sS -o /dev/null -D "$SPOOF_REDIRECT_HEADERS" -w '%{http_code}' -H 'Host: beispiel.invalid' -H 'X-Forwarded-Host: ankerkladde.benduhn.de' "http://127.0.0.1:$PORT/")" == "308" ]]
grep -q '^Location: https://ankerkladde\.benduhn\.de/' "$SPOOF_REDIRECT_HEADERS"

curl -sS -D "$COOKIE_HEADERS" -o /dev/null -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$PORT/"
if grep -Eqi '^Set-Cookie: .*;[[:space:]]*Secure([;]|$)' "$COOKIE_HEADERS"; then
    echo "Unvertrauenswürdiger X-Forwarded-Proto Header darf kein Secure-Cookie erzwingen." >&2
    exit 1
fi

# Without session: expect 401 (not authenticated)
UNAUTH_BODY="$TMP_DIR/unauth.json"
[[ "$(status_code "$UNAUTH_BODY" -X POST -d 'name=Milch' "http://127.0.0.1:$PORT/api.php?action=add")" == "401" ]]

# With session but no CSRF token: expect 403
[[ "$(status_code "$FORBIDDEN_BODY" -b "$COOKIE_JAR" -X POST -d 'name=Milch' "http://127.0.0.1:$PORT/api.php?action=add")" == "403" ]]
grep -q 'Sicherheits-Token' "$FORBIDDEN_BODY"

[[ "$(status_code "$ADD_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d 'name=Milch&quantity=2x' "http://127.0.0.1:$PORT/api.php?action=add")" == "201" ]]
ITEM_ID="$(sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' "$ADD_BODY" | head -n 1)"

if [[ -z "$ITEM_ID" ]]; then
    echo "Artikel-ID konnte nicht aus der Add-Antwort gelesen werden." >&2
    exit 1
fi

[[ "$(status_code "$UNICODE_ADD_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST --data-urlencode "category_id=$SHOPPING_CATEGORY_ID" --data-urlencode 'name=Öl' --data-urlencode 'quantity=1' "http://127.0.0.1:$PORT/api.php?action=add")" == "201" ]]
UNICODE_ITEM_ID="$(sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' "$UNICODE_ADD_BODY" | head -n 1)"
if [[ -z "$UNICODE_ITEM_ID" ]]; then
    echo "Unicode-Artikel-ID konnte nicht aus der Add-Antwort gelesen werden." >&2
    exit 1
fi
[[ "$(status_code "$UNICODE_LIST_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list&category_id=$SHOPPING_CATEGORY_ID")" == "200" ]]
php -r '$payload = json_decode(file_get_contents($argv[1]), true); foreach (($payload["items"] ?? []) as $item) { if (($item["name"] ?? "") === "Öl") { exit(0); } } fwrite(STDERR, "Unicode-Artikel wurde nicht korrekt gespeichert.\n"); exit(1);' "$UNICODE_LIST_BODY"
[[ "$(status_code "$UNICODE_DELETE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d "id=$UNICODE_ITEM_ID" "http://127.0.0.1:$PORT/api.php?action=delete")" == "200" ]]

[[ "$(status_code "$NOTE_UNICODE_ADD_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST --data-urlencode "category_id=$NOTES_CATEGORY_ID" --data-urlencode 'name=Umlaut Notiz' --data-urlencode 'content=<p>Ä Ü Ö ü ö ä</p>' "http://127.0.0.1:$PORT/api.php?action=add")" == "201" ]]
[[ "$(status_code "$NOTE_UNICODE_LIST_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list&category_id=$NOTES_CATEGORY_ID")" == "200" ]]
php -r '$payload = json_decode(file_get_contents($argv[1]), true); foreach (($payload["items"] ?? []) as $item) { if (($item["name"] ?? "") === "Umlaut Notiz" && str_contains((string) ($item["content"] ?? ""), "Ä Ü Ö ü ö ä")) { exit(0); } } fwrite(STDERR, "Unicode-Notizinhalt wurde nicht korrekt gespeichert.\n"); exit(1);' "$NOTE_UNICODE_LIST_BODY"

[[ "$(status_code "$TODO_ADD_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST --data-urlencode "category_id=$TODO_CATEGORY_ID" --data-urlencode 'name=Abgabe' --data-urlencode 'due_date=2026-05-01' "http://127.0.0.1:$PORT/api.php?action=add")" == "201" ]]
TODO_ITEM_ID="$(sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' "$TODO_ADD_BODY" | head -n 1)"

if [[ -z "$TODO_ITEM_ID" ]]; then
    echo "Todo-Artikel-ID konnte nicht aus der Add-Antwort gelesen werden." >&2
    exit 1
fi

[[ "$(status_code "$FILES_ADD_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    -F "section=files" \
    -F "file=@$FILE_UPLOAD_SOURCE;type=text/plain" \
    "http://127.0.0.1:$PORT/api.php?action=upload")" == "201" ]]
FILE_ITEM_ID="$(sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' "$FILES_ADD_BODY" | head -n 1)"

if [[ -z "$FILE_ITEM_ID" ]]; then
    echo "Datei-Artikel-ID konnte nicht aus der Upload-Antwort gelesen werden." >&2
    exit 1
fi

ATTACHMENT_PATH="$(find "$TEST_DATA_DIR/uploads/files" -maxdepth 1 -type f | head -n 1)"

if [[ -z "$ATTACHMENT_PATH" || ! -f "$ATTACHMENT_PATH" ]]; then
    echo "Angelegte Attachment-Datei fehlt im Testdatenverzeichnis." >&2
    exit 1
fi

[[ "$(curl -sS -b "$COOKIE_JAR" -D "$MEDIA_HEADERS" -o "$MEDIA_BODY" -w '%{http_code}' "http://127.0.0.1:$PORT/media.php?item_id=$FILE_ITEM_ID")" == "200" ]]
grep -qi '^Content-Type:' "$MEDIA_HEADERS"
grep -qi '^Content-Disposition: attachment;' "$MEDIA_HEADERS"
grep -q 'Smoke attachment' "$MEDIA_BODY"

[[ "$(status_code "$FILES_LIST_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list&section=files")" == "200" ]]
grep -q "\"id\":$FILE_ITEM_ID" "$FILES_LIST_BODY"
grep -q '"has_attachment":1' "$FILES_LIST_BODY"
grep -q '"attachment_original_name":"Rechnung.txt"' "$FILES_LIST_BODY"
grep -Eq '"attachment_download_url":"/media\.php\?item_id='"$FILE_ITEM_ID"'&download=1(&v=[^"]+)?"' "$FILES_LIST_BODY"
grep -q '"attachment_preview_url":null' "$FILES_LIST_BODY"
grep -q '"name":"Rechnung.txt"' "$FILES_LIST_BODY"

[[ "$(status_code "$BIG_FILES_ADD_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    -F "section=files" \
    -F "name=Grosse Datei" \
    -F "file=@$BIG_FILE_UPLOAD_SOURCE;type=application/octet-stream" \
    "http://127.0.0.1:$PORT/api.php?action=upload")" == "201" ]]
BIG_FILE_ITEM_ID="$(sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' "$BIG_FILES_ADD_BODY" | head -n 1)"

if [[ -z "$BIG_FILE_ITEM_ID" ]]; then
    echo "Grosse Datei-Artikel-ID konnte nicht aus der Upload-Antwort gelesen werden." >&2
    exit 1
fi

[[ "$(status_code "$BIG_FILES_LIST_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list&section=files")" == "200" ]]
grep -q "\"id\":$BIG_FILE_ITEM_ID" "$BIG_FILES_LIST_BODY"
grep -q '"name":"Grosse Datei"' "$BIG_FILES_LIST_BODY"
grep -q '"attachment_original_name":"Grosse-Datei.bin"' "$BIG_FILES_LIST_BODY"
grep -q '"attachment_size_bytes":27262976' "$BIG_FILES_LIST_BODY"

[[ "$(status_code "$IMAGE_UPLOAD_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    -F "section=images" \
    -F "name=Produktbild" \
    -F "file=@$IMAGE_UPLOAD_SOURCE;type=image/png" \
    "http://127.0.0.1:$PORT/api.php?action=upload")" == "201" ]]
IMAGE_ITEM_ID="$(sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' "$IMAGE_UPLOAD_BODY" | head -n 1)"

if [[ -z "$IMAGE_ITEM_ID" ]]; then
    echo "Bild-Artikel-ID konnte nicht aus der Upload-Antwort gelesen werden." >&2
    exit 1
fi

[[ "$(status_code "$IMAGE_LIST_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list&section=images")" == "200" ]]
grep -q "\"id\":$IMAGE_ITEM_ID" "$IMAGE_LIST_BODY"
grep -q '"name":"Produktbild"' "$IMAGE_LIST_BODY"
grep -Eq '"attachment_preview_url":"/media\.php\?item_id='"$IMAGE_ITEM_ID"'&variant=thumb(&v=[^"]+)?"' "$IMAGE_LIST_BODY"
grep -Eq '"attachment_download_url":"/media\.php\?item_id='"$IMAGE_ITEM_ID"'&download=1(&v=[^"]+)?"' "$IMAGE_LIST_BODY"
grep -q '"attachment_original_name":"Bild.png"' "$IMAGE_LIST_BODY"
grep -q '"attachment_media_type":"image/png"' "$IMAGE_LIST_BODY"

[[ "$(curl -sS -b "$COOKIE_JAR" -D "$IMAGE_MEDIA_HEADERS" -o "$IMAGE_MEDIA_BODY" -w '%{http_code}' "http://127.0.0.1:$PORT/media.php?item_id=$IMAGE_ITEM_ID")" == "200" ]]
grep -qi '^Content-Type: image/png' "$IMAGE_MEDIA_HEADERS"
grep -qi '^Content-Disposition: inline;' "$IMAGE_MEDIA_HEADERS"

[[ "$(curl -sS -b "$COOKIE_JAR" -D "$IMAGE_DOWNLOAD_HEADERS" -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/media.php?item_id=$IMAGE_ITEM_ID&download=1")" == "200" ]]
grep -qi '^Content-Disposition: attachment;' "$IMAGE_DOWNLOAD_HEADERS"

[[ "$(status_code "$INVALID_IMAGE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    -F "section=images" \
    -F "file=@$INVALID_IMAGE_SOURCE;type=text/plain" \
    "http://127.0.0.1:$PORT/api.php?action=upload")" == "422" ]]
grep -Eq 'Bilder erlaubt|gültiges Bild' "$INVALID_IMAGE_BODY"

[[ "$(status_code "$MISSING_UPLOAD_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    -F "section=files" \
    "http://127.0.0.1:$PORT/api.php?action=upload")" == "422" ]]
grep -q 'Bitte wähle eine Datei aus' "$MISSING_UPLOAD_BODY"

IMAGE_ATTACHMENT_PATH="$(find "$TEST_DATA_DIR/uploads/images" -maxdepth 1 -type f | head -n 1)"

if [[ -z "$IMAGE_ATTACHMENT_PATH" || ! -f "$IMAGE_ATTACHMENT_PATH" ]]; then
    echo "Angelegte Bilddatei fehlt im Testdatenverzeichnis." >&2
    exit 1
fi

# Ein-Attachment-Regel: zweiten Upload auf dasselbe Item ersetzt das erste Attachment.
REPLACE_UPLOAD_BODY="$TMP_DIR/replace-upload.json"
[[ "$(status_code "$REPLACE_UPLOAD_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    -F "section=images" \
    -F "item_id=$IMAGE_ITEM_ID" \
    -F "name=Ersatzbild" \
    -F "file=@$IMAGE_UPLOAD_SOURCE;type=image/png" \
    "http://127.0.0.1:$PORT/api.php?action=upload")" == "200" ]]
grep -q 'Anhang ersetzt' "$REPLACE_UPLOAD_BODY"

ATTACH_COUNT="$(find "$TEST_DATA_DIR/uploads/images" -maxdepth 1 -type f | wc -l | tr -d ' ')"
if [[ "$ATTACH_COUNT" -lt "1" || "$ATTACH_COUNT" -gt "2" ]]; then
    echo "Ein-Attachment-Regel verletzt: $ATTACH_COUNT Dateien in uploads/images nach Ersetzen erwartet (Original, optional Thumbnail)." >&2
    exit 1
fi

REPLACE_LIST_BODY="$TMP_DIR/replace-list.json"
[[ "$(status_code "$REPLACE_LIST_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list&section=images")" == "200" ]]
grep -q '"name":"Ersatzbild"' "$REPLACE_LIST_BODY"

IMAGE_ATTACHMENT_PATH="$(find "$TEST_DATA_DIR/uploads/images" -maxdepth 1 -type f ! -name 'thumb-*' | head -n 1)"

if [[ -z "$IMAGE_ATTACHMENT_PATH" || ! -f "$IMAGE_ATTACHMENT_PATH" ]]; then
    echo "Angelegte Bilddatei fehlt im Testdatenverzeichnis nach Ersetzen." >&2
    exit 1
fi

rm -f "$IMAGE_ATTACHMENT_PATH"
[[ "$(status_code "$MISSING_MEDIA_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/media.php?item_id=$IMAGE_ITEM_ID")" == "404" ]]
grep -q 'Datei nicht gefunden' "$MISSING_MEDIA_BODY"

[[ "$(status_code "$FILES_DELETE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d "id=$FILE_ITEM_ID" "http://127.0.0.1:$PORT/api.php?action=delete")" == "200" ]]
grep -q 'Artikel gelöscht' "$FILES_DELETE_BODY"
if [[ -e "$ATTACHMENT_PATH" ]]; then
    echo "Attachment-Datei wurde beim Delete nicht entfernt." >&2
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

[[ "$(status_code "$REORDERED_LIST_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list")" == "200" ]]

SECOND_POS="$(grep -bo "\"id\":$SECOND_ITEM_ID" "$REORDERED_LIST_BODY" | head -n 1 | cut -d: -f1)"
FIRST_POS="$(grep -bo "\"id\":$ITEM_ID" "$REORDERED_LIST_BODY" | head -n 1 | cut -d: -f1)"

if [[ -z "$SECOND_POS" || -z "$FIRST_POS" || "$SECOND_POS" -ge "$FIRST_POS" ]]; then
    echo "Neu sortierte Reihenfolge wurde nicht korrekt gespeichert." >&2
    exit 1
fi

[[ "$(status_code "$UPDATE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d "id=$ITEM_ID&name=Hafermilch&quantity=3x" "http://127.0.0.1:$PORT/api.php?action=update")" == "200" ]]
grep -q 'Artikel aktualisiert' "$UPDATE_BODY"

[[ "$(status_code "$TODO_UPDATE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST --data-urlencode "id=$TODO_ITEM_ID" --data-urlencode 'name=Abgabe' --data-urlencode 'due_date=2026-05-01' --data-urlencode 'content=Unterlagen fertigstellen' --data-urlencode 'status=waiting' "http://127.0.0.1:$PORT/api.php?action=update")" == "200" ]]
grep -q 'Artikel aktualisiert' "$TODO_UPDATE_BODY"

[[ "$(status_code "$INVALID_UPDATE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d "id=$ITEM_ID&name=   &quantity=1" "http://127.0.0.1:$PORT/api.php?action=update")" == "422" ]]
grep -q 'Bitte gib einen Artikelnamen ein' "$INVALID_UPDATE_BODY"

[[ "$(status_code "$REORDERED_LIST_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list")" == "200" ]]
grep -q "\"name\":\"Hafermilch\"" "$REORDERED_LIST_BODY"
grep -q "\"quantity\":\"3x\"" "$REORDERED_LIST_BODY"
[[ "$(status_code "$TODO_LIST_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list&category_id=$TODO_CATEGORY_ID")" == "200" ]]
grep -q "\"id\":$TODO_ITEM_ID" "$TODO_LIST_BODY"
grep -q "\"status\":\"waiting\"" "$TODO_LIST_BODY"
grep -q "\"content\":\"Unterlagen fertigstellen\"" "$TODO_LIST_BODY"

[[ "$(status_code "$TOGGLE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d "id=$ITEM_ID&done=1" "http://127.0.0.1:$PORT/api.php?action=toggle")" == "200" ]]
grep -q 'Status aktualisiert' "$TOGGLE_BODY"

[[ "$(status_code "$POST_TOGGLE_LIST_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list")" == "200" ]]
SECOND_POS="$(grep -bo "\"id\":$SECOND_ITEM_ID" "$POST_TOGGLE_LIST_BODY" | head -n 1 | cut -d: -f1)"
FIRST_POS="$(grep -bo "\"id\":$ITEM_ID" "$POST_TOGGLE_LIST_BODY" | head -n 1 | cut -d: -f1)"

if [[ -z "$SECOND_POS" || -z "$FIRST_POS" || "$SECOND_POS" -ge "$FIRST_POS" ]]; then
    echo "Reihenfolge blieb nach dem Toggle nicht stabil." >&2
    exit 1
fi

[[ "$(status_code "$CLEAR_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST "http://127.0.0.1:$PORT/api.php?action=clear")" == "200" ]]
grep -q '"deleted":1' "$CLEAR_BODY"

[[ "$(status_code "$POST_CLEAR_LIST_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list")" == "200" ]]
grep -q "\"id\":$SECOND_ITEM_ID" "$POST_CLEAR_LIST_BODY"
if grep -q "\"id\":$ITEM_ID" "$POST_CLEAR_LIST_BODY"; then
    echo "Erledigter Artikel wurde durch clear nicht entfernt." >&2
    exit 1
fi

[[ "$(status_code "$MOVE_CATEGORY_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST --data-urlencode 'name=Zweite Einkaufsliste' --data-urlencode 'type=list_quantity' "http://127.0.0.1:$PORT/api.php?action=categories_create")" == "201" ]]
MOVE_TARGET_CATEGORY_ID="$(sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' "$MOVE_CATEGORY_BODY" | head -n 1)"

if [[ -z "$MOVE_TARGET_CATEGORY_ID" || "$MOVE_TARGET_CATEGORY_ID" -le 0 ]]; then
    echo "Zielkategorie konnte nicht aus der Create-Antwort gelesen werden." >&2
    exit 1
fi

[[ "$(status_code "$MOVE_ADD_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST --data-urlencode "category_id=$SHOPPING_CATEGORY_ID" --data-urlencode 'name=Verschieben-Test' --data-urlencode 'quantity=1' "http://127.0.0.1:$PORT/api.php?action=add")" == "201" ]]
MOVE_ITEM_ID="$(sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' "$MOVE_ADD_BODY" | head -n 1)"

if [[ -z "$MOVE_ITEM_ID" ]]; then
    echo "Move-Artikel-ID konnte nicht aus der Add-Antwort gelesen werden." >&2
    exit 1
fi

[[ "$(status_code "$MOVE_INVALID_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d "id=$MOVE_ITEM_ID&target_category_id=$TODO_CATEGORY_ID" "http://127.0.0.1:$PORT/api.php?action=move")" == "422" ]]
grep -q 'gleichartige Kategorien' "$MOVE_INVALID_BODY"

[[ "$(status_code "$MOVE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d "id=$MOVE_ITEM_ID&target_category_id=$MOVE_TARGET_CATEGORY_ID" "http://127.0.0.1:$PORT/api.php?action=move")" == "200" ]]
grep -q 'Artikel verschoben' "$MOVE_BODY"

[[ "$(status_code "$MOVE_SOURCE_LIST_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list&category_id=$SHOPPING_CATEGORY_ID")" == "200" ]]
php -r '$payload = json_decode(file_get_contents($argv[1]), true); $id = (int) $argv[2]; foreach (($payload["items"] ?? []) as $item) { if ((int) ($item["id"] ?? 0) === $id) { fwrite(STDERR, "Verschobener Artikel ist noch in der Quellkategorie sichtbar.\n"); exit(1); } }' "$MOVE_SOURCE_LIST_BODY" "$MOVE_ITEM_ID"

[[ "$(status_code "$MOVE_TARGET_LIST_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list&category_id=$MOVE_TARGET_CATEGORY_ID")" == "200" ]]
php -r '$payload = json_decode(file_get_contents($argv[1]), true); $id = (int) $argv[2]; foreach (($payload["items"] ?? []) as $item) { if ((int) ($item["id"] ?? 0) === $id) { exit(0); } } fwrite(STDERR, "Verschobener Artikel ist nicht in der Zielkategorie sichtbar.\n"); exit(1);' "$MOVE_TARGET_LIST_BODY" "$MOVE_ITEM_ID"
grep -q '"name":"Verschieben-Test"' "$MOVE_TARGET_LIST_BODY"

TODAY_DATE="$(php -r 'date_default_timezone_set("Europe/Berlin"); echo date("Y-m-d");')"
YESTERDAY_DATE="$(php -r 'date_default_timezone_set("Europe/Berlin"); echo date("Y-m-d", strtotime("-1 day"));')"
TOMORROW_DATE="$(php -r 'date_default_timezone_set("Europe/Berlin"); echo date("Y-m-d", strtotime("+1 day"));')"

[[ "$(status_code "$TODAY_ADD_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST --data-urlencode "category_id=$TODO_CATEGORY_ID" --data-urlencode 'name=Smoke gestern' --data-urlencode "due_date=$YESTERDAY_DATE" "http://127.0.0.1:$PORT/api.php?action=add")" == "201" ]]
[[ "$(status_code "$TODAY_TIMED_LATE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST --data-urlencode "active_category_id=$TODO_CATEGORY_ID" --data-urlencode 'input=Smoke terminiert spät heute 14:30' "http://127.0.0.1:$PORT/api.php?action=quick_add")" == "201" ]]
[[ "$(status_code "$TODAY_TIMED_EARLY_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST --data-urlencode "active_category_id=$TODO_CATEGORY_ID" --data-urlencode 'input=Smoke terminiert früh heute 08:15' "http://127.0.0.1:$PORT/api.php?action=quick_add")" == "201" ]]
[[ "$(status_code "$ADD_SECOND_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST --data-urlencode "category_id=$TODO_CATEGORY_ID" --data-urlencode 'name=Smoke heute' --data-urlencode "due_date=$TODAY_DATE" "http://127.0.0.1:$PORT/api.php?action=add")" == "201" ]]
[[ "$(status_code "$ADD_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST --data-urlencode "category_id=$TODO_CATEGORY_ID" --data-urlencode 'name=Smoke morgen' --data-urlencode "due_date=$TOMORROW_DATE" "http://127.0.0.1:$PORT/api.php?action=add")" == "201" ]]
[[ "$(status_code "$TODAY_DONE_ADD_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST --data-urlencode "category_id=$TODO_CATEGORY_ID" --data-urlencode 'name=Smoke erledigt' --data-urlencode "due_date=$TODAY_DATE" "http://127.0.0.1:$PORT/api.php?action=add")" == "201" ]]
TODAY_DONE_ID="$(sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' "$TODAY_DONE_ADD_BODY" | head -n 1)"
[[ "$(status_code "$TOGGLE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d "id=$TODAY_DONE_ID&done=1" "http://127.0.0.1:$PORT/api.php?action=toggle")" == "200" ]]

[[ "$(status_code "$TODAY_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=today")" == "200" ]]
[[ "$(status_code "$TODAY_EXPLICIT_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=today&date=$TODAY_DATE")" == "200" ]]
cmp "$TODAY_BODY" "$TODAY_EXPLICIT_BODY"
php -r '
    $payload = json_decode(file_get_contents($argv[1]), true);
    if (($payload["today"] ?? "") !== $argv[2] || !is_array($payload["items"] ?? null)) exit(1);
    $names = array_column($payload["items"], "name");
    $overdue = array_search("Smoke gestern", $names, true);
    $early = array_search("Smoke terminiert früh", $names, true);
    $late = array_search("Smoke terminiert spät", $names, true);
    $today = array_search("Smoke heute", $names, true);
    if ($overdue === false || $early === false || $late === false || $today === false) exit(1);
    if (!($overdue < $early && $early < $late && $late < $today)) exit(1);
    if (in_array("Smoke morgen", $names, true) || in_array("Smoke erledigt", $names, true)) exit(1);
    $byName = array_column($payload["items"], null, "name");
    if (($byName["Smoke gestern"]["agenda_group"] ?? "") !== "overdue") exit(1);
    if (($byName["Smoke terminiert früh"]["agenda_group"] ?? "") !== "scheduled" || ($byName["Smoke terminiert früh"]["due_time"] ?? "") !== "08:15") exit(1);
    if (($byName["Smoke terminiert spät"]["agenda_group"] ?? "") !== "scheduled" || ($byName["Smoke terminiert spät"]["due_time"] ?? "") !== "14:30") exit(1);
    if (($byName["Smoke heute"]["agenda_group"] ?? "") !== "anytime_today" || ($byName["Smoke heute"]["due_time"] ?? null) !== "") exit(1);
    foreach (["id", "category_id", "category_name", "category_type", "name", "due_date", "due_time", "agenda_group", "done", "sort_order"] as $key) {
        if (!array_key_exists($key, $payload["items"][0] ?? [])) exit(1);
    }
' "$TODAY_BODY" "$TODAY_DATE"

[[ "$(status_code "$AGENDA_DATE_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=today&date=$TOMORROW_DATE")" == "200" ]]
php -r '
    $payload = json_decode(file_get_contents($argv[1]), true);
    if (($payload["date"] ?? "") !== $argv[2]) exit(1);
    $names = array_column($payload["items"] ?? [], "name");
    if ($names !== ["Smoke morgen"]) exit(1);
' "$AGENDA_DATE_BODY" "$TOMORROW_DATE"
[[ "$(status_code "$AGENDA_INVALID_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=today&date=2026-02-31")" == "422" ]]

DB_PROBE_STATUS="$(status_code "$NOT_FOUND_BODY" "http://127.0.0.1:$PORT/data/einkaufsliste.db")"
[[ "$DB_PROBE_STATUS" == "404" || "$DB_PROBE_STATUS" == "200" ]]
if grep -q 'SQLite format 3' "$NOT_FOUND_BODY"; then
    echo "Datenbankdatei darf nicht direkt ausgeliefert werden." >&2
    exit 1
fi

GIT_PROBE_STATUS="$(status_code "$NOT_FOUND_BODY" "http://127.0.0.1:$PORT/.git/config")"
[[ "$GIT_PROBE_STATUS" == "404" || "$GIT_PROBE_STATUS" == "200" ]]
if grep -q '\[core\]' "$NOT_FOUND_BODY"; then
    echo ".git/config darf nicht direkt ausgeliefert werden." >&2
    exit 1
fi

mkdir -p "$SUBPATH_ROOT"
ln -s "$ROOT_DIR/public" "$SUBPATH_ROOT/sub"

EINKAUF_DATA_DIR="$TEST_DATA_DIR" EINKAUF_TRUST_PROXY_HEADERS=0 php -S "127.0.0.1:$SUBPATH_PORT" -t "$SUBPATH_ROOT" "$ROOT_DIR/public/router.php" >"$SERVER_LOG.subpath" 2>&1 &
SUBPATH_SERVER_PID=$!

SUBPATH_COOKIE_JAR="$TMP_DIR/subpath-cookies.txt"

for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:$SUBPATH_PORT/sub/login.php" >/dev/null 2>&1; then
        break
    fi
    sleep 0.25
done

SUBPATH_LOGIN_HTML="$TMP_DIR/subpath-login.html"
curl -fsS -c "$SUBPATH_COOKIE_JAR" "http://127.0.0.1:$SUBPATH_PORT/sub/login.php" >"$SUBPATH_LOGIN_HTML"
SUBPATH_LOGIN_CSRF="$(sed -n 's/.*name="csrf_token" value="\([^"]*\)".*/\1/p' "$SUBPATH_LOGIN_HTML" | head -n 1)"

curl -fsS \
    -b "$SUBPATH_COOKIE_JAR" -c "$SUBPATH_COOKIE_JAR" \
    -X POST \
    --data-urlencode "username=testuser" \
    --data-urlencode "password=userpass123" \
    --data-urlencode "csrf_token=$SUBPATH_LOGIN_CSRF" \
    "http://127.0.0.1:$SUBPATH_PORT/sub/login.php" >/dev/null

curl -fsS -b "$SUBPATH_COOKIE_JAR" "http://127.0.0.1:$SUBPATH_PORT/sub/index.php" >"$SUBPATH_HTML"
grep -q '<meta name="app-base-path" content="/sub/">' "$SUBPATH_HTML"
grep -Eq '<link rel="manifest" href="manifest\.php(\?v=[^"]+)?"' "$SUBPATH_HTML"
grep -Eq '<link rel="stylesheet" href="style\.css(\?v=[^"]+)?"' "$SUBPATH_HTML"
grep -Eq '<script type="module" src="js/main\.js(\?v=[^"]+)?"></script>' "$SUBPATH_HTML"

curl -fsS -b "$SUBPATH_COOKIE_JAR" "http://127.0.0.1:$SUBPATH_PORT/sub/manifest.php" >"$SUBPATH_MANIFEST"
grep -q '"id":"/sub/"' "$SUBPATH_MANIFEST"
grep -q '"start_url":"/sub/"' "$SUBPATH_MANIFEST"
grep -q '"scope":"/sub/"' "$SUBPATH_MANIFEST"
grep -q '"src":"/sub/icon.php?size=192"' "$SUBPATH_MANIFEST"
grep -q '"url":"/sub/?screen=journal&date=today"' "$SUBPATH_MANIFEST"
grep -q '"url":"/sub/?screen=journal&date=today&focus=editor"' "$SUBPATH_MANIFEST"
curl -fsS -b "$SUBPATH_COOKIE_JAR" -o /dev/null "http://127.0.0.1:$SUBPATH_PORT/sub/icon.php?size=144"
curl -fsS -b "$SUBPATH_COOKIE_JAR" -o /dev/null "http://127.0.0.1:$SUBPATH_PORT/sub/category-icon.php?icon=einkauf"
php scripts/test-ai-client.php

# -----------------------------------------------------------------------------
# Sketch-API (Issue #41): Scene-Roundtrip, Validierung, Ownership
# -----------------------------------------------------------------------------

DRAWINGS_CATEGORY_BODY="$(curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode 'name=Skizzen' --data-urlencode 'type=drawings' \
    "http://127.0.0.1:$PORT/api.php?action=categories_create")"
DRAWINGS_CATEGORY_ID="$(echo "$DRAWINGS_CATEGORY_BODY" | sed -n 's/.*"id":\([0-9]\+\).*/\1/p' | head -n 1)"
[[ -n "$DRAWINGS_CATEGORY_ID" ]] || { echo "Zeichnungen-Kategorie konnte nicht angelegt werden."; exit 1; }

DRAWING_ADD_BODY="$(curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "category_id=$DRAWINGS_CATEGORY_ID" --data-urlencode 'name=Haus' \
    "http://127.0.0.1:$PORT/api.php?action=add")"
DRAWING_ITEM_ID="$(echo "$DRAWING_ADD_BODY" | sed -n 's/.*"id":\([0-9]\+\).*/\1/p' | head -n 1)"
[[ -n "$DRAWING_ITEM_ID" ]] || { echo "Zeichnung konnte nicht angelegt werden."; exit 1; }

# Roundtrip: gültige Vektor-Szene speichern und laden
VALID_SCENE='{"elements":[{"type":"rectangle","x":1,"y":2,"width":3,"height":4}],"appState":{}}'
SKETCH_SAVE_BODY="$(curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "item_id=$DRAWING_ITEM_ID" \
    --data-urlencode "scene=$VALID_SCENE" \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save")"
echo "$SKETCH_SAVE_BODY" | grep -q '"has_sketch":1' || { echo "sketch_save lieferte kein has_sketch=1: $SKETCH_SAVE_BODY"; exit 1; }

SKETCH_LOAD_BODY="$(curl -fsS -b "$COOKIE_JAR" \
    "http://127.0.0.1:$PORT/api.php?action=sketch_load&item_id=$DRAWING_ITEM_ID")"
echo "$SKETCH_LOAD_BODY" | grep -q '"type":"rectangle"' || { echo "sketch_load lieferte keine Szene: $SKETCH_LOAD_BODY"; exit 1; }
echo "$SKETCH_LOAD_BODY" | grep -q '"has_sketch":1' || { echo "sketch_load lieferte kein has_sketch=1: $SKETCH_LOAD_BODY"; exit 1; }

# Leere Szene: has_sketch muss 0 sein und Liste darf Scene-JSON nicht enthalten
EMPTY_SCENE='{"elements":[]}'
SKETCH_EMPTY_BODY="$(curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "item_id=$DRAWING_ITEM_ID" \
    --data-urlencode "scene=$EMPTY_SCENE" \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save")"
echo "$SKETCH_EMPTY_BODY" | grep -q '"has_sketch":0' || { echo "Leere Szene lieferte has_sketch != 0: $SKETCH_EMPTY_BODY"; exit 1; }

DRAWINGS_LIST_BODY="$(curl -fsS -b "$COOKIE_JAR" \
    "http://127.0.0.1:$PORT/api.php?action=list&category_id=$DRAWINGS_CATEGORY_ID")"
echo "$DRAWINGS_LIST_BODY" | grep -q '"has_sketch":0' || { echo "Liste enthält has_sketch=1 nach leerer Szene."; exit 1; }
echo "$DRAWINGS_LIST_BODY" | grep -q "\"id\":$DRAWING_ITEM_ID" || { echo "Item wurde durch leere Szene gelöscht: $DRAWINGS_LIST_BODY"; exit 1; }
echo "$DRAWINGS_LIST_BODY" | grep -q '"elements"' && { echo "Liste enthält Scene-JSON: $DRAWINGS_LIST_BODY"; exit 1; } || true

# Sketch-Editor-Lifecycle (Issue #42):
# Nachfolge-Save auf dasselbe Item muss funktionieren (kein hängender State).
POST_EMPTY_RECOVER="$(curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "item_id=$DRAWING_ITEM_ID" \
    --data-urlencode "scene=$VALID_SCENE" \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save")"
echo "$POST_EMPTY_RECOVER" | grep -q '"has_sketch":1' || { echo "Save nach leerer Szene lieferte has_sketch != 1: $POST_EMPTY_RECOVER"; exit 1; }

# Race-Condition-Schutz: zwei sequenzielle Saves auf dasselbe Item müssen
# beide durchgehen (kein hängender Editor-State nach Server-Fehler).
RACE_SCENE_A='{"elements":[{"type":"rectangle","id":"a"}]}'
RACE_SCENE_B='{"elements":[{"type":"ellipse","id":"b"}]}'
RACE_FIRST="$(curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "item_id=$DRAWING_ITEM_ID" \
    --data-urlencode "scene=$RACE_SCENE_A" \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save")"
echo "$RACE_FIRST" | grep -q '"has_sketch":1' || { echo "Race-Test: erster Save fehlgeschlagen: $RACE_FIRST"; exit 1; }
RACE_SECOND="$(curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "item_id=$DRAWING_ITEM_ID" \
    --data-urlencode "scene=$RACE_SCENE_B" \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save")"
echo "$RACE_SECOND" | grep -q '"has_sketch":1' || { echo "Race-Test: zweiter Save fehlgeschlagen: $RACE_SECOND"; exit 1; }
RACE_LOAD="$(curl -fsS -b "$COOKIE_JAR" \
    "http://127.0.0.1:$PORT/api.php?action=sketch_load&item_id=$DRAWING_ITEM_ID")"
echo "$RACE_LOAD" | grep -q '"has_sketch":1' || { echo "Race-Test: Item verlor has_sketch: $RACE_LOAD"; exit 1; }
echo "$RACE_LOAD" | grep -q '"type":"ellipse"' || { echo "Race-Test: letzter Save wurde nicht persistiert: $RACE_LOAD"; exit 1; }

# Ungültiges JSON: 422
SKETCH_BAD_JSON_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "item_id=$DRAWING_ITEM_ID" \
    --data-urlencode 'scene={kein json' \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save")"
[[ "$SKETCH_BAD_JSON_STATUS" == "422" ]] || { echo "Ungültiges JSON lieferte Status $SKETCH_BAD_JSON_STATUS statt 422."; exit 1; }

# Fehlende elements: 422
SKETCH_BAD_STRUCT_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "item_id=$DRAWING_ITEM_ID" \
    --data-urlencode 'scene={"appState":{}}' \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save")"
[[ "$SKETCH_BAD_STRUCT_STATUS" == "422" ]] || { echo "Fehlende elements lieferte Status $SKETCH_BAD_STRUCT_STATUS statt 422."; exit 1; }

# Eingebettete Dateien sind verboten
SCENE_WITH_FILES='{"elements":[{"type":"rectangle"}],"files":{"id":"abc"}}'
SKETCH_FILES_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "item_id=$DRAWING_ITEM_ID" \
    --data-urlencode "scene=$SCENE_WITH_FILES" \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save")"
[[ "$SKETCH_FILES_STATUS" == "422" ]] || { echo "Szene mit files lieferte Status $SKETCH_FILES_STATUS statt 422."; exit 1; }

# 2-MB-Limit
LARGE_SCENE_FILE="$(mktemp)"
head -c $((3 * 1024 * 1024)) /dev/zero 2>/dev/null | tr '\0' 'A' >"$LARGE_SCENE_FILE" \
    || dd if=/dev/zero bs=1024 count=$((3 * 1024)) 2>/dev/null | tr '\0' 'A' >"$LARGE_SCENE_FILE"
SKETCH_LARGE_BODY="$(mktemp)"
printf 'item_id=%s&scene=' "$DRAWING_ITEM_ID" >"$SKETCH_LARGE_BODY"
cat "$LARGE_SCENE_FILE" >>"$SKETCH_LARGE_BODY"
SKETCH_LARGE_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-binary "@$SKETCH_LARGE_BODY" \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save")"
rm -f "$LARGE_SCENE_FILE" "$SKETCH_LARGE_BODY"
[[ "$SKETCH_LARGE_STATUS" == "413" || "$SKETCH_LARGE_STATUS" == "422" ]] || { echo "3-MB-Szene lieferte Status $SKETCH_LARGE_STATUS statt 413/422."; exit 1; }

# Fremdes Item: anderer User kann Scene weder laden noch speichern
OTHER_LOGIN_HTML="$(curl -fsS -c "$TMP_DIR/other-cookies.txt" "http://127.0.0.1:$PORT/login.php")"
OTHER_CSRF_TOKEN="$(sed -n 's/.*name="csrf_token" value="\([^"]*\)".*/\1/p' <<<"$OTHER_LOGIN_HTML" | head -n 1)"
curl -fsS -b "$TMP_DIR/other-cookies.txt" -c "$TMP_DIR/other-cookies.txt" \
    -X POST \
    --data-urlencode "username=testadmin" \
    --data-urlencode "password=adminpass123" \
    --data-urlencode "csrf_token=$OTHER_CSRF_TOKEN" \
    "http://127.0.0.1:$PORT/login.php" >/dev/null

OTHER_INDEX_HTML="$(curl -fsS -b "$TMP_DIR/other-cookies.txt" "http://127.0.0.1:$PORT/index.php")"
OTHER_INDEX_CSRF="$(sed -n 's/.*name="csrf-token" content="\([^"]*\)".*/\1/p' <<<"$OTHER_INDEX_HTML" | head -n 1)"
if [[ -z "$OTHER_INDEX_CSRF" ]]; then
    OTHER_INDEX_CSRF="$(sed -n 's/.*id="csrf-token"[^>]*content="\([^"]*\)".*/\1/p' <<<"$OTHER_INDEX_HTML" | head -n 1)"
fi
if [[ -z "$OTHER_INDEX_CSRF" ]]; then
    OTHER_INDEX_HTML="$(curl -fsS -b "$TMP_DIR/other-cookies.txt" "http://127.0.0.1:$PORT/api.php?action=categories_list")"
    OTHER_INDEX_CSRF="$(echo "$OTHER_INDEX_HTML" | sed -n 's/.*"csrf_token":"\([^"]*\)".*/\1/p' | head -n 1)"
fi

SKETCH_FOREIGN_SAVE_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -b "$TMP_DIR/other-cookies.txt" -H "X-CSRF-Token: $OTHER_INDEX_CSRF" \
    --data-urlencode "item_id=$DRAWING_ITEM_ID" \
    --data-urlencode "scene=$VALID_SCENE" \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save")"
[[ "$SKETCH_FOREIGN_SAVE_STATUS" == "404" ]] || { echo "Fremder sketch_save lieferte Status $SKETCH_FOREIGN_SAVE_STATUS statt 404."; exit 1; }

SKETCH_FOREIGN_LOAD_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -b "$TMP_DIR/other-cookies.txt" \
    "http://127.0.0.1:$PORT/api.php?action=sketch_load&item_id=$DRAWING_ITEM_ID")"
[[ "$SKETCH_FOREIGN_LOAD_STATUS" == "404" ]] || { echo "Fremder sketch_load lieferte Status $SKETCH_FOREIGN_LOAD_STATUS statt 404."; exit 1; }

# Sketch auf Item der falschen Kategorie ablehnen
SHOPPING_ITEM_BODY="$(curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    -d "name=Milch&quantity=1&category_id=$SHOPPING_CATEGORY_ID" \
    "http://127.0.0.1:$PORT/api.php?action=add")"
SHOPPING_ITEM_ID="$(echo "$SHOPPING_ITEM_BODY" | sed -n 's/.*"id":\([0-9]\+\).*/\1/p' | head -n 1)"
[[ -n "$SHOPPING_ITEM_ID" ]] || { echo "Shopping-Item konnte nicht angelegt werden."; exit 1; }
SKETCH_WRONG_CAT_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "item_id=$SHOPPING_ITEM_ID" \
    --data-urlencode "scene=$VALID_SCENE" \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save")"
[[ "$SKETCH_WRONG_CAT_STATUS" == "422" ]] || { echo "sketch_save auf list_quantity lieferte $SKETCH_WRONG_CAT_STATUS statt 422."; exit 1; }

# -----------------------------------------------------------------------------
# Tages-Skizze (Issue #43): sketch_save_daily erzeugt die Tagesnotiz atomar
# -----------------------------------------------------------------------------
SKETCH_DAILY_DATE="$(date -d 'today +2 days' +%Y-%m-%d 2>/dev/null || date -v+2d +%Y-%m-%d)"
[[ "$SKETCH_DAILY_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "Konnte Testdatum nicht ableiten."; exit 1; }

# Erster Save ohne Text erzeugt die Tagesnotiz (201).
DAILY_FIRST_BODY="$(curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "date=$SKETCH_DAILY_DATE" \
    --data-urlencode "scene=$VALID_SCENE" \
    -w '%{http_code}' \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save_daily")"
DAILY_FIRST_STATUS="${DAILY_FIRST_BODY: -3}"
DAILY_FIRST_JSON="${DAILY_FIRST_BODY%$'\n'*}"
[[ "$DAILY_FIRST_STATUS" == "201" ]] || { echo "Erster sketch_save_daily lieferte $DAILY_FIRST_STATUS statt 201: $DAILY_FIRST_JSON"; exit 1; }
DAILY_ITEM_ID="$(echo "$DAILY_FIRST_JSON" | sed -n 's/.*"item_id":\([0-9]\+\).*/\1/p' | head -n 1)"
[[ -n "$DAILY_ITEM_ID" ]] || { echo "sketch_save_daily lieferte keine item_id: $DAILY_FIRST_JSON"; exit 1; }
echo "$DAILY_FIRST_JSON" | grep -q '"has_sketch":1' || { echo "Erster sketch_save_daily lieferte has_sketch != 1: $DAILY_FIRST_JSON"; exit 1; }

# Folgender Save auf gleichem Datum updated dieselbe Zeile (200, gleiche item_id).
DAILY_SECOND_BODY="$(curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "date=$SKETCH_DAILY_DATE" \
    --data-urlencode "scene={\"elements\":[{\"type\":\"ellipse\",\"id\":\"x\"}]}" \
    -w '%{http_code}' \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save_daily")"
DAILY_SECOND_STATUS="${DAILY_SECOND_BODY: -3}"
DAILY_SECOND_JSON="${DAILY_SECOND_BODY%$'\n'*}"
[[ "$DAILY_SECOND_STATUS" == "200" ]] || { echo "Zweiter sketch_save_daily lieferte $DAILY_SECOND_STATUS statt 200: $DAILY_SECOND_JSON"; exit 1; }
DAILY_ITEM_ID_2="$(echo "$DAILY_SECOND_JSON" | sed -n 's/.*"item_id":\([0-9]\+\).*/\1/p' | head -n 1)"
[[ "$DAILY_ITEM_ID_2" == "$DAILY_ITEM_ID" ]] || { echo "Zweiter Save erzeugte neue item_id ($DAILY_ITEM_ID_2 statt $DAILY_ITEM_ID)."; exit 1; }

# Leere Szene: has_sketch=0, daily item bleibt.
DAILY_EMPTY_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "date=$SKETCH_DAILY_DATE" \
    --data-urlencode 'scene={"elements":[]}' \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save_daily")"
[[ "$DAILY_EMPTY_STATUS" == "200" ]] || { echo "Leere sketch_save_daily lieferte $DAILY_EMPTY_STATUS statt 200."; exit 1; }

# Tagesnotiz-Eintrag muss noch da sein (journal_load).
DAILY_JOURNAL_BODY="$(curl -fsS -b "$COOKIE_JAR" \
    "http://127.0.0.1:$PORT/api.php?action=journal&date=$SKETCH_DAILY_DATE")"
echo "$DAILY_JOURNAL_BODY" | grep -q "\"id\":$DAILY_ITEM_ID" || { echo "Tagesnotiz nach leerer Skizze verschwunden: $DAILY_JOURNAL_BODY"; exit 1; }
echo "$DAILY_JOURNAL_BODY" | grep -q '"has_sketch":0' || { echo "Journal antwortet nach leerer Szene mit has_sketch != 0: $DAILY_JOURNAL_BODY"; exit 1; }

# Skizze + Text gemeinsam: getrennte Daten, atomar.
DAILY_TEXT_DATE="$(date -d 'today +3 days' +%Y-%m-%d 2>/dev/null || date -v+3d +%Y-%m-%d)"
curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "date=$DAILY_TEXT_DATE" \
    --data-urlencode 'content=<p>Hallo Tag</p>' \
    "http://127.0.0.1:$PORT/api.php?action=journal_save" >/dev/null
DAILY_TEXT_SKETCH="$(curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "date=$DAILY_TEXT_DATE" \
    --data-urlencode "scene=$VALID_SCENE" \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save_daily")"
DAILY_TEXT_ITEM_ID="$(echo "$DAILY_TEXT_SKETCH" | sed -n 's/.*"item_id":\([0-9]\+\).*/\1/p' | head -n 1)"
DAILY_TEXT_JOURNAL="$(curl -fsS -b "$COOKIE_JAR" \
    "http://127.0.0.1:$PORT/api.php?action=journal&date=$DAILY_TEXT_DATE")"
echo "$DAILY_TEXT_JOURNAL" | grep -q "\"id\":$DAILY_TEXT_ITEM_ID" || { echo "Text+Skizze: Item nicht gefunden: $DAILY_TEXT_JOURNAL"; exit 1; }
echo "$DAILY_TEXT_JOURNAL" | grep -q '<p>Hallo Tag</p>' || { echo "Text ging verloren beim sketch_save_daily: $DAILY_TEXT_JOURNAL"; exit 1; }
echo "$DAILY_TEXT_JOURNAL" | grep -q '"has_sketch":1' || { echo "kombinierter Save lieferte has_sketch != 1: $DAILY_TEXT_JOURNAL"; exit 1; }

# Anderes Datum = eigene Skizze (Gestern, Morgen, freie Daten).
DAILY_OTHER_DATE="$(date -d 'today +4 days' +%Y-%m-%d 2>/dev/null || date -v+4d +%Y-%m-%d)"
curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "date=$DAILY_OTHER_DATE" \
    --data-urlencode "scene=$VALID_SCENE" \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save_daily" >/dev/null
DAILY_OTHER_JOURNAL="$(curl -fsS -b "$COOKIE_JAR" \
    "http://127.0.0.1:$PORT/api.php?action=journal&date=$DAILY_OTHER_DATE")"
echo "$DAILY_OTHER_JOURNAL" | grep -q '"has_sketch":1' || { echo "Anderes Datum hat keine Skizze: $DAILY_OTHER_JOURNAL"; exit 1; }
DAILY_NEXTDAY="$(date -d "$DAILY_OTHER_DATE +1 day" +%Y-%m-%d 2>/dev/null || date -v+1d -j -f %Y-%m-%d "$DAILY_OTHER_DATE" +%Y-%m-%d)"
DAILY_NEXT_JOURNAL="$(curl -fsS -b "$COOKIE_JAR" \
    "http://127.0.0.1:$PORT/api.php?action=journal&date=$DAILY_NEXTDAY")"
echo "$DAILY_NEXT_JOURNAL" | grep -q '"item":null\|"id":null' || { echo "Folgedatum sollte ohne Tagesnotiz sein, hat aber eine: $DAILY_NEXT_JOURNAL"; exit 1; }

# Sketch-only-Loeschen leer: Tagesnotiz bleibt mit has_sketch:0.
DAILY_KEEP_DATE="$(date -d 'today +5 days' +%Y-%m-%d 2>/dev/null || date -v+5d +%Y-%m-%d)"
DAILY_KEEP_SKETCH="$(curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "date=$DAILY_KEEP_DATE" \
    --data-urlencode 'content=<p>Bleibt</p>' \
    "http://127.0.0.1:$PORT/api.php?action=journal_save")"
DAILY_KEEP_ITEM_ID="$(echo "$DAILY_KEEP_SKETCH" | sed -n 's/.*"item":{\"id":\([0-9]\+\).*/\1/p' | head -n 1)"
curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "date=$DAILY_KEEP_DATE" \
    --data-urlencode "scene=$VALID_SCENE" \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save_daily" >/dev/null
curl -fsS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "date=$DAILY_KEEP_DATE" \
    --data-urlencode 'scene={"elements":[]}' \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save_daily" >/dev/null
DAILY_KEEP_AFTER="$(curl -fsS -b "$COOKIE_JAR" \
    "http://127.0.0.1:$PORT/api.php?action=journal&date=$DAILY_KEEP_DATE")"
echo "$DAILY_KEEP_AFTER" | grep -q "\"id\":$DAILY_KEEP_ITEM_ID" || { echo "Tagesnotiz ging beim Leeren der Skizze verloren: $DAILY_KEEP_AFTER"; exit 1; }
echo "$DAILY_KEEP_AFTER" | grep -q '<p>Bleibt</p>' || { echo "Text ging beim Leeren der Skizze verloren: $DAILY_KEEP_AFTER"; exit 1; }
echo "$DAILY_KEEP_AFTER" | grep -q '"has_sketch":0' || { echo "has_sketch sollte 0 sein nach Leeren: $DAILY_KEEP_AFTER"; exit 1; }

# 422 für ungültiges JSON.
DAILY_BAD_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode "date=$SKETCH_DAILY_DATE" \
    --data-urlencode 'scene={kein json' \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save_daily")"
[[ "$DAILY_BAD_STATUS" == "422" ]] || { echo "Ungültiges JSON lieferte $DAILY_BAD_STATUS statt 422."; exit 1; }

# 422 für ungültiges Datum.
DAILY_BAD_DATE_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST \
    --data-urlencode 'date=2026-13-99' \
    --data-urlencode "scene=$VALID_SCENE" \
    "http://127.0.0.1:$PORT/api.php?action=sketch_save_daily")"
[[ "$DAILY_BAD_DATE_STATUS" == "422" ]] || { echo "Ungültiges Datum lieferte $DAILY_BAD_DATE_STATUS statt 422."; exit 1; }

# Fremdes Datum ohne Berechtigung: API wirft CSRF-Token-Fehler statt zu speichern — gegen User X schreiben
# wir gar nicht erst; bestehender 422/404-Pfad reicht. (Cross-User ist über item_id gesichert.)

echo "Smoke-Test erfolgreich."
