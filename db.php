<?php
declare(strict_types=1);

const ATTACHMENT_SECTIONS = ['images', 'files'];
const USER_PREFERENCE_SECTIONS = ['shopping', 'meds', 'todo_private', 'todo_work', 'notes', 'images', 'files', 'links'];

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

function getDefaultUserPreferences(): array
{
    return [
        'mode' => 'liste',
        'section' => 'shopping',
        'tabs_hidden' => false,
        'tabs_order' => USER_PREFERENCE_SECTIONS,
        'hidden_sections' => [],
        'install_banner_dismissed' => false,
    ];
}

function normalizeUserPreferenceSections(mixed $value): array
{
    if (!is_array($value)) {
        return [];
    }

    $normalized = [];
    foreach ($value as $section) {
        if (!is_string($section) || !in_array($section, USER_PREFERENCE_SECTIONS, true)) {
            continue;
        }

        if (!in_array($section, $normalized, true)) {
            $normalized[] = $section;
        }
    }

    return $normalized;
}

function normalizeUserPreferences(array $preferences): array
{
    $defaults = getDefaultUserPreferences();
    $normalized = $defaults;

    if (isset($preferences['mode']) && in_array($preferences['mode'], ['liste', 'einkaufen'], true)) {
        $normalized['mode'] = $preferences['mode'];
    }

    $tabsOrder = normalizeUserPreferenceSections($preferences['tabs_order'] ?? null);
    if ($tabsOrder !== []) {
        $missingSections = array_values(array_diff(USER_PREFERENCE_SECTIONS, $tabsOrder));
        $normalized['tabs_order'] = [...$tabsOrder, ...$missingSections];
    }

    $hiddenSections = normalizeUserPreferenceSections($preferences['hidden_sections'] ?? null);
    if (count($hiddenSections) >= count(USER_PREFERENCE_SECTIONS)) {
        $hiddenSections = array_values(array_diff(USER_PREFERENCE_SECTIONS, [$defaults['section']]));
    }

    $visibleSections = array_values(array_diff(USER_PREFERENCE_SECTIONS, $hiddenSections));
    if ($visibleSections === []) {
        $visibleSections = [$defaults['section']];
        $hiddenSections = array_values(array_diff(USER_PREFERENCE_SECTIONS, $visibleSections));
    }

    $normalized['hidden_sections'] = $hiddenSections;

    $preferredSection = $preferences['section'] ?? $defaults['section'];
    if (!is_string($preferredSection) || !in_array($preferredSection, USER_PREFERENCE_SECTIONS, true) || in_array($preferredSection, $hiddenSections, true)) {
        $preferredSection = $visibleSections[0];
    }
    $normalized['section'] = $preferredSection;

    if (array_key_exists('tabs_hidden', $preferences)) {
        $normalized['tabs_hidden'] = (bool) $preferences['tabs_hidden'];
    }

    if (array_key_exists('install_banner_dismissed', $preferences)) {
        $normalized['install_banner_dismissed'] = (bool) $preferences['install_banner_dismissed'];
    }

    return $normalized;
}

function getUserPreferences(PDO $db, int $userId): array
{
    $stmt = $db->prepare('SELECT preferences_json FROM users WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $userId]);
    $row = $stmt->fetch();

    if (!is_array($row)) {
        return getDefaultUserPreferences();
    }

    $rawPreferences = $row['preferences_json'] ?? '{}';
    $decoded = json_decode(is_string($rawPreferences) ? $rawPreferences : '{}', true);

    return normalizeUserPreferences(is_array($decoded) ? $decoded : []);
}

function updateUserPreferences(PDO $db, int $userId, array $patch): array
{
    $preferences = normalizeUserPreferences([
        ...getUserPreferences($db, $userId),
        ...$patch,
    ]);

    $stmt = $db->prepare('UPDATE users SET preferences_json = :preferences_json WHERE id = :id');
    $stmt->execute([
        ':id' => $userId,
        ':preferences_json' => json_encode($preferences, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);

    return $preferences;
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

    // Re-fetch so we see all columns added so far
    $columns     = $db->query('PRAGMA table_info(items)')->fetchAll();
    $columnNames = array_map(static fn(array $column): string => $column['name'], $columns);

    if (!in_array('due_date', $columnNames, true)) {
        $db->exec("ALTER TABLE items ADD COLUMN due_date TEXT NOT NULL DEFAULT ''");
        // Migrate ISO dates that were stored in quantity for todo sections
        $db->exec(
            "UPDATE items
             SET due_date = quantity, quantity = ''
             WHERE section IN ('todo_private', 'todo_work')
               AND length(quantity) = 10
               AND quantity GLOB '????-??-??'"
        );
    }

    if (!in_array('is_pinned', $columnNames, true)) {
        $db->exec("ALTER TABLE items ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0 CHECK(is_pinned IN (0, 1))");
    }

    // FTS5 full-text search index
    $hasFts = (bool) $db->query(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'items_fts'"
    )->fetchColumn();

    if (!$hasFts) {
        $db->exec(
            "CREATE VIRTUAL TABLE items_fts USING fts5(
                name,
                content,
                content = 'items',
                content_rowid = 'id'
            )"
        );
        // Populate from existing data
        $db->exec("INSERT INTO items_fts(items_fts) VALUES('rebuild')");

        $db->exec(
            "CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
                INSERT INTO items_fts(rowid, name, content) VALUES (new.id, new.name, new.content);
            END"
        );
        $db->exec(
            "CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN
                INSERT INTO items_fts(items_fts, rowid, name, content)
                VALUES ('delete', old.id, old.name, old.content);
            END"
        );
        $db->exec(
            "CREATE TRIGGER items_au AFTER UPDATE ON items BEGIN
                INSERT INTO items_fts(items_fts, rowid, name, content)
                VALUES ('delete', old.id, old.name, old.content);
                INSERT INTO items_fts(rowid, name, content) VALUES (new.id, new.name, new.content);
            END"
        );
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

    // ── Users table ──────────────────────────────────────────────────
    $db->exec(
        "CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT    NOT NULL UNIQUE,
            password_hash TEXT    NOT NULL,
            is_admin      INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0, 1)),
            preferences_json TEXT NOT NULL DEFAULT '{}',
            created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    );

    $userColumns = $db->query('PRAGMA table_info(users)')->fetchAll();
    $userColumnNames = array_map(static fn(array $column): string => $column['name'], $userColumns);

    if (!in_array('preferences_json', $userColumnNames, true)) {
        $db->exec("ALTER TABLE users ADD COLUMN preferences_json TEXT NOT NULL DEFAULT '{}'");
    }

    // ── items.user_id migration ───────────────────────────────────────
    $columns     = $db->query('PRAGMA table_info(items)')->fetchAll();
    $columnNames = array_map(static fn(array $column): string => $column['name'], $columns);

    if (!in_array('user_id', $columnNames, true)) {
        $db->exec('ALTER TABLE items ADD COLUMN user_id INTEGER REFERENCES users(id)');
    }

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
