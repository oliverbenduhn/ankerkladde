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
    require "'"$ROOT_DIR"'/db.php";
    $db = getDatabase();
    $columns = array_column($db->query("PRAGMA table_info(items)")->fetchAll(PDO::FETCH_ASSOC), "name");
    if (!in_array("quantity", $columns, true) || !in_array("sort_order", $columns, true)) {
        fwrite(STDERR, "Legacy-Migration hat Spalten nicht ergänzt.\n");
        exit(1);
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
    require "'"$ROOT_DIR"'/db.php";
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

echo "DB-Migrationstest erfolgreich."
