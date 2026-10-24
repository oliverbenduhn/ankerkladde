<?php
declare(strict_types=1);

function normalizeName(?string $name): string
{
    $name = trim((string) $name);
    $name = preg_replace('/\s+/u', ' ', $name) ?? '';
    return truncateText($name, 120);
}

function normalizeQuantity(?string $quantity): string
{
    $quantity = trim((string) $quantity);
    $quantity = preg_replace('/\s+/u', ' ', $quantity) ?? '';
    return truncateText($quantity, 40);
}

function normalizeIdList(mixed $ids): array
{
    if (!is_array($ids) || $ids === []) {
        return [];
    }

    $normalized = [];

    foreach ($ids as $rawId) {
        $id = filter_var($rawId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        if ($id === false || $id === null) {
            return [];
        }

        $normalized[] = (int) $id;
    }

    if (count(array_unique($normalized)) !== count($normalized)) {
        return [];
    }

    return $normalized;
}

/**
 * @return list<array{id: int, expected_revision: int}>
 */
function normalizeRevisionItemList(mixed $items): array
{
    if (is_string($items)) {
        $items = json_decode($items, true);
    }
    if (!is_array($items) || $items === []) {
        return [];
    }

    $normalized = [];
    foreach ($items as $item) {
        if (!is_array($item)) {
            return [];
        }
        $id = filter_var($item['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $revision = filter_var(
            $item['expected_revision'] ?? null,
            FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 1]]
        );
        if (!is_int($id) || !is_int($revision)) {
            return [];
        }
        $normalized[] = ['id' => $id, 'expected_revision' => $revision];
    }

    $ids = array_column($normalized, 'id');
    if (count(array_unique($ids)) !== count($ids)) {
        return [];
    }

    return $normalized;
}

function sanitizeFtsQuery(string $q): string
{
    $q = truncateText($q, 256);
    $q = trim($q);
    if ($q === '') {
        return '';
    }

    $words = array_values(array_filter(preg_split('/\s+/u', $q) ?: []));
    if ($words === []) {
        return '';
    }

    $words = array_slice($words, 0, 8);

    $parts = array_map(
        static fn(string $w): string => '"' . str_replace('"', '""', truncateText($w, 32)) . '"*',
        $words
    );

    return implode(' ', $parts);
}

function resolveCategoryId(array $data, PDO $db, int $userId): int
{
    $categoryId = filter_var($_GET['category_id'] ?? ($data['category_id'] ?? null), FILTER_VALIDATE_INT, [
        'options' => ['min_range' => 1],
    ]);

    if (is_int($categoryId)) {
        return $categoryId;
    }

    $legacySection = $_GET['section'] ?? ($data['section'] ?? null);
    if (!is_string($legacySection) || trim($legacySection) === '') {
        $preferences = getExtendedUserPreferences($db, $userId);
        $preferredCategoryId = filter_var($preferences['last_category_id'] ?? null, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1],
        ]);

        if (is_int($preferredCategoryId) && loadUserCategory($db, $userId, $preferredCategoryId) !== null) {
            return $preferredCategoryId;
        }

        $categories = loadUserCategories($db, $userId, false);
        if ($categories !== []) {
            return (int) $categories[0]['id'];
        }

        respond(404, ['error' => t('error.category_not_found'), 'error_key' => 'error.category_not_found']);
    }

    $definition = legacyCategoryDefinition(trim($legacySection));
    if ($definition === null) {
        respond(422, ['error' => t('error.invalid_category'), 'error_key' => 'error.invalid_category']);
    }

    $stmt = $db->prepare(
        'SELECT id FROM categories
         WHERE user_id = :user_id AND legacy_key = :legacy_key
         ORDER BY id ASC
         LIMIT 1'
    );
    $stmt->execute([
        ':user_id' => $userId,
        ':legacy_key' => trim($legacySection),
    ]);
    $categoryId = $stmt->fetchColumn();

    if ($categoryId === false) {
        respond(404, ['error' => t('error.category_not_found'), 'error_key' => 'error.category_not_found']);
    }

    return (int) $categoryId;
}

