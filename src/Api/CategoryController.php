<?php
declare(strict_types=1);

function handleCategoryApiAction(PDO $db, int $userId, string $action): never
{
    switch ($action) {
        case 'categories_list':
            requireMethod('GET');
            ensureDailyNotesCategory($db, $userId);
            respond(200, [
                'categories' => loadUserCategories($db, $userId),
                'preferences' => getExtendedUserPreferences($db, $userId),
            ]);

        case 'categories_create':
            $data = requireWriteRequest();

            $name = normalizeName($data['name'] ?? null);
            $type = trim((string) ($data['type'] ?? ''));

            if ($name === '') {
                respond(422, ['error' => t('error.category_name_required'), 'error_key' => 'error.category_name_required']);
            }

            if (!in_array($type, CATEGORY_TYPES, true)) {
                respond(422, ['error' => t('error.invalid_category_type'), 'error_key' => 'error.invalid_category_type']);
            }
            if ($type === 'daily_notes') {
                respond(422, ['error' => t('error.system_category'), 'error_key' => 'error.system_category']);
            }

            $icon = normalizeCategoryIcon($data['icon'] ?? null, $type);

            $categoryId = insertCategory(
                $db,
                $userId,
                $name,
                $type,
                $icon,
                nextCategorySortOrder($db, $userId)
            );
            updateExtendedUserPreferences($db, $userId, ['last_category_id' => $categoryId]);

            respond(201, [
                'message' => 'Kategorie erstellt.',
                'category' => loadUserCategory($db, $userId, $categoryId),
            ]);

        case 'categories_update':
            $data = requireWriteRequest();

            $categoryId = filter_var($data['category_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if (!is_int($categoryId)) {
                respond(422, ['error' => t('error.invalid_category'), 'error_key' => 'error.invalid_category']);
            }

            $category = loadUserCategory($db, $userId, $categoryId);
            if ($category === null) {
                respond(404, ['error' => t('error.category_not_found'), 'error_key' => 'error.category_not_found']);
            }
            if ((string) $category['type'] === 'daily_notes') {
                respond(422, ['error' => t('error.system_category'), 'error_key' => 'error.system_category']);
            }

            $patches = [];
            $params = [':id' => $categoryId, ':user_id' => $userId];

            if (array_key_exists('name', $data)) {
                $name = normalizeName($data['name'] ?? null);
                if ($name === '') {
                    respond(422, ['error' => t('error.category_name_required'), 'error_key' => 'error.category_name_required']);
                }
                $patches[] = 'name = :name';
                $params[':name'] = $name;
            }

            if (array_key_exists('icon', $data)) {
                $patches[] = 'icon = :icon';
                $params[':icon'] = normalizeCategoryIcon((string) $data['icon'], (string) $category['type']);
            }

            if (array_key_exists('is_hidden', $data)) {
                $patches[] = 'is_hidden = :is_hidden';
                $params[':is_hidden'] = filter_var($data['is_hidden'], FILTER_VALIDATE_BOOL) ? 1 : 0;
            }

            if ($patches === []) {
                respond(422, ['error' => t('error.no_changes'), 'error_key' => 'error.no_changes']);
            }

            updateCategoryFields($db, $userId, $categoryId, $patches, $params);

            respond(200, [
                'message' => 'Kategorie aktualisiert.',
                'category' => loadUserCategory($db, $userId, $categoryId),
            ]);

        case 'categories_reorder':
            $data = requireWriteRequest();

            $ids = normalizeIdList($data['ids'] ?? ($data['ids[]'] ?? null));
            if ($ids === []) {
                respond(422, ['error' => t('error.invalid_order'), 'error_key' => 'error.invalid_order']);
            }

            $stmt = $db->prepare('SELECT id FROM categories WHERE user_id = :user_id ORDER BY sort_order ASC, id ASC');
            $stmt->execute([':user_id' => $userId]);
            $existingIds = array_map(static fn(mixed $id): int => (int) $id, $stmt->fetchAll(PDO::FETCH_COLUMN));

            $sortedIds = $ids;
            sort($sortedIds);
            $sortedExisting = $existingIds;
            sort($sortedExisting);

            if ($sortedIds !== $sortedExisting) {
                respond(422, ['error' => t('error.order_mismatch_categories'), 'error_key' => 'error.order_mismatch_categories']);
            }

            reorderUserCategories($db, $userId, $ids);

            respond(200, ['message' => 'Kategorien neu sortiert.']);

        case 'categories_delete':
            $data = requireWriteRequest();

            $category = requireCategory($data, $db, $userId);
            if ((string) $category['type'] === 'daily_notes') {
                respond(422, ['error' => t('error.system_category'), 'error_key' => 'error.system_category']);
            }

            if (countItemsInCategory($db, $userId, (int) $category['id']) > 0) {
                respond(422, ['error' => t('error.category_not_empty'), 'error_key' => 'error.category_not_empty']);
            }

            deleteUserCategory($db, $userId, (int) $category['id']);

            $preferences = getExtendedUserPreferences($db, $userId);
            if ((int) ($preferences['last_category_id'] ?? 0) === (int) $category['id']) {
                $fallback = loadUserCategories($db, $userId, false)[0]['id'] ?? null;
                updateExtendedUserPreferences($db, $userId, ['last_category_id' => $fallback]);
            }

            respond(200, ['message' => 'Kategorie gelöscht.']);
    }
    throw new LogicException('Unsupported category API action.');
}
