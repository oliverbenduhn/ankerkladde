<?php
declare(strict_types=1);

const CATEGORY_TYPES = ['list_quantity', 'list_due_date', 'notes', 'images', 'files', 'links'];
const ATTACHMENT_CATEGORY_TYPES = ['images', 'files'];
const CATEGORY_ICON_OPTIONS = [
    '🛒', '💊', '✅', '💼', '📝', '🖼️', '📁', '🔗',
    '⭐', '📌', '🏠', '🚗', '🍎', '🥦', '🧴', '🎁',
    '📚', '💡', '🔧', '📦', '🐶', '👶', '❤️', '☀️',
];
const LEGACY_CATEGORY_DEFINITIONS = [
    'shopping' => ['name' => 'Einkauf', 'type' => 'list_quantity', 'sort_order' => 1, 'icon' => '🛒'],
    'todo_private' => ['name' => 'Privat', 'type' => 'list_due_date', 'sort_order' => 2, 'icon' => '✅'],
    'todo_work' => ['name' => 'Arbeit', 'type' => 'list_due_date', 'sort_order' => 3, 'icon' => '💼'],
    'notes' => ['name' => 'Notizen', 'type' => 'notes', 'sort_order' => 4, 'icon' => '📝'],
    'images' => ['name' => 'Bilder', 'type' => 'images', 'sort_order' => 5, 'icon' => '🖼️'],
    'files' => ['name' => 'Dateien', 'type' => 'files', 'sort_order' => 6, 'icon' => '📁'],
    'links' => ['name' => 'Links', 'type' => 'links', 'sort_order' => 7, 'icon' => '🔗'],
];

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

function isAttachmentCategoryType(string $type): bool
{
    return in_array($type, ATTACHMENT_CATEGORY_TYPES, true);
}

function getAttachmentStorageDirectory(string $section): string
{
    if (!isAttachmentCategoryType($section)) {
        throw new InvalidArgumentException('Ungültige Attachment-Sektion.');
    }

    return getUploadsDirectory() . '/' . $section;
}