function requireCategory(array $data, PDO $db, int $userId): array
{
    $categoryId = resolveCategoryId($data, $db, $userId);
    $category = loadUserCategory($db, $userId, $categoryId);

    if ($category === null) {
        respond(404, ['error' => t('error.category_not_found'), 'error_key' => 'error.category_not_found']);
    }

    return $category;
}

function validateCategoryType(array $category, array $allowedTypes, string $message, string $errorKey = 'error.invalid_category'): void
{
    if (!in_array((string) $category['type'], $allowedTypes, true)) {
        respond(422, ['error' => $message, 'error_key' => $errorKey]);
    }
}

function buildAttachmentPayload(array $item): ?array
{
    $section = (string) ($item['attachment_storage_section'] ?? '');
    $hasAttachment = (int) ($item['has_attachment'] ?? 0) === 1;

    if (!$hasAttachment || !isAttachmentCategoryType($section)) {
        return null;
    }

    $baseUrl = requestPath('media.php?item_id=' . (int) $item['id']);
    $versionSource = '';

    if ($section === 'images' && !empty($item['attachment_stored_name'])) {
        $thumbnailPath = getAttachmentThumbnailAbsolutePath([
            'storage_section' => $section,
            'stored_name' => (string) $item['attachment_stored_name'],
        ]);
        $thumbnailMtime = is_file($thumbnailPath) ? @filemtime($thumbnailPath) : false;
        if (is_int($thumbnailMtime) && $thumbnailMtime > 0) {
            $versionSource = 'thumb-' . $thumbnailMtime;
        }
    }

    if ($versionSource === '') {
        $versionSource = (string) ($item['attachment_updated_at'] ?? '');
    }
    if ($versionSource === '') {
        $versionSource = (string) ($item['attachment_stored_name'] ?? '');
    }
    $versionQuery = $versionSource !== '' ? '&v=' . rawurlencode($versionSource) : '';

    return [
        'preview_url' => $section === 'images' ? $baseUrl . '&variant=thumb' . $versionQuery : null,
        'original_url' => $section === 'images' ? $baseUrl : $baseUrl . '&download=1' . $versionQuery,
        'download_url' => $baseUrl . '&download=1' . $versionQuery,
        'original_name' => (string) ($item['attachment_original_name'] ?? ''),
        'mime_type' => (string) ($item['attachment_media_type'] ?? 'application/octet-stream'),
        'size_bytes' => (int) ($item['attachment_size_bytes'] ?? 0),
    ];
}

function formatListItem(array $item): array
{
    $attachment = buildAttachmentPayload($item);

    return [
        'id' => (int) $item['id'],
        'category_id' => (int) ($item['category_id'] ?? 0),
        'category_name' => (string) ($item['category_name'] ?? ''),
        'category_type' => (string) ($item['category_type'] ?? ''),
        'name' => (string) ($item['name'] ?? ''),
        'barcode' => (string) ($item['barcode'] ?? ''),
        'quantity' => (string) ($item['quantity'] ?? ''),
        'due_date' => (string) ($item['due_date'] ?? ''),
        'due_time' => (string) ($item['due_time'] ?? ''),
        'priority' => (string) ($item['priority'] ?? ''),
        'is_pinned' => (int) ($item['is_pinned'] ?? 0),
        'status' => (string) ($item['status'] ?? ''),
        'content' => (string) ($item['content'] ?? ''),
        'done' => (int) ($item['done'] ?? 0),
        'sort_order' => (int) ($item['sort_order'] ?? 0),
        'created_at' => (string) ($item['created_at'] ?? ''),
        'updated_at' => (string) ($item['updated_at'] ?? ''),
        'revision' => (int) ($item['revision'] ?? 1),
        'has_attachment' => $attachment !== null ? 1 : 0,
        'has_sketch' => isset($item['has_sketch']) ? (int) $item['has_sketch'] : (((string) ($item['sketch_json'] ?? '') !== '') ? 1 : 0),
        'attachment' => $attachment,
        'attachment_storage_section' => $attachment !== null ? (string) ($item['attachment_storage_section'] ?? '') : null,
        'attachment_original_name' => $attachment['original_name'] ?? null,
        'attachment_media_type' => $attachment['mime_type'] ?? null,
        'attachment_size_bytes' => $attachment['size_bytes'] ?? null,
        'attachment_url' => $attachment['preview_url'] ?? $attachment['download_url'] ?? null,
        'attachment_preview_url' => $attachment['preview_url'] ?? null,
        'attachment_original_url' => $attachment['original_url'] ?? null,
        'attachment_download_url' => $attachment['download_url'] ?? null,
    ];
}

