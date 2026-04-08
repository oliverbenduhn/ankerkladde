<?php
declare(strict_types=1);

const ATTACHMENT_SECTIONS = ['images', 'files'];

function getDataDirectory(): string
{
    $configuredDir = getenv('EINKAUF_DATA_DIR');

    if (is_string($configuredDir) && trim($configuredDir) !== '') {
        return rtrim($configuredDir, DIRECTORY_SEPARATOR);
    }

    return __DIR__ . '/data';
}

function ensureDirectoryExists(string $path): void
{
    if (is_dir($path)) {
        return;
    }

    if (!mkdir($path, 0775, true) && !is_dir($path)) {
        throw new RuntimeException(sprintf('Verzeichnis konnte nicht erstellt werden: %s', $path));
    }
}

function getUploadsDirectory(): string
{
    return getDataDirectory() . '/uploads';
}

function isAttachmentSection(string $section): bool
{
    return in_array($section, ATTACHMENT_SECTIONS, true);
}

function getAttachmentStorageDirectory(string $section): string
{
    if (!isAttachmentSection($section)) {
        throw new InvalidArgumentException('Ungültige Attachment-Sektion.');
    }

    return getUploadsDirectory() . '/' . $section;
}

function ensureUploadDirectories(): void
{
    ensureDirectoryExists(getDataDirectory());
    ensureDirectoryExists(getUploadsDirectory());

    foreach (ATTACHMENT_SECTIONS as $section) {
        ensureDirectoryExists(getAttachmentStorageDirectory($section));
    }
}

function normalizeAttachmentStoredName(string $storedName): string
{
    $storedName = trim($storedName);

    if ($storedName === '' || !preg_match('/\A[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}\z/', $storedName)) {
        throw new RuntimeException('Ungültiger gespeicherter Dateiname.');
    }

    return $storedName;
}

function getAttachmentStorageRelativePath(array $attachment): string
{
    $section = (string) ($attachment['storage_section'] ?? '');
    $storedName = normalizeAttachmentStoredName((string) ($attachment['stored_name'] ?? ''));

    if (!isAttachmentSection($section)) {
        throw new RuntimeException('Ungültige Attachment-Sektion.');
    }

    return $section . '/' . $storedName;
}

function getAttachmentAbsolutePath(array $attachment): string
{
    $section = (string) ($attachment['storage_section'] ?? '');
    $storedName = normalizeAttachmentStoredName((string) ($attachment['stored_name'] ?? ''));

    return getAttachmentStorageDirectory($section) . '/' . $storedName;
}

function findAttachmentByItemId(PDO $db, int $itemId): ?array
{
    $stmt = $db->prepare(
        'SELECT id, item_id, storage_section, stored_name, original_name, media_type, size_bytes, created_at, updated_at
         FROM attachments
         WHERE item_id = :item_id'
    );
    $stmt->execute([':item_id' => $itemId]);
    $attachment = $stmt->fetch();

    return is_array($attachment) ? $attachment : null;
}

function deleteAttachmentStorageFile(array $attachment): void
{
    $absolutePath = getAttachmentAbsolutePath($attachment);

    if (is_file($absolutePath) && !unlink($absolutePath)) {
        throw new RuntimeException(sprintf('Attachment-Datei konnte nicht gelöscht werden: %s', $absolutePath));
    }
}

