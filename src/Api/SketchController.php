<?php
declare(strict_types=1);

function handleSketchApiAction(PDO $db, int $userId, string $action): never
{
    switch ($action) {
        case 'sketch_save':
            $data = requireWriteRequest();
            requireIdempotencyRequestId();

            $itemId = filter_var($data['item_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if (!is_int($itemId)) {
                respond(422, ['error' => t('error.invalid_id'), 'error_key' => 'error.invalid_id']);
            }
            $expectedRevision = requireExpectedItemRevision($data);
            $normalized = normalizeSketchJson($data['scene'] ?? null);

            $item = fetchItemForUser($db, $userId, $itemId);
            if ($item === null) {
                respond(404, ['error' => t('error.item_not_found'), 'error_key' => 'error.item_not_found']);
            }

            $categoryType = (string) ($item['category_type'] ?? '');
            if (!in_array($categoryType, SKETCH_CATEGORY_TYPES, true) && $categoryType !== 'daily_notes') {
                respond(422, ['error' => t('error.sketch_category_unsupported'), 'error_key' => 'error.sketch_category_unsupported']);
            }

            if ((string) ($item['sketch_json'] ?? '') === $normalized) {
                respond(200, [
                    'message' => 'Skizze gespeichert.',
                    'item_id' => $itemId,
                    'has_sketch' => $normalized !== '' ? 1 : 0,
                    'item' => formatListItem($item),
                    'scene' => $normalized === '' ? null : json_decode($normalized, true),
                ]);
            }

            $stmt = $db->prepare(
                'UPDATE items
                 SET sketch_json = :sketch_json,
                     revision = revision + 1,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id AND user_id = :user_id AND revision = :expected_revision'
            );
            $stmt->execute([
                ':sketch_json' => $normalized,
                ':id' => $itemId,
                ':user_id' => $userId,
                ':expected_revision' => $expectedRevision,
            ]);

            $saved = fetchItemForUser($db, $userId, $itemId);
            if ($stmt->rowCount() !== 1) {
                if ($saved === null) {
                    respond(404, ['error' => t('error.item_not_found'), 'error_key' => 'error.item_not_found']);
                }
                if ((string) ($saved['sketch_json'] ?? '') === $normalized) {
                    respond(200, [
                        'message' => 'Skizze gespeichert.',
                        'item_id' => $itemId,
                        'has_sketch' => $normalized !== '' ? 1 : 0,
                        'item' => formatListItem($saved),
                        'scene' => $normalized === '' ? null : json_decode($normalized, true),
                    ]);
                }
                $currentScene = (string) ($saved['sketch_json'] ?? '');
                respond(409, [
                    'error' => t('error.item_revision_conflict'),
                    'error_key' => 'error.item_revision_conflict',
                    'expected_revision' => $expectedRevision,
                    'current_revision' => (int) $saved['revision'],
                    'item' => formatListItem($saved),
                    'scene' => $currentScene === '' ? null : json_decode($currentScene, true),
                ]);
            }

            if ($saved === null) {
                respond(404, ['error' => t('error.item_not_found'), 'error_key' => 'error.item_not_found']);
            }
            $savedScene = (string) ($saved['sketch_json'] ?? '');
            respond(200, [
                'message' => 'Skizze gespeichert.',
                'item_id' => $itemId,
                'has_sketch' => $savedScene !== '' ? 1 : 0,
                'item' => formatListItem($saved),
                'scene' => $savedScene === '' ? null : json_decode($savedScene, true),
            ]);

        case 'sketch_save_daily':
            $data = requireWriteRequest();
            requireIdempotencyRequestId();

            $date = normalizeJournalDate($data['date'] ?? null);
            $normalized = normalizeSketchJson($data['scene'] ?? null);
            $baseSceneProvided = array_key_exists('base_scene', $data);
            $baseScene = $baseSceneProvided ? normalizeSketchJson($data['base_scene']) : '';
            $expectedRevision = requireExpectedCreateOrUpdateRevision($data);
            $title = (new DateTimeImmutable($date, new DateTimeZone('Europe/Berlin')))->format('d.m.Y');
            $created = false;

            // Atomic read-or-insert: same pattern as journal_save so the
            // first sketch save creates the daily item even without text,
            // and concurrent first saves for the same day cannot both observe
            // a missing row.
            beginImmediateTransaction($db);
            try {
                $category = ensureDailyNotesCategory($db, $userId);
                $item = loadJournalItem($db, $userId, (int) $category['id'], $date);

                if ($item === null && $normalized === '') {
                    if ($expectedRevision !== 0) {
                        rollBackImmediateTransaction($db);
                        respond(404, ['error' => t('error.item_not_found'), 'error_key' => 'error.item_not_found']);
                    }
                    commitImmediateTransaction($db);
                    respond(200, [
                        'message' => 'Keine Skizze zu speichern.',
                        'item_id' => null,
                        'has_sketch' => 0,
                        'date' => $date,
                        'item' => null,
                        'scene' => null,
                    ]);
                }

                if ($item === null) {
                    if ($expectedRevision !== 0) {
                        rollBackImmediateTransaction($db);
                        respond(404, ['error' => t('error.item_not_found'), 'error_key' => 'error.item_not_found']);
                    }
                    $sortOrder = prependItemSortOrder($db, $userId, (int) $category['id']);
                    $stmt = $db->prepare(
                        "INSERT INTO items (name, quantity, due_date, content, section, category_id, sort_order, sketch_json, user_id)
                         VALUES (:name, '', :due_date, '', '', :category_id, :sort_order, :sketch_json, :user_id)"
                    );
                    $stmt->execute([
                        ':name' => $title,
                        ':due_date' => $date,
                        ':category_id' => (int) $category['id'],
                        ':sort_order' => $sortOrder,
                        ':sketch_json' => $normalized,
                        ':user_id' => $userId,
                    ]);
                    $itemId = (int) $db->lastInsertId();
                    $created = true;
                } else {
                    $itemId = (int) $item['id'];
                    $currentRevision = (int) $item['revision'];
                    $currentScene = (string) ($item['sketch_json'] ?? '');
                    if ($currentScene === $normalized) {
                        commitImmediateTransaction($db);
                        respond(200, [
                            'message' => 'Skizze gespeichert.',
                            'item_id' => $itemId,
                            'has_sketch' => $currentScene !== '' ? 1 : 0,
                            'date' => $date,
                            'item' => formatJournalItem($item),
                            'scene' => $currentScene === '' ? null : json_decode($currentScene, true),
                        ]);
                    }

                    $revisionMatches = $expectedRevision === $currentRevision;
                    $componentUnchanged = $baseSceneProvided && $currentScene === $baseScene;
                    $parallelFirstCreate = $expectedRevision === 0 && $currentScene === '';
                    if (!$revisionMatches && !$componentUnchanged && !$parallelFirstCreate) {
                        rollBackImmediateTransaction($db);
                        respond(409, [
                            'error' => t('error.item_revision_conflict'),
                            'error_key' => 'error.item_revision_conflict',
                            'expected_revision' => $expectedRevision,
                            'current_revision' => $currentRevision,
                            'item' => formatJournalItem($item),
                            'scene' => $currentScene === '' ? null : json_decode($currentScene, true),
                        ]);
                    }

                    $stmt = $db->prepare(
                        'UPDATE items
                         SET sketch_json = :sketch_json,
                             revision = revision + 1,
                             updated_at = CURRENT_TIMESTAMP
                         WHERE id = :id AND user_id = :user_id AND revision = :expected_revision'
                    );
                    $stmt->execute([
                        ':sketch_json' => $normalized,
                        ':id' => $itemId,
                        ':user_id' => $userId,
                        ':expected_revision' => $currentRevision,
                    ]);
                    if ($stmt->rowCount() !== 1) {
                        throw new RuntimeException('Daily sketch CAS failed while holding the write lock.');
                    }
                }

                commitImmediateTransaction($db);
            } catch (Throwable $error) {
                rollBackImmediateTransactionIfActive($db);
                throw $error;
            }

            $saved = loadJournalItem($db, $userId, (int) $category['id'], $date);
            $savedScene = (string) ($saved['sketch_json'] ?? '');
            respond($created ? 201 : 200, [
                'message' => 'Skizze gespeichert.',
                'item_id' => $itemId,
                'has_sketch' => $savedScene !== '' ? 1 : 0,
                'date' => $date,
                'item' => formatJournalItem($saved),
                'scene' => $savedScene === '' ? null : json_decode($savedScene, true),
            ]);

        case 'sketch':
        case 'sketch_load':
            requireMethod('GET');
            $itemId = filter_var($_GET['item_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if (!is_int($itemId)) {
                respond(422, ['error' => t('error.invalid_id'), 'error_key' => 'error.invalid_id']);
            }

            $item = fetchItemForUser($db, $userId, $itemId);
            if ($item === null) {
                respond(404, ['error' => t('error.item_not_found'), 'error_key' => 'error.item_not_found']);
            }

            $categoryType = (string) ($item['category_type'] ?? '');
            if (!in_array($categoryType, SKETCH_CATEGORY_TYPES, true) && $categoryType !== 'daily_notes') {
                respond(422, ['error' => t('error.sketch_category_unsupported'), 'error_key' => 'error.sketch_category_unsupported']);
            }

            $scene = (string) ($item['sketch_json'] ?? '');
            $decoded = $scene === '' ? null : json_decode($scene, true);
            respond(200, [
                'item_id' => $itemId,
                'has_sketch' => $scene !== '' ? 1 : 0,
                'item' => formatListItem($item),
                'scene' => is_array($decoded) ? $decoded : null,
            ]);
    }
    throw new LogicException('Unsupported sketch API action.');
}