function normalizeJournalDate(mixed $value): string
{
    $date = trim((string) $value);
    $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date, new DateTimeZone('Europe/Berlin'));
    $errors = DateTimeImmutable::getLastErrors();
    if ($parsed === false || ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0)) || $parsed->format('Y-m-d') !== $date) {
        respond(422, ['error' => t('error.invalid_journal_date'), 'error_key' => 'error.invalid_journal_date']);
    }

    return $date;
}

function formatJournalItem(?array $item): ?array
{
    if ($item === null) {
        return null;
    }

    return [
        'id' => (int) $item['id'],
        'category_id' => (int) $item['category_id'],
        'name' => (string) $item['name'],
        'content' => (string) $item['content'],
        'due_date' => (string) $item['due_date'],
        'has_sketch' => ((string) ($item['sketch_json'] ?? '') !== '') ? 1 : 0,
        'created_at' => (string) $item['created_at'],
        'updated_at' => (string) $item['updated_at'],
        'revision' => (int) ($item['revision'] ?? 1),
    ];
}

function loadJournalItem(PDO $db, int $userId, int $categoryId, string $date): ?array
{
    $stmt = $db->prepare(
        'SELECT id, category_id, name, content, due_date, sketch_json, created_at, updated_at, revision
         FROM items
         WHERE user_id = :user_id AND category_id = :category_id AND due_date = :due_date
         ORDER BY id ASC
         LIMIT 1'
    );
    $stmt->execute([
        ':user_id' => $userId,
        ':category_id' => $categoryId,
        ':due_date' => $date,
    ]);
    $item = $stmt->fetch();

    return is_array($item) ? $item : null;
}

function fetchItemForUser(PDO $db, int $userId, int $itemId): ?array
{
    $stmt = $db->prepare(
        'SELECT
            items.id,
            items.category_id,
            categories.name AS category_name,
            categories.type AS category_type,
            items.name,
            items.barcode,
            items.quantity,
            items.due_date,
            items.due_time,
            items.priority,
            items.is_pinned,
            items.status,
            items.content,
            items.sketch_json,
            items.done,
            items.sort_order,
            items.created_at,
            items.updated_at,
            items.revision,
            attachments.storage_section AS attachment_storage_section,
            attachments.stored_name AS attachment_stored_name,
            attachments.original_name AS attachment_original_name,
            attachments.media_type AS attachment_media_type,
            attachments.size_bytes AS attachment_size_bytes,
            attachments.updated_at AS attachment_updated_at,
            CASE WHEN attachments.id IS NULL THEN 0 ELSE 1 END AS has_attachment,
            CASE WHEN length(items.sketch_json) > 0 THEN 1 ELSE 0 END AS has_sketch
         FROM items
         INNER JOIN categories ON categories.id = items.category_id
         LEFT JOIN attachments ON attachments.item_id = items.id
         WHERE items.id = :id AND items.user_id = :user_id
         LIMIT 1'
    );
    $stmt->execute([':id' => $itemId, ':user_id' => $userId]);
    $item = $stmt->fetch();

    return is_array($item) ? $item : null;
}

