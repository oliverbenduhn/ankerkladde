<?php
declare(strict_types=1);

function handleItemApiAction(PDO $db, int $userId, string $action): never
{
    switch ($action) {
        case 'list':
            requireMethod('GET');
            $category = requireCategory([], $db, $userId);

            $orderBy = (string) $category['type'] === 'daily_notes'
                ? 'items.due_date DESC'
                : 'items.is_pinned DESC, items.sort_order ASC, items.id ASC';

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
                 WHERE items.category_id = :category_id
                   AND items.user_id = :user_id
                 ORDER BY ' . $orderBy
            );
            $stmt->execute([':category_id' => (int) $category['id'], ':user_id' => $userId]);

            $items = array_map(static fn(array $item): array => formatListItem($item), $stmt->fetchAll());
            $response = ['items' => $items, 'category' => $category];

            if (isAttachmentCategoryType((string) $category['type'])) {
                $freeBytes = disk_free_space(getDataDirectory());
                if ($freeBytes !== false) {
                    $response['disk_free_bytes'] = (int) $freeBytes;
                }
            }

            respond(200, $response);

        case 'quick_add':
            handleQuickAdd($db, $userId, requireWriteRequest());

        case 'add':
            handleAddItem($db, $userId, requireWriteRequest());

        case 'toggle':
            $data = requireWriteRequest();
            requireIdempotencyRequestId();

            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            // ponytail: tolerate truthy strings from legacy clients / offline queue
            // ("true"/"t"/"1" → 1, "false"/"f"/"0"/"" → 0) instead of 422-ing them.
            $rawDone = $data['done'] ?? null;
            if (is_string($rawDone)) {
                $normalized = strtolower(trim($rawDone));
                if (in_array($normalized, ['true', 't', '1', 'yes', 'on'], true)) {
                    $done = 1;
                } elseif (in_array($normalized, ['false', 'f', '0', 'no', 'off', ''], true)) {
                    $done = 0;
                } else {
                    $done = filter_var($rawDone, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 1]]);
                }
            } else {
                $done = filter_var($rawDone, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 1]]);
            }

            if (!is_int($id) || !is_int($done)) {
                respond(422, ['error' => t('error.invalid_status_params'), 'error_key' => 'error.invalid_status_params']);
            }

            $expectedRevision = requireExpectedItemRevision($data);

            $stmt = $db->prepare(
                'UPDATE items
                 SET done = :done, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id AND user_id = :user_id AND revision = :expected_revision AND done <> :done'
            );
            $stmt->execute([
                ':done' => $done,
                ':id' => $id,
                ':user_id' => $userId,
                ':expected_revision' => $expectedRevision,
            ]);

            if ($stmt->rowCount() === 0) {
                respondStatusMutationMiss(
                    $db,
                    $userId,
                    $id,
                    $expectedRevision,
                    static fn(array $item): bool => (int) $item['done'] === $done,
                    'Status aktualisiert.'
                );
            }

            $updated = fetchItemForUser($db, $userId, $id);
            respond(200, ['message' => 'Status aktualisiert.', 'item' => formatListItem($updated)]);

        case 'update':
            $data = requireWriteRequest();

            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if (!is_int($id)) {
                respond(422, ['error' => t('error.invalid_id'), 'error_key' => 'error.invalid_id']);
            }

            $expectedRevision = requireExpectedItemRevision($data);

            $item = fetchItemForUser($db, $userId, $id);
            if ($item === null) {
                respond(404, ['error' => t('error.item_not_found'), 'error_key' => 'error.item_not_found']);
            }

            // Lese für jedes Feld den Server-Wert als Default; nur überschreiben,
            // wenn der Schlüssel im Request steht. Sonst löscht ein Teilupdate
            // (nur Titel getippt) den Inhalt der Notiz / die Menge / das Datum.
            $type = (string) $item['category_type'];
            $name = array_key_exists('name', $data) ? normalizeName($data['name']) : (string) $item['name'];
            $barcode = array_key_exists('barcode', $data)
                ? truncateText(preg_replace('/\D+/', '', (string) $data['barcode']) ?? '', 64)
                : (string) ($item['barcode'] ?? '');
            $quantity = array_key_exists('quantity', $data) ? normalizeQuantity($data['quantity']) : (string) ($item['quantity'] ?? '');
            $dueDate = array_key_exists('due_date', $data) ? normalizeDueDate($data['due_date']) : (string) ($item['due_date'] ?? '');
            $dueTime = array_key_exists('due_time', $data) ? normalizeDueTime($data['due_time']) : (string) ($item['due_time'] ?? '');
            $priority = array_key_exists('priority', $data) ? normalizePriority($data['priority']) : (string) ($item['priority'] ?? '');
            $content = array_key_exists('content', $data) ? normalizeContent($data['content']) : (string) ($item['content'] ?? '');

            if ($name === '') {
                respond(422, ['error' => t('error.item_name_required'), 'error_key' => 'error.item_name_required']);
            }

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

            $statusActive = array_key_exists('status', $data);
            $status = null;
            if ($statusActive) {
                $statusRaw = $data['status'];
                $statusCandidate = in_array($statusRaw, ['', 'in_progress', 'waiting'], true) ? $statusRaw : null;
                if ($statusCandidate !== null) {
                    $status = $statusCandidate;
                } else {
                    $statusActive = false;
                }
            }

            $stmt = $db->prepare(
                'UPDATE items
                 SET name = :name,
                     barcode = :barcode,
                     quantity = :quantity,
                     due_date = :due_date,
                     due_time = :due_time,
                     priority = :priority,
                     content = :content,
                     status = CASE WHEN :status_active = "1" THEN :status ELSE status END,
                     revision = revision + 1,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id AND user_id = :user_id AND revision = :expected_revision'
            );
            $stmt->execute([
                ':id' => $id,
                ':name' => $name,
                ':barcode' => $barcode,
                ':quantity' => $quantity,
                ':due_date' => $dueDate,
                ':due_time' => $dueTime,
                ':priority' => $priority,
                ':content' => $content,
                ':status_active' => $statusActive ? '1' : '0',
                ':status' => (string) ($status ?? ''),
                ':user_id' => $userId,
                ':expected_revision' => $expectedRevision,
            ]);

            if ($stmt->rowCount() === 0) {
                $current = fetchItemForUser($db, $userId, $id);
                if ($current === null) {
                    respond(404, ['error' => t('error.item_not_found'), 'error_key' => 'error.item_not_found']);
                }
                respond(409, [
                    'error' => t('error.item_revision_conflict'),
                    'error_key' => 'error.item_revision_conflict',
                    'expected_revision' => $expectedRevision,
                    'current_revision' => (int) $current['revision'],
                    'item' => formatListItem($current),
                ]);
            }

            if ($barcode !== '') {
                $db->prepare(
                    'INSERT INTO scanned_products (barcode, product_name, quantity, confirmed, scan_count, updated_at)
                     VALUES (:barcode, :product_name, :quantity, 1, 0, CURRENT_TIMESTAMP)
                     ON CONFLICT(barcode) DO UPDATE SET
                         product_name = excluded.product_name,
                         quantity     = excluded.quantity,
                         confirmed    = 1,
                         updated_at   = CURRENT_TIMESTAMP'
                )->execute([
                    ':barcode'      => $barcode,
                    ':product_name' => $name,
                    ':quantity'     => $quantity,
                ]);
            }

            $updated = fetchItemForUser($db, $userId, $id);
            respond(200, [
                'message' => 'Artikel aktualisiert.',
                'item' => formatListItem($updated),
            ]);

        case 'delete':
            $data = requireWriteRequest();
            requireIdempotencyRequestId();

            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if (!is_int($id)) {
                respond(422, ['error' => t('error.invalid_id'), 'error_key' => 'error.invalid_id']);
            }
            $expectedRevision = requireExpectedItemRevision($data);
            $deletionId = requireDeletionId($data);

            try {
                $staged = (new DeletionTombstoneService($db))->stageSingle(
                    $userId,
                    $deletionId,
                    $id,
                    $expectedRevision
                );
            } catch (DeletionTombstoneException $error) {
                if ($error->reason === 'item_not_found') {
                    respond(404, ['error' => t('error.item_not_found'), 'error_key' => 'error.item_not_found']);
                }
                if ($error->reason === 'revision_conflict') {
                    $current = fetchItemForUser($db, $userId, $id);
                    if ($current === null) {
                        respond(404, ['error' => t('error.item_not_found'), 'error_key' => 'error.item_not_found']);
                    }
                    respond(409, [
                        'error' => t('error.item_revision_conflict'),
                        'error_key' => 'error.item_revision_conflict',
                        'expected_revision' => $expectedRevision,
                        'current_revision' => (int) $current['revision'],
                        'item' => formatListItem($current),
                    ]);
                }
                if ($error->reason === 'deletion_id_conflict') {
                    respond(409, [
                        'error' => 'Lösch-ID wurde bereits für einen anderen Vorgang verwendet.',
                        'error_key' => 'error.deletion_id_conflict',
                    ]);
                }
                throw $error;
            }

            $deletedItem = $staged['items'][0];

            respond(200, [
                'message' => 'Artikel gelöscht.',
                'deleted_id' => (int) $deletedItem['deleted_id'],
                'terminal_revision' => (int) $deletedItem['terminal_revision'],
                'deletion_id' => $deletionId,
                'deletion_state' => (string) $staged['state'],
            ]);

        case 'undo_delete':
            $data = requireWriteRequest();
            requireIdempotencyRequestId();
            $deletionId = requireDeletionId($data);

            $rawItemIds = $data['item_ids'] ?? ($data['item_ids[]'] ?? []);
            if (is_string($rawItemIds)) {
                $decodedItemIds = json_decode($rawItemIds, true);
                if (!is_array($decodedItemIds)) {
                    respond(422, ['error' => t('error.invalid_params'), 'error_key' => 'error.invalid_params']);
                }
                $rawItemIds = $decodedItemIds;
            }
            $itemIds = normalizeIdList($rawItemIds);
            if ($rawItemIds !== [] && $itemIds === []) {
                respond(422, ['error' => t('error.invalid_params'), 'error_key' => 'error.invalid_params']);
            }

            try {
                $undone = (new DeletionTombstoneService($db))->undo($userId, $deletionId, $itemIds);
            } catch (DeletionTombstoneException $error) {
                if ($error->reason === 'deletion_purged') {
                    respond(410, [
                        'error' => 'Dieser Löschvorgang wurde bereits endgültig bereinigt.',
                        'error_key' => 'error.deletion_purged',
                        'deletion_id' => $deletionId,
                        'deletion_state' => 'purged',
                    ]);
                }
                if ($error->reason === 'deletion_not_found') {
                    respond(404, [
                        'error' => 'Löschvorgang nicht gefunden.',
                        'error_key' => 'error.deletion_not_found',
                        'deletion_id' => $deletionId,
                    ]);
                }
                if ($error->reason === 'restore_item_conflict') {
                    respond(409, [
                        'error' => 'Die ursprüngliche Item-ID ist bereits belegt.',
                        'error_key' => 'error.deletion_restore_conflict',
                        'deletion_id' => $deletionId,
                    ]);
                }
                throw $error;
            }

            $restoredItems = [];
            foreach ($undone['item_ids'] as $restoredItemId) {
                $restoredItem = fetchItemForUser($db, $userId, (int) $restoredItemId);
                if ($restoredItem !== null) {
                    $restoredItems[] = formatListItem($restoredItem);
                }
            }

            respond(200, [
                'message' => $undone['state'] === 'not_staged'
                    ? 'Löschen war nicht gespeichert; Artikel ist bereits vorhanden.'
                    : 'Löschen rückgängig gemacht.',
                'deletion_id' => $deletionId,
                'deletion_state' => (string) $undone['state'],
                'restored_items' => $restoredItems,
            ]);

        case 'finalize_delete':
            $data = requireWriteRequest();
            requireIdempotencyRequestId();
            $deletionId = requireDeletionId($data);

            try {
                $finalized = (new DeletionTombstoneService($db))->finalize($userId, $deletionId);
            } catch (DeletionTombstoneException $error) {
                if ($error->reason === 'deletion_not_found') {
                    respond(404, [
                        'error' => 'Löschvorgang nicht gefunden.',
                        'error_key' => 'error.deletion_not_found',
                        'deletion_id' => $deletionId,
                    ]);
                }
                throw $error;
            }

            $purgedItemIds = $finalized['state'] === 'purged' ? $finalized['item_ids'] : [];
            respond(200, [
                'message' => $finalized['state'] === 'purged'
                    ? 'Löschvorgang endgültig bereinigt.'
                    : 'Löschvorgang wurde bereits rückgängig gemacht.',
                'deletion_id' => $deletionId,
                'deletion_state' => (string) $finalized['state'],
                'purged' => count($purgedItemIds),
                'purged_items' => $purgedItemIds,
                'cleanup_pending' => $finalized['cleanup_pending'] ? 1 : 0,
            ]);

        case 'move':
            $data = requireWriteRequest();
            requireIdempotencyRequestId();

            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $targetCategoryId = filter_var($data['target_category_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

            if (!is_int($id) || !is_int($targetCategoryId)) {
                respond(422, ['error' => t('error.invalid_move'), 'error_key' => 'error.invalid_move']);
            }

            $expectedRevision = requireExpectedItemRevision($data);

            $item = fetchItemForUser($db, $userId, $id);
            if ($item === null) {
                respond(404, ['error' => t('error.item_not_found'), 'error_key' => 'error.item_not_found']);
            }

            $sourceCategory = loadUserCategory($db, $userId, (int) $item['category_id']);
            $targetCategory = loadUserCategory($db, $userId, $targetCategoryId);

            if ($sourceCategory === null || $targetCategory === null) {
                respond(404, ['error' => t('error.category_not_found'), 'error_key' => 'error.category_not_found']);
            }

            if ((int) $sourceCategory['id'] === (int) $targetCategory['id']) {
                respond(200, [
                    'message' => 'Artikel ist bereits in dieser Kategorie.',
                    'source_category_id' => (int) $sourceCategory['id'],
                    'target_category_id' => (int) $targetCategory['id'],
                    'item' => formatListItem($item),
                ]);
            }

            if ((string) $sourceCategory['type'] !== (string) $targetCategory['type']) {
                respond(422, ['error' => t('error.move_type_mismatch'), 'error_key' => 'error.move_type_mismatch']);
            }

            $db->beginTransaction();
            try {
                $stmt = $db->prepare(
                    'UPDATE items
                     SET category_id = :target_category_id,
                         sort_order = :sort_order,
                         revision = revision + 1,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = :id AND user_id = :user_id AND revision = :expected_revision'
                );
                $stmt->execute([
                    ':target_category_id' => (int) $targetCategory['id'],
                    ':sort_order' => nextItemSortOrder($db, $userId, (int) $targetCategory['id']),
                    ':id' => $id,
                    ':user_id' => $userId,
                    ':expected_revision' => $expectedRevision,
                ]);
                if ($stmt->rowCount() === 0) {
                    $db->rollBack();
                    respondStatusMutationMiss(
                        $db,
                        $userId,
                        $id,
                        $expectedRevision,
                        static fn(array $current): bool => (int) $current['category_id'] === $targetCategoryId,
                        'Artikel ist bereits in dieser Kategorie.'
                    );
                }
                $db->commit();
            } catch (Throwable $exception) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                throw $exception;
            }

            respond(200, [
                'message' => 'Artikel verschoben.',
                'source_category_id' => (int) $sourceCategory['id'],
                'target_category_id' => (int) $targetCategory['id'],
                'item' => formatListItem(fetchItemForUser($db, $userId, $id)),
            ]);

        case 'clear':
            $data = requireWriteRequest();
            requireIdempotencyRequestId();

            $category = requireCategory($data, $db, $userId);
            $capturedItems = normalizeRevisionItemList($data['items'] ?? null);
            if ($capturedItems === []) {
                respond(422, ['error' => t('error.invalid_params'), 'error_key' => 'error.invalid_params']);
            }
            $deletionId = requireDeletionId($data);

            try {
                $staged = (new DeletionTombstoneService($db))->stageCompletedBatch(
                    $userId,
                    $deletionId,
                    (int) $category['id'],
                    $capturedItems
                );
            } catch (DeletionTombstoneException $error) {
                if ($error->reason === 'batch_conflict') {
                    $conflictingItemId = (int) ($error->context['item_id'] ?? 0);
                    $expectedRevision = (int) ($error->context['expected_revision'] ?? 0);
                    $current = $conflictingItemId > 0
                        ? fetchItemForUser($db, $userId, $conflictingItemId)
                        : null;
                    respond(409, [
                        'error' => t('error.item_revision_conflict'),
                        'error_key' => 'error.item_revision_conflict',
                        'expected_revision' => $expectedRevision,
                        'current_revision' => $current !== null ? (int) $current['revision'] : null,
                        'item' => $current !== null ? formatListItem($current) : null,
                    ]);
                }
                if ($error->reason === 'deletion_id_conflict') {
                    respond(409, [
                        'error' => 'Lösch-ID wurde bereits für einen anderen Vorgang verwendet.',
                        'error_key' => 'error.deletion_id_conflict',
                    ]);
                }
                throw $error;
            }

            respond(200, [
                'message' => 'Erledigte Artikel gelöscht.',
                'deleted' => count($staged['items']),
                'deleted_items' => $staged['items'],
                'deletion_id' => $deletionId,
                'deletion_state' => (string) $staged['state'],
            ]);

        case 'reorder':
            $data = requireWriteRequest();
            requireIdempotencyRequestId();

            $category = requireCategory($data, $db, $userId);
            $orderedItems = normalizeRevisionItemList($data['items'] ?? null);
            if ($orderedItems === []) {
                respond(422, ['error' => t('error.invalid_order'), 'error_key' => 'error.invalid_order']);
            }

            $db->beginTransaction();
            try {
                $existingStmt = $db->prepare(
                    'SELECT id, revision
                     FROM items
                     WHERE category_id = :category_id AND user_id = :user_id
                     ORDER BY sort_order ASC, id ASC'
                );
                $existingStmt->execute([':category_id' => (int) $category['id'], ':user_id' => $userId]);
                $existingItems = $existingStmt->fetchAll();
                $orderedIds = array_column($orderedItems, 'id');
                $existingIds = array_map(static fn(array $item): int => (int) $item['id'], $existingItems);
                $sortedIds = $orderedIds;
                $sortedExistingIds = $existingIds;
                sort($sortedIds);
                sort($sortedExistingIds);

                if ($sortedIds !== $sortedExistingIds) {
                    $db->rollBack();
                    respond(409, [
                        'error' => t('error.order_mismatch_items'),
                        'error_key' => 'error.order_mismatch_items',
                    ]);
                }

                $stmt = $db->prepare(
                    'UPDATE items
                     SET sort_order = :sort_order,
                         revision = revision + 1,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = :id
                       AND category_id = :category_id
                       AND user_id = :user_id
                       AND revision = :expected_revision'
                );
                foreach ($orderedItems as $index => $orderedItem) {
                    $stmt->execute([
                        ':sort_order' => $index + 1,
                        ':id' => $orderedItem['id'],
                        ':category_id' => (int) $category['id'],
                        ':user_id' => $userId,
                        ':expected_revision' => $orderedItem['expected_revision'],
                    ]);
                    if ($stmt->rowCount() !== 1) {
                        $db->rollBack();
                        respond(409, [
                            'error' => t('error.item_revision_conflict'),
                            'error_key' => 'error.item_revision_conflict',
                            'expected_revision' => $orderedItem['expected_revision'],
                        ]);
                    }
                }
                $db->commit();
            } catch (Throwable $exception) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                throw $exception;
            }

            $canonicalItems = array_map(
                static fn(array $orderedItem): array => formatListItem(
                    fetchItemForUser($db, $userId, $orderedItem['id']) ?? []
                ),
                $orderedItems
            );
            respond(200, ['message' => 'Reihenfolge aktualisiert.', 'items' => $canonicalItems]);

        case 'pin':
            $data = requireWriteRequest();
            requireIdempotencyRequestId();

            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $isPinned = filter_var($data['is_pinned'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 1]]);

            if (!is_int($id) || !is_int($isPinned)) {
                respond(422, ['error' => t('error.invalid_params'), 'error_key' => 'error.invalid_params']);
            }

            $expectedRevision = requireExpectedItemRevision($data);

            $stmt = $db->prepare(
                'UPDATE items
                 SET is_pinned = :is_pinned, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id AND user_id = :user_id AND revision = :expected_revision AND is_pinned <> :is_pinned'
            );
            $stmt->execute([
                ':is_pinned' => $isPinned,
                ':id' => $id,
                ':user_id' => $userId,
                ':expected_revision' => $expectedRevision,
            ]);

            if ($stmt->rowCount() === 0) {
                respondStatusMutationMiss(
                    $db,
                    $userId,
                    $id,
                    $expectedRevision,
                    static fn(array $item): bool => (int) $item['is_pinned'] === $isPinned,
                    'Pinned-Status aktualisiert.'
                );
            }

            respond(200, [
                'message' => 'Pinned-Status aktualisiert.',
                'item' => formatListItem(fetchItemForUser($db, $userId, $id)),
            ]);

        case 'status':
            $data = requireWriteRequest();
            requireIdempotencyRequestId();

            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $status = $data['status'] ?? null;

            if (!is_int($id) || !in_array($status, ['', 'in_progress', 'waiting'], true)) {
                respond(422, ['error' => t('error.invalid_params'), 'error_key' => 'error.invalid_params']);
            }

            $expectedRevision = requireExpectedItemRevision($data);

            $stmt = $db->prepare(
                'UPDATE items
                 SET status = :status, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id AND user_id = :user_id AND revision = :expected_revision AND status <> :status'
            );
            $stmt->execute([
                ':status' => $status,
                ':id' => $id,
                ':user_id' => $userId,
                ':expected_revision' => $expectedRevision,
            ]);

            if ($stmt->rowCount() === 0) {
                respondStatusMutationMiss(
                    $db,
                    $userId,
                    $id,
                    $expectedRevision,
                    static fn(array $item): bool => (string) $item['status'] === $status,
                    'Status aktualisiert.'
                );
            }

            respond(200, [
                'message' => 'Status aktualisiert.',
                'item' => formatListItem(fetchItemForUser($db, $userId, $id)),
            ]);

        case 'search':
            requireMethod('GET');
            $q = trim((string) ($_GET['q'] ?? ''));
            if (strlen($q) < 2) {
                respond(200, ['items' => []]);
            }

            $ftsQuery = sanitizeFtsQuery($q);
            if ($ftsQuery === '') {
                respond(200, ['items' => []]);
            }

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
                 FROM items_fts
                 INNER JOIN items ON items.id = items_fts.rowid
                 INNER JOIN categories ON categories.id = items.category_id
                 LEFT JOIN attachments ON attachments.item_id = items.id
                 WHERE items_fts MATCH :q AND items.user_id = :user_id
                 ORDER BY rank
                 LIMIT 50'
            );
            $stmt->execute([':q' => $ftsQuery, ':user_id' => $userId]);

            $items = array_map(static fn(array $item): array => formatListItem($item), $stmt->fetchAll());
            respond(200, ['items' => $items]);
    }
    throw new LogicException('Unsupported item API action.');
}
