<?php
declare(strict_types=1);

function findCategoryById(array $categories, int $id): ?array
{
    foreach ($categories as $category) {
        if ((int) $category['id'] === $id) {
            return $category;
        }
    }
    return null;
}

function handleQuickAdd(PDO $db, int $userId, array $data): never
{
    $activeCategoryId = filter_var($data['active_category_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!is_int($activeCategoryId)) {
        respond(422, ['error' => t('error.invalid_category'), 'error_key' => 'error.invalid_category']);
    }

    $categories = loadUserCategories($db, $userId);
    $activeCategory = findCategoryById($categories, $activeCategoryId);
    if ($activeCategory === null) {
        respond(404, ['error' => t('error.category_not_found'), 'error_key' => 'error.category_not_found']);
    }

    $rawDefaultDueDate = $data['default_due_date'] ?? '';
    $defaultDueDate = is_string($rawDefaultDueDate) ? trim($rawDefaultDueDate) : '';
    $parsedDefaultDueDate = $defaultDueDate === ''
        ? false
        : DateTimeImmutable::createFromFormat('!Y-m-d', $defaultDueDate, new DateTimeZone('Europe/Berlin'));
    $defaultDueDateErrors = $parsedDefaultDueDate === false ? false : DateTimeImmutable::getLastErrors();
    if (
        !is_string($rawDefaultDueDate)
        || ($defaultDueDate !== '' && (
            $parsedDefaultDueDate === false
            || ($defaultDueDateErrors !== false && ($defaultDueDateErrors['warning_count'] > 0 || $defaultDueDateErrors['error_count'] > 0))
            || $parsedDefaultDueDate->format('Y-m-d') !== $defaultDueDate
        ))
    ) {
        respond(422, [
            'error' => t('quick_add.invalid_default_due_date'),
            'error_key' => 'quick_add.invalid_default_due_date',
            'can_escalate_to_ai' => false,
        ]);
    }
    $parsed = parseQuickAdd(
        (string) ($data['input'] ?? ''),
        $activeCategoryId,
        $categories,
        date('Y-m-d'),
        $defaultDueDate
    );
    if (($parsed['ok'] ?? false) !== true) {
        respond(422, $parsed);
    }

    $targetCategory = findCategoryById($categories, (int) $parsed['category_id']);
    if ($targetCategory === null) {
        respond(404, ['error' => t('error.category_not_found'), 'error_key' => 'error.category_not_found']);
    }
    validateCategoryType(
        $targetCategory,
        ['list_quantity', 'list_due_date'],
        t('quick_add.invalid_category_type'),
        'quick_add.invalid_category_type'
    );

    $name = normalizeName($parsed['name'] ?? null);
    if ($name === '') {
        respond(422, ['error' => t('error.item_name_required'), 'error_key' => 'error.item_name_required']);
    }
    $dueDate = (string) $parsed['due_date'];
    $dueTime = (string) $parsed['due_time'];
    if ((string) $targetCategory['type'] !== 'list_due_date') {
        $dueDate = '';
        $dueTime = '';
    }

    $db->beginTransaction();
    try {
        $sortOrder = prependItemSortOrder($db, $userId, (int) $targetCategory['id']);
        $stmt = $db->prepare(
            'INSERT INTO items
                (name, quantity, due_date, due_time, priority, content, section, category_id, sort_order, user_id)
             VALUES
                (:name, :quantity, :due_date, :due_time, :priority, :content, :section, :category_id, :sort_order, :user_id)'
        );
        $stmt->execute([
            ':name' => $name,
            ':quantity' => '',
            ':due_date' => $dueDate,
            ':due_time' => $dueTime,
            ':priority' => (string) $parsed['priority'],
            ':content' => '',
            ':section' => '',
            ':category_id' => (int) $targetCategory['id'],
            ':sort_order' => $sortOrder,
            ':user_id' => $userId,
        ]);
        $itemId = (int) $db->lastInsertId();
        $db->commit();
    } catch (Throwable $exception) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $exception;
    }

    respond(201, [
        'message' => 'Eintrag hinzugefügt.',
        'id' => $itemId,
        'category_id' => (int) $targetCategory['id'],
        'revision' => 1,
        'parsed' => $parsed,
    ]);
}
