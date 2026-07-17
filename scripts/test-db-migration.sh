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
    foreach (["due_time", "priority"] as $column) {
        if (!in_array($column, $columns, true)) {
            fwrite(STDERR, "Parchment-Migration hat Spalte nicht ergänzt: " . $column . "\n");
            exit(1);
        }
        $info = $db->query("PRAGMA table_info(items)")->fetchAll(PDO::FETCH_ASSOC);
        $definition = array_values(array_filter($info, static fn(array $entry): bool => $entry["name"] === $column))[0] ?? null;
        if ($definition === null || (int) $definition["notnull"] !== 1 || $definition["dflt_value"] !== str_repeat(chr(39), 2)) {
            fwrite(STDERR, "Parchment-Spalte hat nicht den erwarteten Default: " . $column . "\n");
            exit(1);
        }
    }

    $version = $db->query("SELECT meta_value FROM database_meta WHERE meta_key = \"schema_version\"")->fetchColumn();
    if ((int) $version !== 1) {
        fwrite(STDERR, "Schema-Version wurde nicht genau auf 1 erhöht.\n");
        exit(1);
    }

    $stmt = $db->prepare("INSERT INTO users (username, password_hash) VALUES (:username, :password_hash)");
    $stmt->execute([":username" => "parchment-migration", ":password_hash" => password_hash("test-password", PASSWORD_DEFAULT)]);
    $userId = (int) $db->lastInsertId();
    $stmt = $db->prepare("INSERT INTO categories (user_id, name, type) VALUES (:user_id, :name, :type)");
    $stmt->execute([":user_id" => $userId, ":name" => "Journal", ":type" => "daily_notes"]);

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

run_php "$LEGACY_DIR" '
    require "'"$ROOT_DIR"'/security.php"; require "'"$ROOT_DIR"'/db.php";
    $db = getDatabase();
    $version = $db->query("SELECT meta_value FROM database_meta WHERE meta_key = \"schema_version\"")->fetchColumn();
    if ((int) $version !== 1) {
        fwrite(STDERR, "Parchment-Migration ist nicht idempotent.\n");
        exit(1);
    }
    $journalCount = $db->query("SELECT COUNT(*) FROM categories WHERE type = \"daily_notes\"")->fetchColumn();
    if ((int) $journalCount !== 1) {
        fwrite(STDERR, "Parchment-Migration hat bestehende Kategorien verändert.\n");
        exit(1);
    }
'

PARCHMENT_LEGACY_DIR="$TMP_DIR/parchment-legacy"
mkdir -p "$PARCHMENT_LEGACY_DIR"

run_php "$PARCHMENT_LEGACY_DIR" '
    $db = new PDO("sqlite:" . getenv("EINKAUF_DATA_DIR") . "/einkaufsliste.db");
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->exec("PRAGMA foreign_keys = ON");
    $db->exec("CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        preferences_json TEXT NOT NULL DEFAULT \"{}\",
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )");
    $db->exec("CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN (\"list_quantity\", \"list_due_date\", \"notes\", \"images\", \"files\", \"links\")),
        icon TEXT NOT NULL DEFAULT \"\",
        legacy_key TEXT NOT NULL DEFAULT \"\",
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_hidden INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )");
    $db->exec("CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        section TEXT NOT NULL DEFAULT \"shopping\",
        category_id INTEGER REFERENCES categories(id),
        user_id INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )");
    $user = $db->prepare("INSERT INTO users (username, password_hash) VALUES (:username, :password_hash)");
    $user->execute([":username" => "existing-user", ":password_hash" => "hash"]);
    $category = $db->prepare("INSERT INTO categories (user_id, name, type) VALUES (1, :name, :type)");
    $category->execute([":name" => "Bestehend", ":type" => "notes"]);
    $item = $db->prepare("INSERT INTO items (name, section, category_id, user_id) VALUES (:name, :section, 1, 1)");
    $item->execute([":name" => "Bleibt erhalten", ":section" => "notes"]);
'

run_php "$PARCHMENT_LEGACY_DIR" '
    require "'"$ROOT_DIR"'/security.php"; require "'"$ROOT_DIR"'/db.php";
    $db = getDatabase();
    $row = $db->query("SELECT items.name AS item_name, categories.name AS category_name
                       FROM items JOIN categories ON categories.id = items.category_id
                       WHERE items.id = 1")->fetch(PDO::FETCH_ASSOC);
    if (($row["item_name"] ?? "") !== "Bleibt erhalten" || ($row["category_name"] ?? "") !== "Bestehend") {
        fwrite(STDERR, "Parchment-Migration hat bestehende Beziehungen nicht erhalten.\n");
        exit(1);
    }
    $stmt = $db->prepare("INSERT INTO categories (user_id, name, type) VALUES (1, :name, :type)");
    $stmt->execute([":name" => "Journal", ":type" => "daily_notes"]);
    if ($db->query("PRAGMA foreign_key_check")->fetchAll(PDO::FETCH_ASSOC) !== []) {
        fwrite(STDERR, "Parchment-Migration hat ungültige Fremdschlüssel hinterlassen.\n");
        exit(1);
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