function rebuildSortOrder(PDO $db): void
{
    $db->beginTransaction();

    try {
        $pragmaRows = $db->query('PRAGMA table_info(items)')->fetchAll();
        $columnNames = array_column($pragmaRows, 'name');
        $hasSection = in_array('section', $columnNames, true);

        $stmt = $db->prepare('UPDATE items SET sort_order = :sort_order WHERE id = :id');

        if ($hasSection) {
            // Per-section rebuild so sort_orders are relative within each section (1, 2, 3...)
            $sections = $db->query('SELECT DISTINCT section FROM items')->fetchAll(PDO::FETCH_COLUMN);
            foreach ($sections as $section) {
                $idsStmt = $db->prepare(
                    'SELECT id FROM items WHERE section = :section ORDER BY done ASC, updated_at DESC, id DESC'
                );
                $idsStmt->execute([':section' => $section]);
                $ids = $idsStmt->fetchAll(PDO::FETCH_COLUMN);
                foreach ($ids as $index => $id) {
                    $stmt->execute([':sort_order' => $index + 1, ':id' => (int) $id]);
                }
            }
        } else {
            // Original behavior: section column not yet present
            $ids = $db->query(
                'SELECT id FROM items ORDER BY done ASC, updated_at DESC, id DESC'
            )->fetchAll(PDO::FETCH_COLUMN);
            foreach ($ids as $index => $id) {
                $stmt->execute([':sort_order' => $index + 1, ':id' => (int) $id]);
            }
        }

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
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

    ensureUploadDirectories();

    $db = new PDO('sqlite:' . $dbFile);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $db->exec('PRAGMA journal_mode = WAL');
    $db->exec('PRAGMA foreign_keys = ON');
    $db->exec(
        "CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0, 1)),
            section TEXT NOT NULL DEFAULT 'shopping',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    );

    $columns = $db->query('PRAGMA table_info(items)')->fetchAll();
    $columnNames = array_map(static fn(array $column): string => $column['name'], $columns);

    if (!in_array('quantity', $columnNames, true)) {
        $db->exec("ALTER TABLE items ADD COLUMN quantity TEXT NOT NULL DEFAULT ''");
    }

    // Migrate section column BEFORE sort_order validation (order matters)
    if (!in_array('section', $columnNames, true)) {
        $db->exec("ALTER TABLE items ADD COLUMN section TEXT NOT NULL DEFAULT 'shopping'");
        // Refresh column list after migration
        $columns    = $db->query('PRAGMA table_info(items)')->fetchAll();
        $columnNames = array_map(static fn(array $column): string => $column['name'], $columns);
    }

    if (!in_array('sort_order', $columnNames, true)) {
        $db->exec("ALTER TABLE items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
        rebuildSortOrder($db);
    } else {
        // Per-section sort_order validity check
        $sections = $db->query('SELECT DISTINCT section FROM items')->fetchAll(PDO::FETCH_COLUMN);
        $needsRebuild = false;

        foreach ($sections as $sec) {
            $s = $db->prepare(
                'SELECT
                    COUNT(*) AS total,
                    COUNT(DISTINCT sort_order) AS distinct_count,
                    MIN(sort_order) AS min_sort_order
                 FROM items WHERE section = :section'
            );
            $s->execute([':section' => $sec]);
            $stats = $s->fetch();

            $total        = (int) ($stats['total'] ?? 0);
            $distinctCount = (int) ($stats['distinct_count'] ?? 0);
            $minSortOrder  = (int) ($stats['min_sort_order'] ?? 0);

            if ($total > 0 && ($distinctCount !== $total || $minSortOrder < 1)) {
                $needsRebuild = true;
                break;
            }
        }

        if ($needsRebuild) {
            rebuildSortOrder($db);
        }
    }

    // Re-fetch column list to avoid stale cache after previous migrations
    $columns     = $db->query('PRAGMA table_info(items)')->fetchAll();
    $columnNames = array_map(static fn(array $column): string => $column['name'], $columns);

    if (!in_array('content', $columnNames, true)) {
        $db->exec("ALTER TABLE items ADD COLUMN content TEXT NOT NULL DEFAULT ''");
    }

    $db->exec(
        "CREATE TABLE IF NOT EXISTS attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL UNIQUE,
            storage_section TEXT NOT NULL CHECK(storage_section IN ('images', 'files')),
            stored_name TEXT NOT NULL,
            original_name TEXT NOT NULL DEFAULT '',
            media_type TEXT NOT NULL DEFAULT 'application/octet-stream',
            size_bytes INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
        )"
    );
    $db->exec('CREATE INDEX IF NOT EXISTS idx_attachments_item_id ON attachments(item_id)');

    $attachmentColumns = $db->query('PRAGMA table_info(attachments)')->fetchAll();
    $attachmentColumnNames = array_map(static fn(array $column): string => $column['name'], $attachmentColumns);

    if (!in_array('original_name', $attachmentColumnNames, true)) {
        $db->exec("ALTER TABLE attachments ADD COLUMN original_name TEXT NOT NULL DEFAULT ''");
    }

    if (!in_array('media_type', $attachmentColumnNames, true)) {
        $db->exec("ALTER TABLE attachments ADD COLUMN media_type TEXT NOT NULL DEFAULT 'application/octet-stream'");
    }

    if (!in_array('size_bytes', $attachmentColumnNames, true)) {
        $db->exec("ALTER TABLE attachments ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0");
    }

    if (!in_array('created_at', $attachmentColumnNames, true)) {
        $db->exec("ALTER TABLE attachments ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
    }

    if (!in_array('updated_at', $attachmentColumnNames, true)) {
        $db->exec("ALTER TABLE attachments ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
    }

    return $db;
}