function requireExpectedItemRevision(array $data): int
{
    $expectedRevision = array_key_exists('expected_revision', $data) ? $data['expected_revision'] : null;
    if ($expectedRevision === null || $expectedRevision === '') {
        respond(428, ['error' => t('error.revision_required'), 'error_key' => 'error.revision_required']);
    }

    $revision = filter_var($expectedRevision, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!is_int($revision)) {
        respond(422, ['error' => t('error.revision_invalid'), 'error_key' => 'error.revision_invalid']);
    }

    return $revision;
}

function requireDeletionId(array $data): string
{
    $deletionId = trim((string) ($data['deletion_id'] ?? ''));
    if ($deletionId === '') {
        respond(428, [
            'error' => 'Lösch-ID erforderlich.',
            'error_key' => 'error.deletion_id_required',
        ]);
    }
    if (strlen($deletionId) > 128 || preg_match('/^[A-Za-z0-9_-]+$/', $deletionId) !== 1) {
        respond(422, [
            'error' => 'Ungültige Lösch-ID.',
            'error_key' => 'error.deletion_id_invalid',
        ]);
    }

    return $deletionId;
}

function requireExpectedCreateOrUpdateRevision(array $data): int
{
    $expectedRevision = array_key_exists('expected_revision', $data) ? $data['expected_revision'] : null;
    if ($expectedRevision === null || $expectedRevision === '') {
        respond(428, ['error' => t('error.revision_required'), 'error_key' => 'error.revision_required']);
    }

    $revision = filter_var($expectedRevision, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
    if (!is_int($revision)) {
        respond(422, ['error' => t('error.revision_invalid'), 'error_key' => 'error.revision_invalid']);
    }

    return $revision;
}

function respondStatusMutationMiss(
    PDO $db,
    int $userId,
    int $itemId,
    int $expectedRevision,
    callable $targetReached,
    string $successMessage
): never {
    $current = fetchItemForUser($db, $userId, $itemId);
    if ($current === null) {
        respond(404, ['error' => t('error.item_not_found'), 'error_key' => 'error.item_not_found']);
    }
    if ($targetReached($current)) {
        respond(200, ['message' => $successMessage, 'item' => formatListItem($current)]);
    }

    respond(409, [
        'error' => t('error.item_revision_conflict'),
        'error_key' => 'error.item_revision_conflict',
        'expected_revision' => $expectedRevision,
        'current_revision' => (int) $current['revision'],
        'item' => formatListItem($current),
    ]);
}

function isAdminUser(): bool
{
    return ($_SESSION['is_admin'] ?? false) === true;
}

/**
 * Normalizes item fields based on category type.
 *
 * Each category type only supports a subset of item fields.
 * This function clears fields that are not applicable for the given type,
 * ensuring consistent data regardless of whether the caller is `add` or `update`.
 *
 * @param string $type     The category type (e.g. 'list', 'list_quantity', 'notes', ...)
 * @param string $content  The raw (already normalized) content value
 * @param string $barcode  The raw barcode value
 * @param string $quantity The raw quantity value
 * @param string $dueDate  The raw due_date value
 * @param array  $data     The raw request data (for re-normalizing content in due_date context)
 * @return array{content: string, barcode: string, quantity: string, due_date: string}
 */
function normalizeItemFieldsForType(
    string $type,
    string $content,
    string $barcode,
    string $quantity,
    string $dueDate,
    array $data
): array {
    return match ($type) {
        'list_due_date' => [
            'content'  => normalizePlainTextContent($data['content'] ?? null),
            'barcode'  => '',
            'quantity' => '',
            'due_date' => $dueDate,
        ],
        'list_quantity' => [
            'content'  => '',
            'barcode'  => $barcode,
            'quantity' => $quantity,
            'due_date' => '',
        ],
        'notes', 'links' => [
            'content'  => $content,
            'barcode'  => '',
            'quantity' => '',
            'due_date' => '',
        ],
        'daily_notes' => [
            'content'  => $content,
            'barcode'  => '',
            'quantity' => '',
            'due_date' => $dueDate,
        ],
        default => [
            'content'  => '',
            'barcode'  => '',
            'quantity' => '',
            'due_date' => '',
        ],
    };
}
