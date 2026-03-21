<?php
declare(strict_types=1);

function getDataDirectory(): string
{
    $configuredDir = getenv('EINKAUF_DATA_DIR');

    if (is_string($configuredDir) && trim($configuredDir) !== '') {
        return rtrim($configuredDir, DIRECTORY_SEPARATOR);
    }

    return __DIR__ . '/data';
}

function rebuildSortOrder(PDO $db): void
{
    $ids = $db->query(
        'SELECT id
         FROM items
         ORDER BY done ASC, updated_at DESC, id DESC'
    )->fetchAll(PDO::FETCH_COLUMN);

    $stmt = $db->prepare('UPDATE items SET sort_order = :sort_order WHERE id = :id');

    foreach ($ids as $index => $id) {
        $stmt->execute([
            ':sort_order' => $index + 1,
            ':id' => (int) $id,
        ]);
    }
}

function getDatabase(): PDO
{
    static $db = null;

    if ($db instanceof PDO) {
        return $db;
    }

    $dataDir = getDataDirectory();
    $dbFile = $dataDir . '/einkaufsliste.db';

    if (!is_dir($dataDir) && !mkdir($dataDir, 0775, true) && !is_dir($dataDir)) {
        throw new RuntimeException('Datenverzeichnis konnte nicht erstellt werden.');
    }

    $db = new PDO('sqlite:' . $dbFile);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $db->exec('PRAGMA journal_mode = WAL');
    $db->exec('PRAGMA foreign_keys = ON');
    $db->exec(
        'CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0, 1)),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )'
    );

    $columns = $db->query('PRAGMA table_info(items)')->fetchAll();
    $columnNames = array_map(static fn(array $column): string => $column['name'], $columns);

    if (!in_array('quantity', $columnNames, true)) {
        $db->exec("ALTER TABLE items ADD COLUMN quantity TEXT NOT NULL DEFAULT ''");
    }

    if (!in_array('sort_order', $columnNames, true)) {
        $db->exec("ALTER TABLE items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
        rebuildSortOrder($db);
    } else {
        $stats = $db->query(
            'SELECT
                COUNT(*) AS total,
                COUNT(DISTINCT sort_order) AS distinct_count,
                MIN(sort_order) AS min_sort_order
             FROM items'
        )->fetch();

        $total = (int) ($stats['total'] ?? 0);
        $distinctCount = (int) ($stats['distinct_count'] ?? 0);
        $minSortOrder = (int) ($stats['min_sort_order'] ?? 0);

        if ($total > 0 && ($distinctCount !== $total || $minSortOrder < 1)) {
            rebuildSortOrder($db);
        }
    }

    return $db;
}
