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

EINKAUF_DATA_DIR="$TEST_DATA_DIR" EINKAUF_TRUST_PROXY_HEADERS=0 php -S "127.0.0.1:$PORT" -t "$ROOT_DIR/public" "$ROOT_DIR/public/router.php" >"$SERVER_LOG" 2>&1 &
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
curl -fsS -b "$COOKIE_JAR" -D "$MANIFEST_HEADERS" -o /dev/null "http://127.0.0.1:$PORT/manifest.php"
grep -qi '^Content-Type: application/manifest+json' "$MANIFEST_HEADERS"

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
FILES_ADD_BODY="$TMP_DIR/files-add.json"
FILES_LIST_BODY="$TMP_DIR/files-list.json"
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
IMAGE_UPLOAD_SOURCE="$TMP_DIR/Bild.png"
INVALID_IMAGE_SOURCE="$TMP_DIR/kein-bild.txt"

printf 'Smoke attachment\n' >"$FILE_UPLOAD_SOURCE"
printf 'not really an image\n' >"$INVALID_IMAGE_SOURCE"
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR9QAAAAASUVORK5CYII=' \
    | base64 -d >"$IMAGE_UPLOAD_SOURCE"

[[ "$(status_code "$LIST_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list")" == "200" ]]
grep -q '"items"' "$LIST_BODY"

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

[[ "$(status_code "$INVALID_UPDATE_BODY" -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" -X POST -d "id=$ITEM_ID&name=   &quantity=1" "http://127.0.0.1:$PORT/api.php?action=update")" == "422" ]]
grep -q 'Bitte gib einen Artikelnamen ein' "$INVALID_UPDATE_BODY"

[[ "$(status_code "$REORDERED_LIST_BODY" -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api.php?action=list")" == "200" ]]
grep -q "\"name\":\"Hafermilch\"" "$REORDERED_LIST_BODY"
grep -q "\"quantity\":\"3x\"" "$REORDERED_LIST_BODY"

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
grep -Eq '"src":"/sub/icon\.php\?size=192&theme=hafenblau(&v=[^"]+)?"' "$SUBPATH_MANIFEST"

echo "Smoke-Test erfolgreich."
