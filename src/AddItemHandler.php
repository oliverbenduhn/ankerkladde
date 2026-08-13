<?php
declare(strict_types=1);

function handleAddItem(PDO $db, int $userId, array $data): never
{
    $category = requireCategory($data, $db, $userId);
    $name = normalizeName($data['name'] ?? null);
    $barcode = preg_replace('/\D+/', '', (string) ($data['barcode'] ?? '')) ?? '';
    $barcode = truncateText($barcode, 64);
    $quantity = normalizeQuantity($data['quantity'] ?? null);
    $dueDate = normalizeDueDate($data['due_date'] ?? null);
    $dueTime = normalizeDueTime($data['due_time'] ?? null);
    $priority = normalizePriority($data['priority'] ?? null);
    $content = normalizeContent($data['content'] ?? null);

    if ($name === '') {
        respond(422, ['error' => t('error.item_name_required'), 'error_key' => 'error.item_name_required']);
    }

    $type = (string) $category['type'];

    $normalized = normalizeItemFieldsForType($type, $content, $barcode, $quantity, $dueDate, $data);
    $content  = $normalized['content'];
    $barcode  = $normalized['barcode'];
    $quantity = $normalized['quantity'];
    $dueDate  = $normalized['due_date'];
    if ($type !== 'list_due_date' || $dueDate === '') {
        $dueTime = '';
    }
    if (!in_array($type, ['list_due_date', 'list_quantity'], true)) {
        $priority = '';
    }

    $db->beginTransaction();
    try {
        $sortOrder = prependItemSortOrder($db, $userId, (int) $category['id']);

        $stmt = $db->prepare(
            'INSERT INTO items (name, barcode, quantity, due_date, due_time, priority, content, section, category_id, sort_order, user_id)
             VALUES (:name, :barcode, :quantity, :due_date, :due_time, :priority, :content, :section, :category_id, :sort_order, :user_id)'
        );
        $stmt->execute([
            ':name' => $name,
            ':barcode' => $barcode,
            ':quantity' => $quantity,
            ':due_date' => $dueDate,
            ':due_time' => $dueTime,
            ':priority' => $priority,
            ':content' => $content,
            ':section' => '',
            ':category_id' => (int) $category['id'],
            ':sort_order' => $sortOrder,
            ':user_id' => $userId,
        ]);

        if ($barcode !== '') {
            $db->prepare(
                'UPDATE scanned_products
                 SET scan_count = scan_count + 1, updated_at = CURRENT_TIMESTAMP
                 WHERE barcode = :barcode'
            )->execute([':barcode' => $barcode]);
        }

        $db->commit();
    } catch (Throwable $exception) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $exception;
    }

    respond(201, [
        'message' => 'Artikel hinzugefügt.',
        'id' => (int) $db->lastInsertId(),
        'revision' => 1,
    ]);
}
