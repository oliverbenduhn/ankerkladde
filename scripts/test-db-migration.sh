#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
    rm -rf "$TMP_DIR"
}

trap cleanup EXIT

run_php() {
    local data_dir=$1
    local script=$2

    EINKAUF_DATA_DIR="$data_dir" php -r "$script"
}

LEGACY_DIR="$TMP_DIR/legacy"
mkdir -p "$LEGACY_DIR"

run_php "$LEGACY_DIR" '
    $db = new PDO("sqlite:" . getenv("EINKAUF_DATA_DIR") . "/einkaufsliste.db");
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->exec("CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )");
    $db->exec("INSERT INTO items (name, done, created_at, updated_at) VALUES
        (\"Milch\", 0, \"2026-03-20 08:00:00\", \"2026-03-20 10:00:00\"),
        (\"Brot\", 1, \"2026-03-20 09:00:00\", \"2026-03-21 09:00:00\"),
        (\"Apfel\", 0, \"2026-03-21 07:00:00\", \"2026-03-21 12:00:00\")");
'

run_php "$LEGACY_DIR" '
    require "'"$ROOT_DIR"'/security.php"; require "'"$ROOT_DIR"'/db.php";
    $db = getDatabase();
    $columns = array_column($db->query("PRAGMA table_info(items)")->fetchAll(PDO::FETCH_ASSOC), "name");
    if (!in_array("quantity", $columns, true) || !in_array("sort_order", $columns, true)) {
        fwrite(STDERR, "Legacy-Migration hat Spalten nicht ergänzt.\n");
        exit(1);
    }

    $attachmentColumns = array_column($db->query("PRAGMA table_info(attachments)")->fetchAll(PDO::FETCH_ASSOC), "name");
    foreach (["item_id", "storage_section", "stored_name", "original_name", "media_type", "size_bytes"] as $column) {
        if (!in_array($column, $attachmentColumns, true)) {
            fwrite(STDERR, "Attachment-Migration hat Spalten nicht ergänzt.\n");
            exit(1);
        }
    }

    foreach (["uploads", "uploads/images", "uploads/files"] as $path) {
        $fullPath = getenv("EINKAUF_DATA_DIR") . "/" . $path;
        if (!is_dir($fullPath)) {
            fwrite(STDERR, "Upload-Verzeichnis fehlt: " . $path . "\n");
            exit(1);
        }
    }

    $rows = $db->query("SELECT id, sort_order FROM items ORDER BY sort_order ASC")->fetchAll(PDO::FETCH_ASSOC);
    $expected = [3, 1, 2];

    foreach ($rows as $index => $row) {
        if ((int) $row["id"] !== $expected[$index] || (int) $row["sort_order"] !== $index + 1) {
            fwrite(STDERR, "Legacy-Migration hat Reihenfolge nicht korrekt aufgebaut.\n");
            exit(1);
        }
    }
'

BROKEN_DIR="$TMP_DIR/broken"
mkdir -p "$BROKEN_DIR"

run_php "$BROKEN_DIR" '
    $db = new PDO("sqlite:" . getenv("EINKAUF_DATA_DIR") . "/einkaufsliste.db");
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->exec("CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        quantity TEXT NOT NULL DEFAULT \"\",
        sort_order INTEGER NOT NULL DEFAULT 0
    )");
    $db->exec("INSERT INTO items (name, quantity, done, created_at, updated_at, sort_order) VALUES
        (\"Milch\", \"2x\", 0, \"2026-03-20 08:00:00\", \"2026-03-20 10:00:00\", 0),
        (\"Brot\", \"1\", 1, \"2026-03-20 09:00:00\", \"2026-03-21 09:00:00\", 0),
        (\"Apfel\", \"6\", 0, \"2026-03-21 07:00:00\", \"2026-03-21 12:00:00\", 5)");
'

run_php "$BROKEN_DIR" '
    require "'"$ROOT_DIR"'/security.php"; require "'"$ROOT_DIR"'/db.php";
    $db = getDatabase();
    $rows = $db->query("SELECT id, sort_order FROM items ORDER BY sort_order ASC")->fetchAll(PDO::FETCH_ASSOC);
    $expected = [3, 1, 2];

    foreach ($rows as $index => $row) {
        if ((int) $row["id"] !== $expected[$index] || (int) $row["sort_order"] !== $index + 1) {
            fwrite(STDERR, "Defekte sort_order-Werte wurden nicht repariert.\n");
            exit(1);
        }
    }
'

LIMIT_DIR="$TMP_DIR/upload-limit"
mkdir -p "$LIMIT_DIR"

run_php "$LIMIT_DIR" '
    require "'"$ROOT_DIR"'/security.php"; require "'"$ROOT_DIR"'/db.php";
    $db = getDatabase();
    updateUploadLimitSettings($db, [
        "image_upload_max_mb" => 20,
        "file_upload_max_mb" => 500,
        "remote_file_import_max_mb" => 500,
    ]);
    $db->exec("DELETE FROM database_meta WHERE meta_key = \"remote_import_upload_limit_10240_v1\"");
    $db = null;
'

run_php "$LIMIT_DIR" '
    require "'"$ROOT_DIR"'/security.php"; require "'"$ROOT_DIR"'/db.php";
    $db = getDatabase();
    $settings = getUploadLimitSettings($db);
    if ((int) ($settings["remote_file_import_max_mb"] ?? 0) !== 10240) {
        fwrite(STDERR, "Remote-Import-Limit wurde nicht auf 10240 MB migriert.\n");
        exit(1);
    }
'

echo "DB-Migrationstest erfolgreich."
