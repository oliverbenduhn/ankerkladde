<?php
declare(strict_types=1);

function handleAttachmentApiAction(PDO $db, int $userId, string $action): never
{
    switch ($action) {
        case 'upload':
            $data = requireWriteRequest();

            $category = requireCategory($data, $db, $userId);
            validateCategoryType($category, ['images', 'files'], t('error.invalid_category'));

            $uploadedFile = getSingleUploadedFile();
            $uploadMeta = $category['type'] === 'images'
                ? validateImageUpload($uploadedFile)
                : validateFileUpload($uploadedFile);

            $name = normalizeName($data['name'] ?? null);
            if ($name === '') {
                $name = normalizeName((string) $uploadedFile['original_name']);
            }

            $replaceItemId = filter_var($data['item_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

            if (is_int($replaceItemId)) {
                requireIdempotencyRequestId();
                $expectedRevision = requireExpectedItemRevision($data);
                $existingItem = fetchItemForUser($db, $userId, $replaceItemId);
                if ($existingItem === null || (int) $existingItem['category_id'] !== (int) $category['id']) {
                    respond(404, ['error' => t('error.item_not_found'), 'error_key' => 'error.item_not_found']);
                }

                $storedName = buildStoredFilename((string) $category['type'], (string) $uploadMeta['stored_extension']);
                $targetPath = getAttachmentStorageDirectory((string) $category['type']) . '/' . $storedName;
                $storedFileMoved = false;
                $newAttachment = [
                    'storage_section' => (string) $category['type'],
                    'stored_name' => $storedName,
                ];

                try {
                    if (!move_uploaded_file((string) $uploadedFile['tmp_name'], $targetPath)) {
                        throw new RuntimeException('Upload-Datei konnte nicht verschoben werden.');
                    }
                    $storedFileMoved = true;

                    if ((string) $category['type'] === 'images') {
                        @generateImageThumbnailFile($targetPath, getAttachmentThumbnailAbsolutePath($newAttachment));
                    }

                    beginImmediateTransaction($db);
                    $currentItem = fetchItemForUser($db, $userId, $replaceItemId);
                    if ($currentItem === null || (int) $currentItem['category_id'] !== (int) $category['id']) {
                        rollBackImmediateTransaction($db);
                        deleteAttachmentStorageFile($newAttachment);
                        respond(404, ['error' => t('error.item_not_found'), 'error_key' => 'error.item_not_found']);
                    }

                    $oldAttachment = findAttachmentByItemId($db, $replaceItemId);
                    $updated = $db->prepare(
                        'UPDATE items
                         SET name = :name,
                             revision = revision + 1,
                             updated_at = CURRENT_TIMESTAMP
                         WHERE id = :id
                           AND user_id = :user_id
                           AND category_id = :category_id
                           AND revision = :expected_revision'
                    );
                    $updated->execute([
                        ':name' => $name,
                        ':id' => $replaceItemId,
                        ':user_id' => $userId,
                        ':category_id' => (int) $category['id'],
                        ':expected_revision' => $expectedRevision,
                    ]);
                    if ($updated->rowCount() !== 1) {
                        rollBackImmediateTransaction($db);
                        deleteAttachmentStorageFile($newAttachment);
                        $currentItem = fetchItemForUser($db, $userId, $replaceItemId);
                        if ($currentItem === null) {
                            respond(404, ['error' => t('error.item_not_found'), 'error_key' => 'error.item_not_found']);
                        }
                        respond(409, [
                            'error' => t('error.item_revision_conflict'),
                            'error_key' => 'error.item_revision_conflict',
                            'expected_revision' => $expectedRevision,
                            'current_revision' => (int) $currentItem['revision'],
                            'item' => formatListItem($currentItem),
                        ]);
                    }

                    $db->prepare(
                        'INSERT INTO attachments (item_id, storage_section, stored_name, original_name, media_type, size_bytes)
                         VALUES (:item_id, :storage_section, :stored_name, :original_name, :media_type, :size_bytes)
                         ON CONFLICT(item_id) DO UPDATE SET
                            storage_section = excluded.storage_section,
                            stored_name = excluded.stored_name,
                            original_name = excluded.original_name,
                            media_type = excluded.media_type,
                            size_bytes = excluded.size_bytes,
                            updated_at = CURRENT_TIMESTAMP'
                    )->execute([
                        ':item_id' => $replaceItemId,
                        ':storage_section' => (string) $category['type'],
                        ':stored_name' => $storedName,
                        ':original_name' => (string) $uploadedFile['original_name'],
                        ':media_type' => (string) $uploadMeta['media_type'],
                        ':size_bytes' => (int) $uploadedFile['size_bytes'],
                    ]);

                    $canonicalItem = fetchItemForUser($db, $userId, $replaceItemId);
                    if ($oldAttachment !== null) {
                        $cleanupService = new DeletionTombstoneService($db);
                        $cleanupService->enqueueDetachedAttachmentCleanup([$oldAttachment]);
                        if ($db instanceof TransactionalPDO) {
                            $db->afterCommit(static fn() => $cleanupService->garbageCollectDetachedAttachments());
                        }
                    }
                    commitImmediateTransaction($db);
                } catch (Throwable $exception) {
                    rollBackImmediateTransactionIfActive($db);
                    if ($storedFileMoved) {
                        try {
                            deleteAttachmentStorageFile($newAttachment);
                        } catch (Throwable) {
                            @unlink($targetPath);
                        }
                    }
                    throw $exception;
                }

                respond(200, [
                    'message' => 'Anhang ersetzt.',
                    'id' => $replaceItemId,
                    'item' => formatListItem(is_array($canonicalItem) ? $canonicalItem : fetchItemForUser($db, $userId, $replaceItemId)),
                ]);
            }

            if ($name === '') {
                respond(422, ['error' => t('error.item_name_required'), 'error_key' => 'error.item_name_required']);
            }

            $storedName = buildStoredFilename((string) $category['type'], (string) $uploadMeta['stored_extension']);
            $targetPath = getAttachmentStorageDirectory((string) $category['type']) . '/' . $storedName;
            $storedFileMoved = false;
            $itemId = null;

            $db->beginTransaction();
            try {
                $sortOrder = prependItemSortOrder($db, $userId, (int) $category['id']);
                $db->prepare(
                    'INSERT INTO items (name, quantity, due_date, content, section, category_id, sort_order, user_id)
                     VALUES (:name, \'\', \'\', \'\', \'\', :category_id, :sort_order, :user_id)'
                )->execute([
                    ':name' => $name,
                    ':category_id' => (int) $category['id'],
                    ':sort_order' => $sortOrder,
                    ':user_id' => $userId,
                ]);
                $itemId = (int) $db->lastInsertId();

                if (!move_uploaded_file((string) $uploadedFile['tmp_name'], $targetPath)) {
                    throw new RuntimeException('Upload-Datei konnte nicht verschoben werden.');
                }
                $storedFileMoved = true;

                if ((string) $category['type'] === 'images') {
                    @generateImageThumbnailFile($targetPath, getAttachmentThumbnailAbsolutePath([
                        'storage_section' => (string) $category['type'],
                        'stored_name' => $storedName,
                    ]));
                }

                $db->prepare(
                    'INSERT INTO attachments (item_id, storage_section, stored_name, original_name, media_type, size_bytes)
                     VALUES (:item_id, :storage_section, :stored_name, :original_name, :media_type, :size_bytes)'
                )->execute([
                    ':item_id' => $itemId,
                    ':storage_section' => (string) $category['type'],
                    ':stored_name' => $storedName,
                    ':original_name' => (string) $uploadedFile['original_name'],
                    ':media_type' => (string) $uploadMeta['media_type'],
                    ':size_bytes' => (int) $uploadedFile['size_bytes'],
                ]);

                $db->commit();
            } catch (Throwable $exception) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                if ($storedFileMoved && is_file($targetPath)) {
                    @unlink($targetPath);
                }
                throw $exception;
            }

            respond(201, ['message' => 'Upload gespeichert.', 'id' => $itemId]);

        case 'import_url':
            $data = requireWriteRequest();

            $category = requireCategory($data, $db, $userId);
            validateCategoryType($category, ['files'], t('error.invalid_category'));

            $importUrl = trim((string) ($data['url'] ?? ''));
            validateSsrfSafeUrl($importUrl);

            $downloaded = downloadRemoteFile($importUrl);
            if (isset($downloaded['error'])) {
                $payload = ['error' => (string) $downloaded['error']];
                if (isset($downloaded['error_key'])) {
                    $payload['error_key'] = (string) $downloaded['error_key'];
                }
                respond(422, $payload);
            }

            $uploadedFile = [
                'tmp_name' => (string) $downloaded['tmp_path'],
                'size_bytes' => (int) $downloaded['size_bytes'],
                'original_name' => (string) $downloaded['original_name'],
            ];
            $uploadMeta = validateFileUpload($uploadedFile, 'remote_file_import_max_mb');
            $name = normalizeName($data['name'] ?? null);
            if ($name === '') {
                $name = normalizeName((string) $uploadedFile['original_name']);
            }
            if ($name === '') {
                $name = 'Datei';
            }

            $storedName = buildStoredFilename('files', (string) $uploadMeta['stored_extension']);
            $targetPath = getAttachmentStorageDirectory('files') . '/' . $storedName;
            $storedFileMoved = false;
            $itemId = null;

            $db->beginTransaction();
            try {
                $sortOrder = prependItemSortOrder($db, $userId, (int) $category['id']);
                $db->prepare(
                    'INSERT INTO items (name, quantity, due_date, content, section, category_id, sort_order, user_id)
                     VALUES (:name, \'\', \'\', \'\', \'\', :category_id, :sort_order, :user_id)'
                )->execute([
                    ':name' => $name,
                    ':category_id' => (int) $category['id'],
                    ':sort_order' => $sortOrder,
                    ':user_id' => $userId,
                ]);
                $itemId = (int) $db->lastInsertId();

                if (!@rename((string) $downloaded['tmp_path'], $targetPath)) {
                    throw new RuntimeException('Importierte Datei konnte nicht gespeichert werden.');
                }
                $storedFileMoved = true;

                $db->prepare(
                    'INSERT INTO attachments (item_id, storage_section, stored_name, original_name, media_type, size_bytes)
                     VALUES (:item_id, :storage_section, :stored_name, :original_name, :media_type, :size_bytes)'
                )->execute([
                    ':item_id' => $itemId,
                    ':storage_section' => 'files',
                    ':stored_name' => $storedName,
                    ':original_name' => (string) $uploadedFile['original_name'],
                    ':media_type' => (string) $uploadMeta['media_type'],
                    ':size_bytes' => (int) $uploadedFile['size_bytes'],
                ]);

                $db->commit();
            } catch (Throwable $exception) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                if ($storedFileMoved && is_file($targetPath)) {
                    @unlink($targetPath);
                }
                @unlink((string) $downloaded['tmp_path']);
                throw $exception;
            }

            respond(201, ['message' => 'Datei importiert.', 'id' => $itemId]);
    }
    throw new LogicException('Unsupported attachment API action.');
}
