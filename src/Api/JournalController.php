<?php
declare(strict_types=1);

function handleJournalApiAction(PDO $db, int $userId, string $action): never
{
    switch ($action) {
        case 'today':
            requireMethod('GET');
            $today = (new DateTimeImmutable('now', new DateTimeZone('Europe/Berlin')))->format('Y-m-d');
            $date = array_key_exists('date', $_GET) ? normalizeJournalDate($_GET['date']) : $today;

            // Auswahl liegt in fetchAgendaRows() (db.php), damit index.php beim
            // ersten Paint exakt dieselben Items rendert.
            $items = array_map(static function (array $row): array {
                $formatted = formatListItem($row);
                $formatted['agenda_group'] = $row['agenda_group'];
                return $formatted;
            }, fetchAgendaRows($db, $userId, $date, $today));
            respond(200, ['today' => $today, 'date' => $date, 'items' => $items]);

        case 'journal':
            requireMethod('GET');
            $serverToday = (new DateTimeImmutable('now', new DateTimeZone('Europe/Berlin')))->format('Y-m-d');
            $date = normalizeJournalDate($_GET['date'] ?? $serverToday);
            $category = ensureDailyNotesCategory($db, $userId);
            $item = loadJournalItem($db, $userId, (int) $category['id'], $date);

            respond(200, [
                'today' => $serverToday,
                'date' => $date,
                'category' => $category,
                'item' => formatJournalItem($item),
            ]);

        case 'journal_save':
            $data = requireWriteRequest();
            requireIdempotencyRequestId();

            $date = normalizeJournalDate($data['date'] ?? null);
            $content = normalizeContent($data['content'] ?? null);
            $baseContentProvided = array_key_exists('base_content', $data);
            $baseContent = $baseContentProvided ? normalizeContent($data['base_content']) : '';
            $title = (new DateTimeImmutable($date, new DateTimeZone('Europe/Berlin')))->format('d.m.Y');
            $expectedRevision = requireExpectedCreateOrUpdateRevision($data);
            $created = false;

            // Acquire the SQLite write lock before the read-or-insert decision so
            // concurrent first saves for the same day cannot both observe no item.
            beginImmediateTransaction($db);
            try {
                $category = ensureDailyNotesCategory($db, $userId);
                $item = loadJournalItem($db, $userId, (int) $category['id'], $date);

                if ($item === null) {
                    if ($expectedRevision !== 0) {
                        rollBackImmediateTransaction($db);
                        respond(404, ['error' => t('error.item_not_found'), 'error_key' => 'error.item_not_found']);
                    }
                    $sortOrder = prependItemSortOrder($db, $userId, (int) $category['id']);
                    $stmt = $db->prepare(
                        "INSERT INTO items (name, quantity, due_date, content, section, category_id, sort_order, user_id)
                         VALUES (:name, '', :due_date, :content, '', :category_id, :sort_order, :user_id)"
                    );
                    $stmt->execute([
                        ':name' => $title,
                        ':due_date' => $date,
                        ':content' => $content,
                        ':category_id' => (int) $category['id'],
                        ':sort_order' => $sortOrder,
                        ':user_id' => $userId,
                    ]);
                    $itemId = (int) $db->lastInsertId();
                    $created = true;
                } else {
                    $itemId = (int) $item['id'];
                    $currentRevision = (int) $item['revision'];
                    $currentContent = (string) $item['content'];
                    if ($currentContent === $content) {
                        commitImmediateTransaction($db);
                        respond(200, [
                            'message' => 'Journal gespeichert.',
                            'item' => formatJournalItem($item),
                        ]);
                    }
                    $revisionMatches = $expectedRevision === $currentRevision;
                    $componentUnchanged = $baseContentProvided && $currentContent === $baseContent;
                    $parallelFirstCreate = $expectedRevision === 0 && $currentContent === '';
                    if (!$revisionMatches && !$componentUnchanged && !$parallelFirstCreate) {
                        rollBackImmediateTransaction($db);
                        respond(409, [
                            'error' => t('error.item_revision_conflict'),
                            'error_key' => 'error.item_revision_conflict',
                            'expected_revision' => $expectedRevision,
                            'current_revision' => $currentRevision,
                            'item' => formatJournalItem($item),
                        ]);
                    }
                    $stmt = $db->prepare(
                        'UPDATE items
                         SET name = :name,
                             content = :content,
                             revision = revision + 1,
                             updated_at = CURRENT_TIMESTAMP
                         WHERE id = :id AND user_id = :user_id AND revision = :expected_revision'
                    );
                    $stmt->execute([
                        ':name' => $title,
                        ':content' => $content,
                        ':id' => $itemId,
                        ':user_id' => $userId,
                        ':expected_revision' => $currentRevision,
                    ]);
                    if ($stmt->rowCount() !== 1) {
                        rollBackImmediateTransaction($db);
                        $current = loadJournalItem($db, $userId, (int) $category['id'], $date);
                        respond(409, [
                            'error' => t('error.item_revision_conflict'),
                            'error_key' => 'error.item_revision_conflict',
                            'expected_revision' => $expectedRevision,
                            'current_revision' => $current !== null ? (int) $current['revision'] : null,
                            'item' => formatJournalItem($current),
                        ]);
                    }
                }

                commitImmediateTransaction($db);
            } catch (Throwable $error) {
                rollBackImmediateTransactionIfActive($db);
                throw $error;
            }

            $saved = loadJournalItem($db, $userId, (int) $category['id'], $date);
            respond($created ? 201 : 200, [
                'message' => 'Journal gespeichert.',
                'item' => formatJournalItem($saved),
            ]);
    }
    throw new LogicException('Unsupported journal API action.');
}
