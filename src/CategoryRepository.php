<?php
declare(strict_types=1);

require_once __DIR__ . '/Constants.php';

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
        'list_quantity' => 'einkauf',
        'list_due_date' => 'erledigt',
        'notes' => 'notizen',
        'images' => 'bilder',
        'files' => 'dateien',
        'links' => 'links',
        default => 'stern',
    };
}

function normalizeCategoryIcon(?string $value, ?string $fallbackType = null): string
{
    $value = trim((string) $value);
    $value = preg_replace('/\s+/u', ' ', $value) ?? '';

    if ($value === '') {
        return $fallbackType !== null ? defaultCategoryIcon($fallbackType) : 'stern';
    }

    if (isset(LEGACY_CATEGORY_ICON_MAP[$value])) {
        return LEGACY_CATEGORY_ICON_MAP[$value];
    }

    if (in_array($value, CATEGORY_ICON_OPTIONS, true)) {
        return $value;
    }

    return $fallbackType !== null ? defaultCategoryIcon($fallbackType) : 'stern';
}

function getCategoryIconOptions(): array
{
    return CATEGORY_ICON_OPTIONS;
}

function categoryIconLabel(string $icon): string
{
    return CATEGORY_ICON_LABELS[$icon] ?? ucfirst(str_replace(['-', '_'], ' ', $icon));
}

function migrateCategoryIconsToAssetKeys(PDO $db): void
{
    $stmt = $db->prepare('UPDATE categories SET icon = :icon, updated_at = CURRENT_TIMESTAMP WHERE id = :id');
    $categoryRows = $db->query('SELECT id, type, icon FROM categories')->fetchAll();

    foreach ($categoryRows as $categoryRow) {
        $currentIcon = (string) ($categoryRow['icon'] ?? '');
        $icon = normalizeCategoryIcon($currentIcon, (string) ($categoryRow['type'] ?? ''));
        if ($icon === $currentIcon) {
            continue;
        }

        $stmt->execute([
            ':id' => (int) $categoryRow['id'],
            ':icon' => $icon,
        ]);
    }
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

function createDefaultCategoriesForUser(PDO $db, int $userId): void
{
    $stmt = $db->prepare(
        'INSERT INTO categories (user_id, name, type, icon, legacy_key, sort_order, is_hidden)
         VALUES (:user_id, :name, :type, :icon, :legacy_key, :sort_order, :is_hidden)'
    );

    foreach (LEGACY_CATEGORY_DEFINITIONS as $legacyKey => $definition) {
        $stmt->execute([
            ':user_id' => $userId,
            ':name' => $definition['name'],
            ':type' => $definition['type'],
            ':icon' => $definition['icon'],
            ':legacy_key' => $legacyKey,
            ':sort_order' => $definition['sort_order'],
            ':is_hidden' => 0,
        ]);
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
        $lightThemes = ['parchment', 'hafenblau'];
        $darkThemes = ['nachtwache', 'pier'];

        $themeDefinitionsPath = __DIR__ . '/public/theme-definitions.php';
        if (is_file($themeDefinitionsPath)) {
            require_once $themeDefinitionsPath;
            if (function_exists('getAvailableThemes')) {
                $themes = getAvailableThemes();
                $lightThemes = array_keys($themes['light'] ?? []) ?: $lightThemes;
                $darkThemes = array_keys($themes['dark'] ?? []) ?: $darkThemes;
            }
        }

        $normalized = [
            'mode' => $base['mode'] ?? 'liste',
            'tabs_hidden' => (bool) ($base['tabs_hidden'] ?? false),
            'category_swipe_enabled' => (bool) ($base['category_swipe_enabled'] ?? true),
            'product_scanner_enabled' => (bool) ($base['product_scanner_enabled'] ?? true),
            'shopping_list_scanner_enabled' => (bool) ($base['shopping_list_scanner_enabled'] ?? true),
            'magic_button_enabled' => (bool) ($base['magic_button_enabled'] ?? true),
            'last_category_id' => $base['last_category_id'] ?? null,
            'install_banner_dismissed' => (bool) ($base['install_banner_dismissed'] ?? false),
            'theme_mode' => 'auto',
            'light_theme' => 'hafenblau',
            'dark_theme' => 'nachtwache',
        ];

        if (isset($preferences['theme_mode']) && in_array($preferences['theme_mode'], ['light', 'dark', 'auto'], true)) {
            $normalized['theme_mode'] = $preferences['theme_mode'];
        }

        if (isset($preferences['light_theme']) && in_array($preferences['light_theme'], $lightThemes, true)) {
            $normalized['light_theme'] = $preferences['light_theme'];
        }

        if (isset($preferences['dark_theme']) && in_array($preferences['dark_theme'], $darkThemes, true)) {
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
