<?php
declare(strict_types=1);

date_default_timezone_set('Europe/Berlin');

require_once __DIR__ . '/src/Constants.php';


require_once __DIR__ . '/src/FileHelper.php';

require_once __DIR__ . '/src/ImageHelper.php';

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


require_once __DIR__ . '/src/CategoryRepository.php';

require_once __DIR__ . '/src/UserRepository.php';

function rebuildSortOrder(PDO $db): void
{
    $db->beginTransaction();

    try {
        $pragmaRows = $db->query('PRAGMA table_info(items)')->fetchAll();
        $columnNames = array_column($pragmaRows, 'name');
        $hasCategoryId = in_array('category_id', $columnNames, true);
        $hasSection = in_array('section', $columnNames, true);

        $stmt = $db->prepare('UPDATE items SET sort_order = :sort_order WHERE id = :id');

        if ($hasCategoryId) {
            $categoryIds = $db->query('SELECT DISTINCT category_id FROM items WHERE category_id IS NOT NULL')->fetchAll(PDO::FETCH_COLUMN);

            foreach ($categoryIds as $categoryId) {
                $idsStmt = $db->prepare(
                    'SELECT id FROM items WHERE category_id = :category_id ORDER BY done ASC, updated_at DESC, id DESC'
                );
                $idsStmt->execute([':category_id' => $categoryId]);
                $ids = $idsStmt->fetchAll(PDO::FETCH_COLUMN);

                foreach ($ids as $index => $id) {
                    $stmt->execute([':sort_order' => $index + 1, ':id' => (int) $id]);
                }
            }
        }

        if ($hasSection) {
            $sectionSql = $hasCategoryId
                ? 'SELECT DISTINCT section FROM items WHERE category_id IS NULL'
                : 'SELECT DISTINCT section FROM items';
            $sections = $db->query($sectionSql)->fetchAll(PDO::FETCH_COLUMN);
            foreach ($sections as $section) {
                if ($hasCategoryId) {
                    $idsStmt = $db->prepare(
                        'SELECT id FROM items WHERE section = :section AND category_id IS NULL ORDER BY done ASC, updated_at DESC, id DESC'
                    );
                    $idsStmt->execute([':section' => $section]);
                } else {
                    $idsStmt = $db->prepare(
                        'SELECT id FROM items WHERE section = :section ORDER BY done ASC, updated_at DESC, id DESC'
                    );
                    $idsStmt->execute([':section' => $section]);
                }
                $ids = $idsStmt->fetchAll(PDO::FETCH_COLUMN);

                foreach ($ids as $index => $id) {
                    $stmt->execute([':sort_order' => $index + 1, ':id' => (int) $id]);
                }
            }
        } elseif (!$hasCategoryId) {
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

function hasDatabaseMetaFlag(PDO $db, string $key): bool
{
    $stmt = $db->prepare('SELECT 1 FROM database_meta WHERE meta_key = :meta_key LIMIT 1');
    $stmt->execute([':meta_key' => $key]);

    return $stmt->fetchColumn() !== false;
}

function setDatabaseMetaFlag(PDO $db, string $key): void
{
    $stmt = $db->prepare(
        'INSERT INTO database_meta (meta_key, meta_value, updated_at)
         VALUES (:meta_key, :meta_value, CURRENT_TIMESTAMP)
         ON CONFLICT(meta_key) DO UPDATE SET
            meta_value = excluded.meta_value,
            updated_at = CURRENT_TIMESTAMP'
    );
    $stmt->execute([
        ':meta_key' => $key,
        ':meta_value' => '1',
    ]);
}

function normalizeUploadLimitSettings(array $settings): array
{
    $normalized = DEFAULT_UPLOAD_LIMITS_MB;

    foreach (array_keys(DEFAULT_UPLOAD_LIMITS_MB) as $key) {
        $value = filter_var($settings[$key] ?? null, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1, 'max_range' => 10240],
        ]);
        if (is_int($value)) {
            $normalized[$key] = $value;
        }
    }

    return $normalized;
}

function getUploadLimitSettings(PDO $db): array
{
    $stmt = $db->prepare('SELECT meta_value FROM database_meta WHERE meta_key = :meta_key LIMIT 1');
    $stmt->execute([':meta_key' => 'upload_limit_settings']);
    $raw = $stmt->fetchColumn();
    $decoded = json_decode(is_string($raw) ? $raw : '{}', true);

    return normalizeUploadLimitSettings(is_array($decoded) ? $decoded : []);
}

function updateUploadLimitSettings(PDO $db, array $settings): array
{
    $normalized = normalizeUploadLimitSettings($settings);
    $stmt = $db->prepare(
        'INSERT INTO database_meta (meta_key, meta_value, updated_at)
         VALUES (:meta_key, :meta_value, CURRENT_TIMESTAMP)
         ON CONFLICT(meta_key) DO UPDATE SET
            meta_value = excluded.meta_value,
            updated_at = CURRENT_TIMESTAMP'
    );
    $stmt->execute([
        ':meta_key' => 'upload_limit_settings',
        ':meta_value' => json_encode($normalized, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);

    return $normalized;
}

function migrateRemoteImportUploadLimitDefault(PDO $db): void
{
    $settings = getUploadLimitSettings($db);
    if ((int) ($settings['remote_file_import_max_mb'] ?? 0) !== 500) {
        return;
    }

    $settings['remote_file_import_max_mb'] = DEFAULT_UPLOAD_LIMITS_MB['remote_file_import_max_mb'];
    updateUploadLimitSettings($db, $settings);
}

function uploadLimitMegabytesToBytes(int $megabytes): int
{
    return $megabytes * 1024 * 1024;
}

function hasInvalidSortOrder(PDO $db, string $whereClause = '', array $params = []): bool
{
    $sql = 'SELECT
                COUNT(*) AS total,
                COUNT(DISTINCT sort_order) AS distinct_count,
                MIN(sort_order) AS min_sort_order
            FROM items';

    if ($whereClause !== '') {
        $sql .= ' WHERE ' . $whereClause;
    }

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $stats = $stmt->fetch();

    $total = (int) ($stats['total'] ?? 0);
    $distinctCount = (int) ($stats['distinct_count'] ?? 0);
    $minSortOrder = (int) ($stats['min_sort_order'] ?? 0);

    return $total > 0 && ($distinctCount !== $total || $minSortOrder < 1);
}

/**
 * Checks in a single query whether any category group (or orphan section group)
 * has a broken sort_order — replacing the previous N+1 per-category loop.
 *
 * Expected impact: reduces sort_order validation from N+1 queries to 1 query
 * on every PHP worker startup (once per process lifetime via the static $db cache).
 */
function hasAnyInvalidSortOrderByGroup(PDO $db, bool $hasCategoryId, bool $hasSection): bool
{
    if ($hasCategoryId) {
        // Check all category groups in one pass
        $stmt = $db->query(
            'SELECT COUNT(*) AS total,
                    COUNT(DISTINCT sort_order) AS distinct_count,
                    MIN(sort_order) AS min_sort_order
             FROM items
             WHERE category_id IS NOT NULL
             GROUP BY category_id
             HAVING total > 0 AND (distinct_count != total OR min_sort_order < 1)
             LIMIT 1'
        );
        if ($stmt->fetch() !== false) {
            return true;
        }

        if ($hasSection) {
            // Check orphan (legacy) section groups in one pass
            $stmt = $db->query(
                'SELECT COUNT(*) AS total,
                        COUNT(DISTINCT sort_order) AS distinct_count,
                        MIN(sort_order) AS min_sort_order
                 FROM items
                 WHERE category_id IS NULL
                 GROUP BY section
                 HAVING total > 0 AND (distinct_count != total OR min_sort_order < 1)
                 LIMIT 1'
            );
            if ($stmt->fetch() !== false) {
                return true;
            }
        }

        return false;
    }

    if ($hasSection) {
        $stmt = $db->query(
            'SELECT COUNT(*) AS total,
                    COUNT(DISTINCT sort_order) AS distinct_count,
                    MIN(sort_order) AS min_sort_order
             FROM items
             GROUP BY section
             HAVING total > 0 AND (distinct_count != total OR min_sort_order < 1)
             LIMIT 1'
        );
        return $stmt->fetch() !== false;
    }

    // No grouping columns — check the whole table
    return hasInvalidSortOrder($db);
}





function nextItemSortOrder(PDO $db, int $userId, int $categoryId): int
{
    $maxStmt = $db->prepare(
        'SELECT COALESCE(MAX(sort_order), 0) FROM items WHERE category_id = :category_id AND user_id = :user_id'
    );
    $maxStmt->execute([':category_id' => $categoryId, ':user_id' => $userId]);
    return (int) $maxStmt->fetchColumn() + 1;
}

function prependItemSortOrder(PDO $db, int $userId, int $categoryId): int
{
    $shiftStmt = $db->prepare(
        'UPDATE items
         SET sort_order = sort_order + 1
         WHERE category_id = :category_id AND user_id = :user_id'
    );
    $shiftStmt->execute([':category_id' => $categoryId, ':user_id' => $userId]);

    return 1;
}



function upsertScannedProduct(PDO $db, string $barcode, array $data, bool $confirmed): void
{
    $stmt = $db->prepare(
        'INSERT INTO scanned_products (barcode, product_name, brands, quantity, confirmed, scan_count, updated_at)
         VALUES (:barcode, :product_name, :brands, :quantity, :confirmed, 0, CURRENT_TIMESTAMP)
         ON CONFLICT(barcode) DO UPDATE SET
             product_name = :product_name,
             brands       = :brands,
             quantity     = :quantity,
             confirmed    = MAX(confirmed, :confirmed),
             updated_at   = CURRENT_TIMESTAMP'
    );
    $stmt->execute([
        ':barcode'      => $barcode,
        ':product_name' => (string) ($data['product_name'] ?? ''),
        ':brands'       => (string) ($data['brands'] ?? ''),
        ':quantity'     => (string) ($data['quantity'] ?? ''),
        ':confirmed'    => $confirmed ? 1 : 0,
    ]);
}

function getProductDatabase(): PDO
{
    static $productDb = null;

    if ($productDb instanceof PDO) {
        return $productDb;
    }

    $dbFile = getDataDirectory() . '/products.db';
    $productDb = new PDO('sqlite:' . $dbFile);
    $productDb->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $productDb->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $productDb->exec('PRAGMA busy_timeout = 3000');
    $productDb->exec('PRAGMA journal_mode = WAL');

    $productDb->exec(
        "CREATE TABLE IF NOT EXISTS product_catalog (
            barcode TEXT PRIMARY KEY,
            product_name TEXT NOT NULL DEFAULT '',
            brands TEXT NOT NULL DEFAULT '',
            quantity TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    );

    return $productDb;
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
    $db->exec('PRAGMA busy_timeout = 3000');
    $db->exec('PRAGMA journal_mode = WAL');
    $db->exec('PRAGMA foreign_keys = ON');

    $db->exec(
        "CREATE TABLE IF NOT EXISTS database_meta (
            meta_key TEXT PRIMARY KEY,
            meta_value TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    );

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

    if (!in_array('section', $columnNames, true)) {
        $db->exec("ALTER TABLE items ADD COLUMN section TEXT NOT NULL DEFAULT 'shopping'");
        $columns = $db->query('PRAGMA table_info(items)')->fetchAll();
        $columnNames = array_map(static fn(array $column): string => $column['name'], $columns);
    }

    if (!in_array('sort_order', $columnNames, true)) {
        $db->exec("ALTER TABLE items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
        rebuildSortOrder($db);
    } else {
        // Single grouped query replaces the previous N+1 per-category loop
        $hasCategoryId = in_array('category_id', $columnNames, true);
        $hasSectionCol = in_array('section', $columnNames, true);
        if (hasAnyInvalidSortOrderByGroup($db, $hasCategoryId, $hasSectionCol)) {
            rebuildSortOrder($db);
        }
    }

    $columns = $db->query('PRAGMA table_info(items)')->fetchAll();
    $columnNames = array_map(static fn(array $column): string => $column['name'], $columns);

    if (!in_array('content', $columnNames, true)) {
        $db->exec("ALTER TABLE items ADD COLUMN content TEXT NOT NULL DEFAULT ''");
    }

    $columns = $db->query('PRAGMA table_info(items)')->fetchAll();
    $columnNames = array_map(static fn(array $column): string => $column['name'], $columns);

    if (!in_array('due_date', $columnNames, true)) {
        $db->exec("ALTER TABLE items ADD COLUMN due_date TEXT NOT NULL DEFAULT ''");
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

    $columns = $db->query('PRAGMA table_info(items)')->fetchAll();
    $columnNames = array_map(static fn(array $column): string => $column['name'], $columns);

    if (!in_array('barcode', $columnNames, true)) {
        $db->exec("ALTER TABLE items ADD COLUMN barcode TEXT NOT NULL DEFAULT ''");
    }

    $columns = $db->query('PRAGMA table_info(items)')->fetchAll();
    $columnNames = array_map(static fn(array $column): string => $column['name'], $columns);

    if (!in_array('status', $columnNames, true)) {
        $db->exec("ALTER TABLE items ADD COLUMN status TEXT NOT NULL DEFAULT '' CHECK(status IN ('', 'in_progress', 'waiting'))");
    }

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
    $db->exec('DROP INDEX IF EXISTS idx_attachments_item_id');

    $db->exec(
        "CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0, 1)),
            must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0, 1)),
            api_key TEXT,
            api_key_created_at TEXT,
            preferences_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    );

    $userColumns = $db->query('PRAGMA table_info(users)')->fetchAll();
    $userColumnNames = array_map(static fn(array $column): string => $column['name'], $userColumns);

    if (!in_array('preferences_json', $userColumnNames, true)) {
        $db->exec("ALTER TABLE users ADD COLUMN preferences_json TEXT NOT NULL DEFAULT '{}'");
    }

    if (!in_array('api_key', $userColumnNames, true)) {
        $db->exec("ALTER TABLE users ADD COLUMN api_key TEXT");
    }

    if (!in_array('api_key_created_at', $userColumnNames, true)) {
        $db->exec("ALTER TABLE users ADD COLUMN api_key_created_at TEXT");
    }

    if (!in_array('must_change_password', $userColumnNames, true)) {
        $db->exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
    }

    $db->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key)');

    $columns = $db->query('PRAGMA table_info(items)')->fetchAll();
    $columnNames = array_map(static fn(array $column): string => $column['name'], $columns);

    if (!in_array('user_id', $columnNames, true)) {
        $db->exec('ALTER TABLE items ADD COLUMN user_id INTEGER REFERENCES users(id)');
    }

    if (!in_array('category_id', $columnNames, true)) {
        $db->exec('ALTER TABLE items ADD COLUMN category_id INTEGER REFERENCES categories(id)');
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

    $db->exec(
        "CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('list_quantity', 'list_due_date', 'notes', 'images', 'files', 'links')),
            icon TEXT NOT NULL DEFAULT '',
            legacy_key TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_hidden INTEGER NOT NULL DEFAULT 0 CHECK(is_hidden IN (0, 1)),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    );
    $db->exec('CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_categories_user_sort ON categories(user_id, sort_order)');
    // Composite index: the hot `action=list` query always filters both category_id AND user_id.
    // A single-column index on category_id forces SQLite to post-filter by user_id across all
    // matching rows. The composite (category_id, user_id) satisfies both predicates in one lookup.
    // category_id stays leading so the index also covers any query that filters only by category_id.
    // Expected impact: reduces per-request row scans on the most frequent query path (tab switch).
    $db->exec('CREATE INDEX IF NOT EXISTS idx_items_category_user ON items(category_id, user_id)');
    // Index on user_id alone covers the full-text search join (items_fts → items WHERE user_id = ?)
    // which currently has no dedicated index, forcing a full scan of the joined items rows.
    // Expected impact: faster search results, especially as item counts grow.
    $db->exec('CREATE INDEX IF NOT EXISTS idx_items_user_id ON items(user_id)');
    // One-time migration: product_catalog aus einkaufsliste.db in products.db verschieben
    $productCatalogMigrationKey = 'product_catalog_migrated_to_products_db_v1';
    if (!hasDatabaseMetaFlag($db, $productCatalogMigrationKey)) {
        $catalogTableExists = (bool) $db->query(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='product_catalog'"
        )->fetchColumn();

        if ($catalogTableExists) {
            $productDb = getProductDatabase();
            $insertStmt = $productDb->prepare(
                'INSERT OR IGNORE INTO product_catalog
                 (barcode, product_name, brands, quantity, source, created_at, updated_at)
                 VALUES (:barcode, :product_name, :brands, :quantity, :source, :created_at, :updated_at)'
            );
            $selectStmt = $db->query('SELECT * FROM product_catalog');
            $productDb->beginTransaction();
            $count = 0;
            while ($row = $selectStmt->fetch()) {
                $insertStmt->execute([
                    ':barcode'      => (string) ($row['barcode'] ?? ''),
                    ':product_name' => (string) ($row['product_name'] ?? ''),
                    ':brands'       => (string) ($row['brands'] ?? ''),
                    ':quantity'     => (string) ($row['quantity'] ?? ''),
                    ':source'       => (string) ($row['source'] ?? ''),
                    ':created_at'   => (string) ($row['created_at'] ?? ''),
                    ':updated_at'   => (string) ($row['updated_at'] ?? ''),
                ]);
                $count++;
                if ($count % 5000 === 0) {
                    $productDb->commit();
                    $productDb->beginTransaction();
                }
            }
            $productDb->commit();
            $db->exec('DROP TABLE product_catalog');
        }

        setDatabaseMetaFlag($db, $productCatalogMigrationKey);
    }

    $db->exec(
        "CREATE TABLE IF NOT EXISTS scanned_products (
            barcode      TEXT PRIMARY KEY,
            product_name TEXT NOT NULL DEFAULT '',
            brands       TEXT NOT NULL DEFAULT '',
            quantity     TEXT NOT NULL DEFAULT '',
            confirmed    INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0, 1)),
            scan_count   INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"
    );

    $categoryColumns = $db->query('PRAGMA table_info(categories)')->fetchAll();
    $categoryColumnNames = array_map(static fn(array $column): string => $column['name'], $categoryColumns);
    if (!in_array('icon', $categoryColumnNames, true)) {
        $db->exec("ALTER TABLE categories ADD COLUMN icon TEXT NOT NULL DEFAULT ''");
    }
    if (!in_array('legacy_key', $categoryColumnNames, true)) {
        $db->exec("ALTER TABLE categories ADD COLUMN legacy_key TEXT NOT NULL DEFAULT ''");
    }

    $ensureDefaultCategoriesKey = 'default_categories_ensured_v1';
    if (!hasDatabaseMetaFlag($db, $ensureDefaultCategoriesKey)) {
        ensureDefaultCategories($db);
        setDatabaseMetaFlag($db, $ensureDefaultCategoriesKey);
    }

    $legacyMigrationKey = 'legacy_categories_migration_v2';
    if (!hasDatabaseMetaFlag($db, $legacyMigrationKey)) {
        migrateLegacyCategories($db);
        migrateLegacyPreferencesToCategories($db);
        backfillLegacyCategoryKeys($db);
        cleanupDuplicateLegacyCategories($db);

        $fillIconsStmt = $db->prepare('UPDATE categories SET icon = :icon WHERE id = :id');
        $categoryRows = $db->query('SELECT id, type, icon FROM categories')->fetchAll();
        foreach ($categoryRows as $categoryRow) {
            $icon = normalizeCategoryIcon((string) ($categoryRow['icon'] ?? ''), (string) ($categoryRow['type'] ?? ''));
            if ($icon !== (string) ($categoryRow['icon'] ?? '')) {
                $fillIconsStmt->execute([
                    ':id' => (int) $categoryRow['id'],
                    ':icon' => $icon,
                ]);
            }
        }
        setDatabaseMetaFlag($db, $legacyMigrationKey);
    }

    $categoryIconAssetsMigrationKey = 'category_icon_assets_migrated_v1';
    if (!hasDatabaseMetaFlag($db, $categoryIconAssetsMigrationKey)) {
        migrateCategoryIconsToAssetKeys($db);
        setDatabaseMetaFlag($db, $categoryIconAssetsMigrationKey);
    }

    $orphanSortOrderMigrationKey = 'orphan_sort_order_rebuilt_v1';
    if (!hasDatabaseMetaFlag($db, $orphanSortOrderMigrationKey)) {
        $orphanItems = (int) $db->query('SELECT COUNT(*) FROM items WHERE user_id IS NOT NULL AND category_id IS NULL')->fetchColumn();
        if ($orphanItems > 0) {
            rebuildSortOrder($db);
        }
        setDatabaseMetaFlag($db, $orphanSortOrderMigrationKey);
    }

    $remoteImportLimitMigrationKey = 'remote_import_upload_limit_10240_v1';
    if (!hasDatabaseMetaFlag($db, $remoteImportLimitMigrationKey)) {
        migrateRemoteImportUploadLimitDefault($db);
        setDatabaseMetaFlag($db, $remoteImportLimitMigrationKey);
    }

    return $db;
}