function ensureUploadDirectories(): void
{
    ensureDirectoryExists(getDataDirectory());
    ensureDirectoryExists(getUploadsDirectory());

    foreach (ATTACHMENT_CATEGORY_TYPES as $section) {
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

    if (!isAttachmentCategoryType($section)) {
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

function getAttachmentThumbnailAbsolutePath(array $attachment): string
{
    $section = (string) ($attachment['storage_section'] ?? '');
    if ($section !== 'images') {
        return getAttachmentAbsolutePath($attachment);
    }

    $storedName = normalizeAttachmentStoredName((string) ($attachment['stored_name'] ?? ''));
    $baseName = pathinfo($storedName, PATHINFO_FILENAME);

    return getAttachmentStorageDirectory($section) . '/thumb-' . $baseName . '.jpg';
}

function canGenerateImageThumbnail(): bool
{
    return function_exists('imagecreatefromstring')
        && function_exists('imagecreatetruecolor')
        && function_exists('imagecopyresampled')
        && function_exists('imagejpeg');
}

function applyImageExifOrientation($image, string $sourcePath)
{
    if (!function_exists('exif_read_data') || !function_exists('imagerotate') || !is_file($sourcePath)) {
        return $image;
    }

    $exif = @exif_read_data($sourcePath);
    $orientation = (int) ($exif['Orientation'] ?? 1);

    $angle = match ($orientation) {
        3 => 180,
        6 => -90,
        8 => 90,
        default => 0,
    };

    if ($angle === 0) {
        return $image;
    }

    $rotated = @imagerotate($image, $angle, 0);
    if ($rotated === false) {
        return $image;
    }

    imagedestroy($image);
    return $rotated;
}

function generateImageThumbnailFile(
    string $sourcePath,
    string $targetPath,
    int $maxWidth = 480,
    int $maxHeight = 480,
    int $jpegQuality = 82
): bool {
    if (!canGenerateImageThumbnail() || !is_file($sourcePath)) {
        return false;
    }

    $sourceBytes = @file_get_contents($sourcePath);
    if (!is_string($sourceBytes) || $sourceBytes === '') {
        return false;
    }

    $sourceImage = @imagecreatefromstring($sourceBytes);
    unset($sourceBytes);
    if ($sourceImage === false) {
        return false;
    }

    $sourceWidth = imagesx($sourceImage);
    $sourceHeight = imagesy($sourceImage);
    if ($sourceWidth < 1 || $sourceHeight < 1) {
        imagedestroy($sourceImage);
        return false;
    }

    $scale = min($maxWidth / $sourceWidth, $maxHeight / $sourceHeight, 1);
    $targetWidth = max(1, (int) round($sourceWidth * $scale));
    $targetHeight = max(1, (int) round($sourceHeight * $scale));

    $thumbnail = imagecreatetruecolor($targetWidth, $targetHeight);
    if ($thumbnail === false) {
        imagedestroy($sourceImage);
        return false;
    }

    $background = imagecolorallocate($thumbnail, 255, 255, 255);
    imagefill($thumbnail, 0, 0, $background);

    $copied = imagecopyresampled(
        $thumbnail,
        $sourceImage,
        0,
        0,
        0,
        0,
        $targetWidth,
        $targetHeight,
        $sourceWidth,
        $sourceHeight
    );

    imagedestroy($sourceImage);

    if ($copied === false) {
        imagedestroy($thumbnail);
        return false;
    }

    // Rotate only the small thumbnail — avoids memory exhaustion on large originals
    $thumbnail = applyImageExifOrientation($thumbnail, $sourcePath);

    $saved = imagejpeg($thumbnail, $targetPath, $jpegQuality);
    imagedestroy($thumbnail);

    return $saved;
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
    $thumbnailPath = getAttachmentThumbnailAbsolutePath($attachment);

    if (is_file($absolutePath) && !unlink($absolutePath)) {
        throw new RuntimeException(sprintf('Attachment-Datei konnte nicht gelöscht werden: %s', $absolutePath));
    }

    if ($thumbnailPath !== $absolutePath && is_file($thumbnailPath) && !unlink($thumbnailPath)) {
        throw new RuntimeException(sprintf('Thumbnail-Datei konnte nicht gelöscht werden: %s', $thumbnailPath));
    }
}

function legacyCategoryDefinition(string $legacyKey): ?array
{
    return LEGACY_CATEGORY_DEFINITIONS[$legacyKey] ?? null;
}

function categoryTypeLabel(string $type): string
{
    return match ($type) {
        'list_quantity' => 'Liste mit Menge',
        'list_due_date' => 'Liste mit Datum',
        'notes' => 'Notizen',
        'images' => 'Bilder',
        'files' => 'Dateien',
        'links' => 'Links',
        default => $type,
    };
}

function defaultCategoryIcon(string $type): string
{
    return match ($type) {
        'list_quantity' => '🛒',
        'list_due_date' => '✅',
        'notes' => '📝',
        'images' => '🖼️',
        'files' => '📁',
        'links' => '🔗',
        default => '•',
    };
}

function normalizeCategoryIcon(?string $value, ?string $fallbackType = null): string
{
    $value = trim((string) $value);
    $value = preg_replace('/\s+/u', ' ', $value) ?? '';

    if ($value === '') {
        return $fallbackType !== null ? defaultCategoryIcon($fallbackType) : '•';
    }

    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, 8);
    }

    return substr($value, 0, 8);
}

function getCategoryIconOptions(): array
{
    return CATEGORY_ICON_OPTIONS;
}

function normalizeUsername(?string $value): string
{
    $value = trim((string) $value);
    $value = preg_replace('/[\x00-\x1F\x7F]+/u', '', $value) ?? '';

    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, 120);
    }

    return substr($value, 0, 120);
}

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

function getDefaultUserPreferences(): array
{
    return [
        'mode' => 'liste',
        'tabs_hidden' => false,
        'category_swipe_enabled' => true,
        'last_category_id' => null,
        'install_banner_dismissed' => false,
        'theme' => 'parchment',
    ];
}

function normalizeUserPreferences(array $preferences): array
{
    $defaults = getDefaultUserPreferences();
    $normalized = $defaults;

    if (isset($preferences['mode']) && in_array($preferences['mode'], ['liste', 'einkaufen'], true)) {
        $normalized['mode'] = $preferences['mode'];
    }

    if (array_key_exists('tabs_hidden', $preferences)) {
        $normalized['tabs_hidden'] = (bool) $preferences['tabs_hidden'];
    }

    if (array_key_exists('category_swipe_enabled', $preferences)) {
        $normalized['category_swipe_enabled'] = (bool) $preferences['category_swipe_enabled'];
    }

    if (array_key_exists('install_banner_dismissed', $preferences)) {
        $normalized['install_banner_dismissed'] = (bool) $preferences['install_banner_dismissed'];
    }

    $lastCategoryId = filter_var($preferences['last_category_id'] ?? null, FILTER_VALIDATE_INT, [
        'options' => ['min_range' => 1],
    ]);
    $normalized['last_category_id'] = is_int($lastCategoryId) ? $lastCategoryId : null;

    $validThemes = ['parchment', 'hafenblau', 'nachtwache', 'pier'];
    if (isset($preferences['theme']) && in_array($preferences['theme'], $validThemes, true)) {
        $normalized['theme'] = $preferences['theme'];
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

function getUserApiKey(PDO $db, int $userId): ?string
{
    $stmt = $db->prepare('SELECT api_key FROM users WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $userId]);
    $row = $stmt->fetch();
    return is_string($row['api_key'] ?? null) && $row['api_key'] !== '' ? $row['api_key'] : null;
}

function setUserApiKey(PDO $db, int $userId): string
{
    $apiKey = bin2hex(random_bytes(32));
    $stmt = $db->prepare('UPDATE users SET api_key = :api_key, api_key_created_at = CURRENT_TIMESTAMP WHERE id = :id');
    $stmt->execute([':api_key' => $apiKey, ':id' => $userId]);
    return $apiKey;
}

function deleteUserApiKey(PDO $db, int $userId): void
{
    $stmt = $db->prepare('UPDATE users SET api_key = NULL, api_key_created_at = NULL WHERE id = :id');
    $stmt->execute([':id' => $userId]);
}

function findUserByApiKey(PDO $db, string $apiKey): ?int
{
    $stmt = $db->prepare('SELECT id FROM users WHERE api_key = :api_key LIMIT 1');
    $stmt->execute([':api_key' => $apiKey]);
    $userId = $stmt->fetchColumn();

    return is_numeric($userId) ? (int) $userId : null;
}

function loadUserCategories(PDO $db, int $userId, bool $includeHidden = true): array
{
    $sql = 'SELECT id, user_id, name, type, icon, legacy_key, sort_order, is_hidden, created_at, updated_at
            FROM categories
            WHERE user_id = :user_id';

    if (!$includeHidden) {
        $sql .= ' AND is_hidden = 0';
    }

    $sql .= ' ORDER BY sort_order ASC, id ASC';

    $stmt = $db->prepare($sql);
    $stmt->execute([':user_id' => $userId]);
    $rows = $stmt->fetchAll();

    return array_map(static function (array $row): array {
        $row['id'] = (int) $row['id'];
        $row['user_id'] = (int) $row['user_id'];
        $row['sort_order'] = (int) $row['sort_order'];
        $row['is_hidden'] = (int) $row['is_hidden'];
        return $row;
    }, $rows);
}

function loadUserCategory(PDO $db, int $userId, int $categoryId): ?array
{
    $stmt = $db->prepare(
        'SELECT id, user_id, name, type, icon, legacy_key, sort_order, is_hidden, created_at, updated_at
         FROM categories
         WHERE id = :id AND user_id = :user_id
         LIMIT 1'
    );
    $stmt->execute([':id' => $categoryId, ':user_id' => $userId]);
    $row = $stmt->fetch();

    if (!is_array($row)) {
        return null;
    }

    $row['id'] = (int) $row['id'];
    $row['user_id'] = (int) $row['user_id'];
    $row['sort_order'] = (int) $row['sort_order'];
    $row['is_hidden'] = (int) $row['is_hidden'];
    return $row;
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

function nextCategorySortOrder(PDO $db, int $userId): int
{
    $stmt = $db->prepare('SELECT COALESCE(MAX(sort_order), 0) FROM categories WHERE user_id = :user_id');
    $stmt->execute([':user_id' => $userId]);
    return (int) $stmt->fetchColumn() + 1;
}

function loadItemCategory(PDO $db, int $userId, int $itemId): ?array
{
    $stmt = $db->prepare(
        'SELECT c.id, c.user_id, c.name, c.type, c.icon, c.legacy_key, c.sort_order, c.is_hidden, c.created_at, c.updated_at
         FROM items i
         INNER JOIN categories c ON c.id = i.category_id
         WHERE i.id = :item_id AND i.user_id = :user_id
         LIMIT 1'
    );
    $stmt->execute([':item_id' => $itemId, ':user_id' => $userId]);
    $row = $stmt->fetch();

    if (!is_array($row)) {
        return null;
    }

    $row['id'] = (int) $row['id'];
    $row['user_id'] = (int) $row['user_id'];
    $row['sort_order'] = (int) $row['sort_order'];
    $row['is_hidden'] = (int) $row['is_hidden'];
    return $row;
}

function findLegacyCategoryId(PDO $db, int $userId, string $legacyKey): ?int
{
    $definition = legacyCategoryDefinition($legacyKey);
    if ($definition === null) {
        return null;
    }

    $stmt = $db->prepare(
        'SELECT c.id,
                c.name = :name AS exact_name_match,
                c.icon = :icon AS exact_icon_match,
                c.sort_order = :sort_order AS sort_order_match,
                COUNT(i.id) AS item_count
         FROM categories c
         LEFT JOIN items i ON i.category_id = c.id
         WHERE c.user_id = :user_id
           AND c.type = :type
           AND (
                c.legacy_key = :legacy_key
                OR c.name = :name
                OR ((c.legacy_key IS NULL OR c.legacy_key = \'\') AND c.sort_order = :sort_order)
                OR ((c.legacy_key IS NULL OR c.legacy_key = \'\') AND c.icon = :icon AND c.name = :name)
           )
         GROUP BY c.id, c.name, c.sort_order, c.legacy_key
         ORDER BY
            item_count DESC,
            CASE WHEN c.legacy_key = :legacy_key THEN 0 ELSE 1 END,
            exact_name_match DESC,
            exact_icon_match DESC,
            sort_order_match DESC,
            c.sort_order ASC,
            c.id ASC
         LIMIT 1'
    );
    $stmt->execute([
        ':user_id' => $userId,
        ':legacy_key' => $legacyKey,
        ':name' => $definition['name'],
        ':icon' => $definition['icon'],
        ':type' => $definition['type'],
        ':sort_order' => $definition['sort_order'],
    ]);
    $categoryId = $stmt->fetchColumn();

    return $categoryId === false ? null : (int) $categoryId;
}

function backfillLegacyCategoryKeys(PDO $db): void
{
    $users = $db->query('SELECT id FROM users')->fetchAll(PDO::FETCH_COLUMN);
    $updateStmt = $db->prepare(
        'UPDATE categories
         SET legacy_key = :legacy_key, icon = :icon, updated_at = CURRENT_TIMESTAMP
         WHERE id = :id'
    );

    foreach ($users as $userId) {
        foreach (LEGACY_CATEGORY_DEFINITIONS as $legacyKey => $definition) {
            $categoryId = findLegacyCategoryId($db, (int) $userId, $legacyKey);
            if ($categoryId === null) {
                continue;
            }

            $updateStmt->execute([
                ':id' => $categoryId,
                ':legacy_key' => $legacyKey,
                ':icon' => $definition['icon'],
            ]);
        }
    }
}

function ensureDefaultCategories(PDO $db): void
{
    $users = $db->query('SELECT id FROM users')->fetchAll(PDO::FETCH_COLUMN);
    if (empty($users)) {
        return;
    }

    $userChunks = array_chunk($users, 100);
    foreach ($userChunks as $userChunk) {
        $userIds = array_map('intval', $userChunk);
        $placeholders = implode(',', array_fill(0, count($userIds), '?'));

        $existingCategories = [];
        $stmt = $db->prepare("SELECT user_id, name, type, icon, legacy_key, sort_order FROM categories WHERE user_id IN ($placeholders)");
        $stmt->execute($userIds);
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $existingCategories[(int) $row['user_id']][] = $row;
        }

        $toInsert = [];
        foreach ($userIds as $userId) {
            $userCategories = $existingCategories[$userId] ?? [];

            foreach (LEGACY_CATEGORY_DEFINITIONS as $legacyKey => $definition) {
                if (findLegacyCategoryIdInMemory($userCategories, $legacyKey, $definition) !== null) {
                    continue;
                }

                $toInsert[] = [
                    'user_id' => $userId,
                    'name' => $definition['name'],
                    'type' => $definition['type'],
                    'icon' => $definition['icon'],
                    'legacy_key' => $legacyKey,
                    'sort_order' => $definition['sort_order'],
                    'is_hidden' => 0,
                ];
            }
        }

        if (!empty($toInsert)) {
            $insertChunks = array_chunk($toInsert, 100);
            foreach ($insertChunks as $chunk) {
                $rowPlaceholders = [];
                $values = [];
                foreach ($chunk as $row) {
                    $rowPlaceholders[] = '(?, ?, ?, ?, ?, ?, ?)';
                    $values[] = $row['user_id'];
                    $values[] = $row['name'];
                    $values[] = $row['type'];
                    $values[] = $row['icon'];
                    $values[] = $row['legacy_key'];
                    $values[] = $row['sort_order'];
                    $values[] = $row['is_hidden'];
                }

                $sql = 'INSERT INTO categories (user_id, name, type, icon, legacy_key, sort_order, is_hidden) VALUES ' . implode(', ', $rowPlaceholders);
                $db->prepare($sql)->execute($values);
            }
        }
    }
}

/**
 * @param array<int, array<string, mixed>> $userCategories
 * @param array<string, mixed> $definition
 */
function findLegacyCategoryIdInMemory(array $userCategories, string $legacyKey, array $definition): ?int
{
    foreach ($userCategories as $cat) {
        if ($cat['type'] !== $definition['type']) {
            continue;
        }

        $legacyKeyMatch = ($cat['legacy_key'] === $legacyKey);
        $nameMatch = ($cat['name'] === $definition['name']);
        $noLegacyKey = ($cat['legacy_key'] === null || $cat['legacy_key'] === '');
        $sortOrderMatch = ($noLegacyKey && (int) $cat['sort_order'] === $definition['sort_order']);
        $iconNameMatch = ($noLegacyKey && $cat['icon'] === $definition['icon'] && $cat['name'] === $definition['name']);

        if ($legacyKeyMatch || $nameMatch || $sortOrderMatch || $iconNameMatch) {
            return 1; // ID doesn't matter here, only that it's found
        }
    }

    return null;
}

function migrateLegacyCategories(PDO $db): void
{
    $updateStmt = $db->prepare(
        'UPDATE items
         SET category_id = :category_id
         WHERE user_id = :user_id AND section = :section AND category_id IS NULL'
    );

    $users = $db->query('SELECT id FROM users')->fetchAll(PDO::FETCH_COLUMN);

    foreach ($users as $userId) {
        foreach (LEGACY_CATEGORY_DEFINITIONS as $legacyKey => $definition) {
            $categoryId = findLegacyCategoryId($db, (int) $userId, $legacyKey);
            if ($categoryId === null) {
                continue;
            }

            $updateStmt->execute([
                ':category_id' => (int) $categoryId,
                ':user_id' => (int) $userId,
                ':section' => $legacyKey,
            ]);
        }
    }
}

function migrateLegacyPreferencesToCategories(PDO $db): void
{
    $fallbackThemeNormalizer = static function (array $preferences): array {
        $base = normalizeUserPreferences($preferences);

        $normalized = [
            'mode' => $base['mode'] ?? 'liste',
            'tabs_hidden' => (bool) ($base['tabs_hidden'] ?? false),
            'category_swipe_enabled' => (bool) ($base['category_swipe_enabled'] ?? true),
            'last_category_id' => $base['last_category_id'] ?? null,
            'install_banner_dismissed' => (bool) ($base['install_banner_dismissed'] ?? false),
            'theme_mode' => 'auto',
            'light_theme' => 'hafenblau',
            'dark_theme' => 'nachtwache',
        ];

        if (isset($preferences['theme_mode']) && in_array($preferences['theme_mode'], ['light', 'dark', 'auto'], true)) {
            $normalized['theme_mode'] = $preferences['theme_mode'];
        }

        if (isset($preferences['light_theme']) && in_array($preferences['light_theme'], ['parchment', 'hafenblau'], true)) {
            $normalized['light_theme'] = $preferences['light_theme'];
        }

        if (isset($preferences['dark_theme']) && in_array($preferences['dark_theme'], ['nachtwache', 'pier'], true)) {
            $normalized['dark_theme'] = $preferences['dark_theme'];
        }

        return $normalized;
    };

    $users = $db->query('SELECT id, preferences_json FROM users')->fetchAll();
    $updateCategoryStmt = $db->prepare(
        'UPDATE categories
         SET sort_order = :sort_order, is_hidden = :is_hidden, icon = :icon, legacy_key = :legacy_key, updated_at = CURRENT_TIMESTAMP
         WHERE id = :id'
    );
    $updateUserStmt = $db->prepare('UPDATE users SET preferences_json = :preferences_json WHERE id = :id');

    foreach ($users as $user) {
        $userId = (int) $user['id'];
        $decoded = json_decode((string) ($user['preferences_json'] ?? '{}'), true);
        if (!is_array($decoded)) {
            $decoded = [];
        }

        $hasLegacyCategoryPreferences = array_key_exists('tabs_order', $decoded)
            || array_key_exists('hidden_sections', $decoded)
            || array_key_exists('section', $decoded);

        if ($hasLegacyCategoryPreferences) {
            $tabsOrder = [];
            if (is_array($decoded['tabs_order'] ?? null)) {
                foreach ($decoded['tabs_order'] as $legacyKey) {
                    if (is_string($legacyKey) && isset(LEGACY_CATEGORY_DEFINITIONS[$legacyKey]) && !in_array($legacyKey, $tabsOrder, true)) {
                        $tabsOrder[] = $legacyKey;
                    }
                }
            }

            foreach (array_keys(LEGACY_CATEGORY_DEFINITIONS) as $legacyKey) {
                if (!in_array($legacyKey, $tabsOrder, true)) {
                    $tabsOrder[] = $legacyKey;
                }
            }

            $hiddenSections = [];
            if (is_array($decoded['hidden_sections'] ?? null)) {
                foreach ($decoded['hidden_sections'] as $legacyKey) {
                    if (is_string($legacyKey) && isset(LEGACY_CATEGORY_DEFINITIONS[$legacyKey]) && !in_array($legacyKey, $hiddenSections, true)) {
                        $hiddenSections[] = $legacyKey;
                    }
                }
            }

            foreach ($tabsOrder as $index => $legacyKey) {
                $definition = LEGACY_CATEGORY_DEFINITIONS[$legacyKey];
                $categoryId = findLegacyCategoryId($db, $userId, $legacyKey);
                if ($categoryId === null) {
                    continue;
                }

                $updateCategoryStmt->execute([
                    ':id' => $categoryId,
                    ':sort_order' => $index + 1,
                    ':is_hidden' => in_array($legacyKey, $hiddenSections, true) ? 1 : 0,
                    ':icon' => $definition['icon'],
                    ':legacy_key' => $legacyKey,
                ]);
            }
        }

        $lastCategoryId = null;
        $preferredSection = $decoded['section'] ?? null;
        if (is_string($preferredSection) && isset(LEGACY_CATEGORY_DEFINITIONS[$preferredSection])) {
            $lastCategoryId = findLegacyCategoryId($db, $userId, $preferredSection);
        }

        $normalizer = function_exists('normalizeExtendedUserPreferences')
            ? 'normalizeExtendedUserPreferences'
            : $fallbackThemeNormalizer;

        $normalizedPreferences = $normalizer([
            ...$decoded,
            'last_category_id' => $decoded['last_category_id'] ?? $lastCategoryId,
        ]);

        $updateUserStmt->execute([
            ':id' => $userId,
            ':preferences_json' => json_encode($normalizedPreferences, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);
    }
}

function cleanupDuplicateLegacyCategories(PDO $db): void
{
    $users = $db->query('SELECT id FROM users')->fetchAll(PDO::FETCH_COLUMN);
    $deleteStmt = $db->prepare('DELETE FROM categories WHERE id = :id');

    foreach ($users as $userId) {
        foreach (LEGACY_CATEGORY_DEFINITIONS as $legacyKey => $definition) {
            $stmt = $db->prepare(
                'SELECT c.id, c.name, c.icon, c.legacy_key, c.sort_order, COUNT(i.id) AS item_count
                 FROM categories c
                 LEFT JOIN items i ON i.category_id = c.id
                 WHERE c.user_id = :user_id
                   AND c.type = :type
                   AND (
                        c.legacy_key = :legacy_key
                        OR c.name = :name
                        OR ((c.legacy_key IS NULL OR c.legacy_key = \'\') AND c.sort_order = :sort_order)
                        OR ((c.legacy_key IS NULL OR c.legacy_key = \'\') AND c.icon = :icon AND c.name = :name)
                   )
                 GROUP BY c.id, c.name, c.icon, c.legacy_key, c.sort_order
                 ORDER BY item_count DESC, CASE WHEN c.legacy_key = :legacy_key THEN 0 ELSE 1 END, c.sort_order ASC, c.id ASC'
            );
            $stmt->execute([
                ':user_id' => (int) $userId,
                ':type' => $definition['type'],
                ':legacy_key' => $legacyKey,
                ':name' => $definition['name'],
                ':sort_order' => $definition['sort_order'],
                ':icon' => $definition['icon'],
            ]);
            $rows = $stmt->fetchAll();

            $keeperId = null;
            foreach ($rows as $row) {
                if ((string) ($row['legacy_key'] ?? '') === $legacyKey) {
                    $keeperId = (int) $row['id'];
                    break;
                }
            }

            if ($keeperId === null) {
                continue;
            }

            foreach ($rows as $row) {
                $id = (int) $row['id'];
                if ($id === $keeperId) {
                    continue;
                }

                $legacyKeyValue = (string) ($row['legacy_key'] ?? '');
                $nameValue = (string) ($row['name'] ?? '');
                $iconValue = (string) ($row['icon'] ?? '');
                $looksLikeDefaultDuplicate =
                    $legacyKeyValue === $legacyKey
                    || (
                        $legacyKeyValue === ''
                        && (
                            $nameValue === $definition['name']
                            || (int) ($row['sort_order'] ?? 0) === (int) $definition['sort_order']
                            || ($nameValue === $definition['name'] && $iconValue === $definition['icon'])
                        )
                    );

                if ((int) ($row['item_count'] ?? 0) === 0 && $looksLikeDefaultDuplicate) {
                    $deleteStmt->execute([':id' => $id]);
                }
            }
        }
    }
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
        $needsRebuild = false;

        if (in_array('category_id', $columnNames, true)) {
            $categoryIds = $db->query('SELECT DISTINCT category_id FROM items WHERE category_id IS NOT NULL')->fetchAll(PDO::FETCH_COLUMN);
            foreach ($categoryIds as $categoryId) {
                if (hasInvalidSortOrder($db, 'category_id = :category_id', [':category_id' => (int) $categoryId])) {
                    $needsRebuild = true;
                    break;
                }
            }

            if (!$needsRebuild && in_array('section', $columnNames, true)) {
                $orphanSections = $db->query('SELECT DISTINCT section FROM items WHERE category_id IS NULL')->fetchAll(PDO::FETCH_COLUMN);
                foreach ($orphanSections as $section) {
                    if (hasInvalidSortOrder($db, 'section = :section AND category_id IS NULL', [':section' => (string) $section])) {
                        $needsRebuild = true;
                        break;
                    }
                }
            }
        } elseif (in_array('section', $columnNames, true)) {
            $sections = $db->query('SELECT DISTINCT section FROM items')->fetchAll(PDO::FETCH_COLUMN);
            foreach ($sections as $section) {
                if (hasInvalidSortOrder($db, 'section = :section', [':section' => (string) $section])) {
                    $needsRebuild = true;
                    break;
                }
            }
        } elseif (hasInvalidSortOrder($db)) {
            $needsRebuild = true;
        }

        if ($needsRebuild) {
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
    $db->exec('CREATE INDEX IF NOT EXISTS idx_items_category_id ON items(category_id)');
    $db->exec(
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
    $productCatalogColumns = $db->query('PRAGMA table_info(product_catalog)')->fetchAll();
    $productCatalogColumnNames = array_map(static fn(array $column): string => $column['name'], $productCatalogColumns);
    if (!in_array('source', $productCatalogColumnNames, true)) {
        $db->exec("ALTER TABLE product_catalog ADD COLUMN source TEXT NOT NULL DEFAULT ''");
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

    ensureDefaultCategories($db);
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

    $orphanSortOrderMigrationKey = 'orphan_sort_order_rebuilt_v1';
    if (!hasDatabaseMetaFlag($db, $orphanSortOrderMigrationKey)) {
        $orphanItems = (int) $db->query('SELECT COUNT(*) FROM items WHERE user_id IS NOT NULL AND category_id IS NULL')->fetchColumn();
        if ($orphanItems > 0) {
            rebuildSortOrder($db);
        }
        setDatabaseMetaFlag($db, $orphanSortOrderMigrationKey);
    }

    return $db;
}
