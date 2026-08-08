<?php
declare(strict_types=1);

final class DeletionTombstoneException extends RuntimeException
{
    public function __construct(
        public readonly string $reason,
        public readonly array $context = []
    ) {
        parent::__construct($reason);
    }
}

/**
 * Owns the transaction boundary for reversible item deletion.
 *
 * The HTTP adapter only validates transport values and maps domain failures to
 * status codes. Capturing rows, CAS deletion and tombstone creation deliberately
 * happen behind this one interface so no caller can leave a half-staged batch.
 */
final class DeletionTombstoneService
{
    private const RETENTION_DAYS = 7;

    public function __construct(private readonly PDO $db)
    {
    }

    /**
     * @return array{deletion_id: string, state: string, items: list<array{deleted_id: int, terminal_revision: int}>}
     */
    public function stageSingle(
        int $userId,
        string $deletionId,
        int $itemId,
        int $expectedRevision
    ): array {
        $fingerprint = $this->fingerprint([
            'operation' => 'delete',
            'item_id' => $itemId,
            'expected_revision' => $expectedRevision,
        ]);

        $this->beginImmediate();

        try {
            $existing = $this->findTombstone($userId, $deletionId);
            if ($existing !== null) {
                $result = $this->existingStageResult($existing, 'delete', $fingerprint);
                $this->commit();
                return $result;
            }

            $itemStmt = $this->db->prepare(
                'SELECT * FROM items WHERE id = :id AND user_id = :user_id LIMIT 1'
            );
            $itemStmt->execute([':id' => $itemId, ':user_id' => $userId]);
            $item = $itemStmt->fetch(PDO::FETCH_ASSOC);

            if (!is_array($item)) {
                throw new DeletionTombstoneException('item_not_found', ['item_id' => $itemId]);
            }
            if ((int) ($item['revision'] ?? 1) !== $expectedRevision) {
                throw new DeletionTombstoneException('revision_conflict', [
                    'item_id' => $itemId,
                    'expected_revision' => $expectedRevision,
                    'current_revision' => (int) ($item['revision'] ?? 1),
                ]);
            }

            $attachmentStmt = $this->db->prepare(
                'SELECT * FROM attachments WHERE item_id = :item_id LIMIT 1'
            );
            $attachmentStmt->execute([':item_id' => $itemId]);
            $attachment = $attachmentStmt->fetch(PDO::FETCH_ASSOC);
            $attachment = is_array($attachment) ? $attachment : null;

            $terminalRevision = $expectedRevision + 1;
            $this->insertTombstone(
                $userId,
                $deletionId,
                'delete',
                $fingerprint,
                [$itemId],
                [$itemId => $terminalRevision]
            );
            $this->insertTombstoneItem(
                $userId,
                $deletionId,
                0,
                $item,
                $attachment,
                $terminalRevision
            );

            $deleteStmt = $this->db->prepare(
                'DELETE FROM items
                 WHERE id = :id AND user_id = :user_id AND revision = :expected_revision'
            );
            $deleteStmt->execute([
                ':id' => $itemId,
                ':user_id' => $userId,
                ':expected_revision' => $expectedRevision,
            ]);
            if ($deleteStmt->rowCount() !== 1) {
                throw new DeletionTombstoneException('revision_conflict', [
                    'item_id' => $itemId,
                    'expected_revision' => $expectedRevision,
                ]);
            }

            $this->commit();

            return [
                'deletion_id' => $deletionId,
                'state' => 'staged',
                'items' => [[
                    'deleted_id' => $itemId,
                    'terminal_revision' => $terminalRevision,
                ]],
            ];
        } catch (Throwable $error) {
            $this->rollBackIfActive();
            throw $error;
        }
    }

    /**
     * @param list<array{id: int, expected_revision: int}> $capturedItems
     * @return array{deletion_id: string, state: string, items: list<array{deleted_id: int, terminal_revision: int}>}
     */
    public function stageCompletedBatch(
        int $userId,
        string $deletionId,
        int $categoryId,
        array $capturedItems
    ): array {
        $fingerprintItems = $capturedItems;
        usort(
            $fingerprintItems,
            static fn(array $left, array $right): int => $left['id'] <=> $right['id']
        );
        $fingerprint = $this->fingerprint([
            'operation' => 'clear',
            'category_id' => $categoryId,
            'items' => $fingerprintItems,
        ]);

        $this->beginImmediate();

        try {
            $existing = $this->findTombstone($userId, $deletionId);
            if ($existing !== null) {
                $result = $this->existingStageResult($existing, 'clear', $fingerprint);
                $this->commit();
                return $result;
            }

            $snapshots = [];
            $itemIds = [];
            $terminalRevisions = [];
            $itemStmt = $this->db->prepare(
                'SELECT * FROM items WHERE id = :id AND user_id = :user_id LIMIT 1'
            );
            $attachmentStmt = $this->db->prepare(
                'SELECT * FROM attachments WHERE item_id = :item_id LIMIT 1'
            );

            foreach ($capturedItems as $capturedItem) {
                $itemId = (int) $capturedItem['id'];
                $expectedRevision = (int) $capturedItem['expected_revision'];
                $itemStmt->execute([':id' => $itemId, ':user_id' => $userId]);
                $item = $itemStmt->fetch(PDO::FETCH_ASSOC);
                if (
                    !is_array($item)
                    || (int) ($item['category_id'] ?? 0) !== $categoryId
                    || (int) ($item['done'] ?? 0) !== 1
                    || (int) ($item['revision'] ?? 1) !== $expectedRevision
                ) {
                    throw new DeletionTombstoneException('batch_conflict', [
                        'item_id' => $itemId,
                        'expected_revision' => $expectedRevision,
                        'current_revision' => is_array($item) ? (int) ($item['revision'] ?? 1) : null,
                    ]);
                }

                $attachmentStmt->execute([':item_id' => $itemId]);
                $attachment = $attachmentStmt->fetch(PDO::FETCH_ASSOC);
                $terminalRevision = $expectedRevision + 1;
                $snapshots[] = [
                    'item' => $item,
                    'attachment' => is_array($attachment) ? $attachment : null,
                    'expected_revision' => $expectedRevision,
                    'terminal_revision' => $terminalRevision,
                ];
                $itemIds[] = $itemId;
                $terminalRevisions[$itemId] = $terminalRevision;
            }

            $this->insertTombstone(
                $userId,
                $deletionId,
                'clear',
                $fingerprint,
                $itemIds,
                $terminalRevisions
            );

            $deleteStmt = $this->db->prepare(
                'DELETE FROM items
                 WHERE id = :id
                   AND category_id = :category_id
                   AND user_id = :user_id
                   AND done = 1
                   AND revision = :expected_revision'
            );
            $deletedItems = [];
            foreach ($snapshots as $order => $snapshot) {
                $itemId = (int) $snapshot['item']['id'];
                $this->insertTombstoneItem(
                    $userId,
                    $deletionId,
                    $order,
                    $snapshot['item'],
                    $snapshot['attachment'],
                    $snapshot['terminal_revision']
                );
                $deleteStmt->execute([
                    ':id' => $itemId,
                    ':category_id' => $categoryId,
                    ':user_id' => $userId,
                    ':expected_revision' => $snapshot['expected_revision'],
                ]);
                if ($deleteStmt->rowCount() !== 1) {
                    throw new DeletionTombstoneException('batch_conflict', [
                        'item_id' => $itemId,
                        'expected_revision' => $snapshot['expected_revision'],
                    ]);
                }
                $deletedItems[] = [
                    'deleted_id' => $itemId,
                    'terminal_revision' => (int) $snapshot['terminal_revision'],
                ];
            }

            $this->commit();

            return [
                'deletion_id' => $deletionId,
                'state' => 'staged',
                'items' => $deletedItems,
            ];
        } catch (Throwable $error) {
            $this->rollBackIfActive();
            throw $error;
        }
    }

    /**
     * @param list<int> $expectedItemIds Identifies an offline undo whose stage request lost the race.
     * @return array{deletion_id: string, state: string, item_ids: list<int>}
     */
    public function undo(int $userId, string $deletionId, array $expectedItemIds): array
    {
        $this->beginImmediate();

        try {
            $tombstone = $this->findTombstone($userId, $deletionId);
            if ($tombstone === null) {
                if ($expectedItemIds !== [] && $this->allItemsExist($userId, $expectedItemIds)) {
                    $this->insertUndoBarrier($userId, $deletionId, $expectedItemIds);
                    $this->commit();
                    return [
                        'deletion_id' => $deletionId,
                        'state' => 'not_staged',
                        'item_ids' => $expectedItemIds,
                    ];
                }

                throw new DeletionTombstoneException('deletion_not_found');
            }

            $state = (string) $tombstone['state'];
            $itemIds = array_map(
                static fn(mixed $itemId): int => (int) $itemId,
                $this->decodeJsonArray((string) $tombstone['item_ids_json'])
            );

            if ($state === 'purged') {
                throw new DeletionTombstoneException('deletion_purged', ['item_ids' => $itemIds]);
            }
            if ($state === 'restored') {
                $this->commit();
                return [
                    'deletion_id' => $deletionId,
                    'state' => 'restored',
                    'item_ids' => $itemIds,
                ];
            }

            $rowsStmt = $this->db->prepare(
                'SELECT item_json, attachment_json, terminal_revision
                 FROM deletion_tombstone_items
                 WHERE user_id = :user_id AND deletion_id = :deletion_id
                 ORDER BY item_order ASC'
            );
            $rowsStmt->execute([':user_id' => $userId, ':deletion_id' => $deletionId]);
            $rows = $rowsStmt->fetchAll(PDO::FETCH_ASSOC);
            if (count($rows) !== (int) $tombstone['item_count']) {
                throw new DeletionTombstoneException('deletion_payload_missing');
            }

            foreach ($rows as $row) {
                $item = $this->decodeJsonArray((string) $row['item_json']);
                $itemId = (int) ($item['id'] ?? 0);
                if ($itemId < 1) {
                    throw new DeletionTombstoneException('deletion_payload_invalid');
                }
                if ($this->itemExists($userId, $itemId)) {
                    throw new DeletionTombstoneException('restore_item_conflict', ['item_id' => $itemId]);
                }

                // The logical delete owns terminal_revision; restoration is a new
                // mutation and must therefore be strictly newer than both states.
                $item['revision'] = (int) $row['terminal_revision'] + 1;
                $this->insertRawRow('items', $item);

                $attachmentJson = $row['attachment_json'] ?? null;
                if (is_string($attachmentJson) && $attachmentJson !== '') {
                    $attachment = $this->decodeJsonArray($attachmentJson);
                    $attachment['item_id'] = $itemId;
                    $this->insertRawRow('attachments', $attachment);
                }
            }

            $updateStmt = $this->db->prepare(
                "UPDATE deletion_tombstones
                 SET state = 'restored', restored_at = CURRENT_TIMESTAMP
                 WHERE user_id = :user_id AND deletion_id = :deletion_id AND state = 'staged'"
            );
            $updateStmt->execute([':user_id' => $userId, ':deletion_id' => $deletionId]);
            if ($updateStmt->rowCount() !== 1) {
                throw new DeletionTombstoneException('deletion_state_conflict');
            }

            // The live rows now contain the exact restored data. The compact
            // parent marker is sufficient for retries; dropping the payload
            // releases its temporary category FK in the same atomic commit.
            $deletePayloadStmt = $this->db->prepare(
                'DELETE FROM deletion_tombstone_items
                 WHERE user_id = :user_id AND deletion_id = :deletion_id'
            );
            $deletePayloadStmt->execute([':user_id' => $userId, ':deletion_id' => $deletionId]);

            $this->commit();

            return [
                'deletion_id' => $deletionId,
                'state' => 'restored',
                'item_ids' => $itemIds,
            ];
        } catch (Throwable $error) {
            $this->rollBackIfActive();
            throw $error;
        }
    }

    /** @param list<int> $itemIds */
    private function insertUndoBarrier(int $userId, string $deletionId, array $itemIds): void
    {
        $canonicalItemIds = $itemIds;
        sort($canonicalItemIds);
        $operation = count($itemIds) === 1 ? 'delete' : 'clear';
        $stmt = $this->db->prepare(
            "INSERT INTO deletion_tombstones
                (user_id, deletion_id, operation, state, request_fingerprint,
                 item_count, item_ids_json, terminal_revisions_json,
                 expires_at, restored_at)
             VALUES
                (:user_id, :deletion_id, :operation, 'restored', :request_fingerprint,
                 :item_count, :item_ids_json, :terminal_revisions_json,
                 datetime('now', :retention), CURRENT_TIMESTAMP)"
        );
        $stmt->execute([
            ':user_id' => $userId,
            ':deletion_id' => $deletionId,
            ':operation' => $operation,
            ':request_fingerprint' => $this->fingerprint([
                'operation' => 'undo_barrier',
                'item_ids' => $canonicalItemIds,
            ]),
            ':item_count' => count($itemIds),
            ':item_ids_json' => $this->encodeJson($itemIds),
            ':terminal_revisions_json' => $this->encodeJson([]),
            ':retention' => '+' . self::RETENTION_DAYS . ' days',
        ]);
    }

    /**
     * @return array{deletion_id: string, state: string, item_ids: list<int>, cleanup_pending: bool}
     */
    public function finalize(int $userId, string $deletionId): array
    {
        $this->beginImmediate();

        try {
            $tombstone = $this->findTombstone($userId, $deletionId);
            if ($tombstone === null) {
                throw new DeletionTombstoneException('deletion_not_found');
            }

            $itemIds = array_map(
                static fn(mixed $itemId): int => (int) $itemId,
                $this->decodeJsonArray((string) $tombstone['item_ids_json'])
            );
            $state = (string) $tombstone['state'];
            if ($state === 'restored') {
                $this->commit();
                return [
                    'deletion_id' => $deletionId,
                    'state' => 'restored',
                    'item_ids' => $itemIds,
                    'cleanup_pending' => false,
                ];
            }

            if ($state === 'staged') {
                $purgeStmt = $this->db->prepare(
                    "UPDATE deletion_tombstones
                     SET state = 'purged', purged_at = CURRENT_TIMESTAMP
                     WHERE user_id = :user_id AND deletion_id = :deletion_id AND state = 'staged'"
                );
                $purgeStmt->execute([':user_id' => $userId, ':deletion_id' => $deletionId]);
                if ($purgeStmt->rowCount() !== 1) {
                    throw new DeletionTombstoneException('deletion_state_conflict');
                }
            }

            $releaseCategoryStmt = $this->db->prepare(
                'UPDATE deletion_tombstone_items
                 SET category_id = NULL
                 WHERE user_id = :user_id AND deletion_id = :deletion_id'
            );
            $releaseCategoryStmt->execute([':user_id' => $userId, ':deletion_id' => $deletionId]);

            // Keep payload rows until filesystem cleanup succeeds. A crash after
            // the committed purged marker is therefore retried safely by GC.
            $payloadStmt = $this->db->prepare(
                'SELECT attachment_json
                 FROM deletion_tombstone_items
                 WHERE user_id = :user_id AND deletion_id = :deletion_id
                 ORDER BY item_order ASC'
            );
            $payloadStmt->execute([':user_id' => $userId, ':deletion_id' => $deletionId]);
            $payloadRows = $payloadStmt->fetchAll(PDO::FETCH_ASSOC);
            $this->commit();
        } catch (Throwable $error) {
            $this->rollBackIfActive();
            throw $error;
        }

        $cleanupPending = false;
        foreach ($payloadRows as $payloadRow) {
            $attachmentJson = $payloadRow['attachment_json'] ?? null;
            if (!is_string($attachmentJson) || $attachmentJson === '') {
                continue;
            }
            try {
                $attachment = $this->decodeJsonArray($attachmentJson);
                deleteAttachmentStorageFile($attachment);
            } catch (Throwable $cleanupError) {
                $cleanupPending = true;
                error_log(sprintf(
                    'Attachment tombstone cleanup error [deletion:%s]: %s',
                    $deletionId,
                    $cleanupError->getMessage()
                ));
            }
        }

        if (!$cleanupPending) {
            $this->beginImmediate();
            try {
                $deletePayloadStmt = $this->db->prepare(
                    'DELETE FROM deletion_tombstone_items
                     WHERE user_id = :user_id
                       AND deletion_id = :deletion_id
                       AND EXISTS (
                           SELECT 1 FROM deletion_tombstones
                           WHERE user_id = :user_id
                             AND deletion_id = :deletion_id
                             AND state = \'purged\'
                       )'
                );
                $deletePayloadStmt->execute([':user_id' => $userId, ':deletion_id' => $deletionId]);
                $this->commit();
            } catch (Throwable $error) {
                $this->rollBackIfActive();
                throw $error;
            }
        }

        return [
            'deletion_id' => $deletionId,
            'state' => 'purged',
            'item_ids' => $itemIds,
            'cleanup_pending' => $cleanupPending,
        ];
    }

    /**
     * User-scoped opportunistic GC. Staged deletes expire after the retention
     * window; already-purged payloads are retried after interrupted file cleanup.
     *
     * @return list<string> deletion IDs handled in this pass
     */
    public function garbageCollectExpired(int $userId, int $limit = 10): array
    {
        $limit = max(1, min(100, $limit));
        // Expiring an undo window has priority and its own limit. Otherwise a
        // fixed set of old, permanently failing file retries could occupy the
        // shared page forever and starve every newer staged deletion.
        $expiredStmt = $this->db->prepare(
            "SELECT deletion_id
             FROM deletion_tombstones
             WHERE user_id = :user_id
               AND state = 'staged'
               AND expires_at <= CURRENT_TIMESTAMP
             ORDER BY expires_at ASC, created_at ASC
             LIMIT :limit"
        );
        $expiredStmt->bindValue(':user_id', $userId, PDO::PARAM_INT);
        $expiredStmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $expiredStmt->execute();
        $expiredDeletionIds = array_map('strval', $expiredStmt->fetchAll(PDO::FETCH_COLUMN));

        foreach ($expiredDeletionIds as $expiredDeletionId) {
            $this->finalize($userId, $expiredDeletionId);
        }

        $retryStmt = $this->db->prepare(
            "SELECT deletion_id
             FROM deletion_tombstones
             WHERE user_id = :user_id
               AND state = 'purged'
               AND EXISTS (
                   SELECT 1 FROM deletion_tombstone_items payload
                   WHERE payload.user_id = deletion_tombstones.user_id
                     AND payload.deletion_id = deletion_tombstones.deletion_id
               )
             ORDER BY purged_at ASC, created_at ASC
             LIMIT :limit"
        );
        $retryStmt->bindValue(':user_id', $userId, PDO::PARAM_INT);
        $retryStmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $retryStmt->execute();
        $retryDeletionIds = array_map('strval', $retryStmt->fetchAll(PDO::FETCH_COLUMN));

        foreach ($retryDeletionIds as $retryDeletionId) {
            $this->finalize($userId, $retryDeletionId);
        }

        $restoredPayloadStmt = $this->db->prepare(
            "SELECT 1
             FROM deletion_tombstones restored
             WHERE restored.user_id = :user_id
               AND restored.state = 'restored'
               AND restored.expires_at <= CURRENT_TIMESTAMP
               AND EXISTS (
                   SELECT 1 FROM deletion_tombstone_items payload
                   WHERE payload.user_id = restored.user_id
                     AND payload.deletion_id = restored.deletion_id
               )
             LIMIT 1"
        );
        $restoredPayloadStmt->execute([':user_id' => $userId]);
        if ($restoredPayloadStmt->fetchColumn() !== false) {
            // Restored tombstones no longer own files. Drop their bulky snapshots
            // after retention while keeping the parent marker for retry semantics.
            $this->beginImmediate();
            try {
                $cleanupRestored = $this->db->prepare(
                    "DELETE FROM deletion_tombstone_items
                     WHERE user_id = :user_id
                       AND EXISTS (
                           SELECT 1 FROM deletion_tombstones restored
                           WHERE restored.user_id = deletion_tombstone_items.user_id
                             AND restored.deletion_id = deletion_tombstone_items.deletion_id
                             AND restored.state = 'restored'
                             AND restored.expires_at <= CURRENT_TIMESTAMP
                       )"
                );
                $cleanupRestored->execute([':user_id' => $userId]);
                $this->commit();
            } catch (Throwable $error) {
                $this->rollBackIfActive();
                throw $error;
            }
        }

        // Global jobs are deliberately not user-scoped: their owner row may
        // already have been cascaded away. Every authenticated request can do
        // a small, bounded amount of safe orphan cleanup.
        $this->garbageCollectDetachedAttachments($limit);

        return array_values(array_unique(array_merge($expiredDeletionIds, $retryDeletionIds)));
    }

    /**
     * Persist attachment cleanup before a user/fixture cascade destroys the
     * last database reference. Callers may invoke this inside their own DB
     * transaction so queueing and owner deletion commit atomically.
     *
     * @param list<array<string, mixed>> $attachments
     * @return int number of newly queued files
     */
    public function enqueueDetachedAttachmentCleanup(array $attachments): int
    {
        $stmt = $this->db->prepare(
            'INSERT OR IGNORE INTO attachment_cleanup_jobs
                (cleanup_key, attachment_json)
             VALUES (:cleanup_key, :attachment_json)'
        );
        $queued = 0;
        foreach ($attachments as $attachment) {
            $storageSection = (string) ($attachment['storage_section'] ?? '');
            $storedName = (string) ($attachment['stored_name'] ?? '');
            $cleanupKey = hash('sha256', $storageSection . "\0" . $storedName);
            $stmt->execute([
                ':cleanup_key' => $cleanupKey,
                ':attachment_json' => $this->encodeJson($attachment),
            ]);
            $queued += $stmt->rowCount();
        }

        return $queued;
    }

    /**
     * Retry files detached by user/fixture deletion. Failed jobs retain their
     * metadata without a user FK and receive a short backoff to avoid hot-loop
     * logging on every request.
     *
     * @return array{processed: int, cleaned: int, pending: int}
     */
    public function garbageCollectDetachedAttachments(int $limit = 10): array
    {
        $limit = max(1, min(100, $limit));
        $stmt = $this->db->prepare(
            'SELECT cleanup_key, attachment_json
             FROM attachment_cleanup_jobs
             WHERE next_attempt_at <= CURRENT_TIMESTAMP
             ORDER BY next_attempt_at ASC, created_at ASC
             LIMIT :limit'
        );
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->execute();
        $jobs = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $cleaned = 0;
        foreach ($jobs as $job) {
            $cleanupKey = (string) ($job['cleanup_key'] ?? '');
            try {
                $attachment = $this->decodeJsonArray((string) ($job['attachment_json'] ?? ''));
                deleteAttachmentStorageFile($attachment);
                $deleteStmt = $this->db->prepare(
                    'DELETE FROM attachment_cleanup_jobs WHERE cleanup_key = :cleanup_key'
                );
                $deleteStmt->execute([':cleanup_key' => $cleanupKey]);
                $cleaned += $deleteStmt->rowCount();
            } catch (Throwable $cleanupError) {
                $retryStmt = $this->db->prepare(
                    "UPDATE attachment_cleanup_jobs
                     SET attempt_count = attempt_count + 1,
                         next_attempt_at = datetime('now', '+5 minutes'),
                         last_error = :last_error,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE cleanup_key = :cleanup_key"
                );
                $retryStmt->execute([
                    ':cleanup_key' => $cleanupKey,
                    ':last_error' => substr($cleanupError->getMessage(), 0, 1000),
                ]);
                error_log(sprintf(
                    'Detached attachment cleanup error [job:%s]: %s',
                    $cleanupKey,
                    $cleanupError->getMessage()
                ));
            }
        }

        return [
            'processed' => count($jobs),
            'cleaned' => $cleaned,
            'pending' => count($jobs) - $cleaned,
        ];
    }

    /**
     * Attachments no longer reachable through the live items table but still
     * owned by a staged/purged tombstone. Admin user deletion must clean these
     * files before the database cascade removes their metadata.
     *
     * @return list<array<string, mixed>>
     */
    public function attachmentPayloadsForUserDeletion(int $userId): array
    {
        $stmt = $this->db->prepare(
            "SELECT payload.attachment_json
             FROM deletion_tombstone_items payload
             INNER JOIN deletion_tombstones tombstone
                ON tombstone.user_id = payload.user_id
               AND tombstone.deletion_id = payload.deletion_id
             WHERE payload.user_id = :user_id
               AND tombstone.state IN ('staged', 'purged')
               AND payload.attachment_json IS NOT NULL"
        );
        $stmt->execute([':user_id' => $userId]);

        $attachments = [];
        $seen = [];
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $attachmentJson) {
            if (!is_string($attachmentJson) || $attachmentJson === '') {
                continue;
            }
            $attachment = $this->decodeJsonArray($attachmentJson);
            $key = (string) ($attachment['storage_section'] ?? '')
                . '/' . (string) ($attachment['stored_name'] ?? '');
            if ($key === '/' || isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $attachments[] = $attachment;
        }

        return $attachments;
    }

    private function insertTombstone(
        int $userId,
        string $deletionId,
        string $operation,
        string $fingerprint,
        array $itemIds,
        array $terminalRevisions
    ): void {
        $stmt = $this->db->prepare(
            "INSERT INTO deletion_tombstones
                (user_id, deletion_id, operation, request_fingerprint, item_count,
                 item_ids_json, terminal_revisions_json, expires_at)
             VALUES
                (:user_id, :deletion_id, :operation, :request_fingerprint, :item_count,
                 :item_ids_json, :terminal_revisions_json, datetime('now', :retention))"
        );
        $stmt->execute([
            ':user_id' => $userId,
            ':deletion_id' => $deletionId,
            ':operation' => $operation,
            ':request_fingerprint' => $fingerprint,
            ':item_count' => count($itemIds),
            ':item_ids_json' => $this->encodeJson(array_values($itemIds)),
            ':terminal_revisions_json' => $this->encodeJson($terminalRevisions),
            ':retention' => '+' . self::RETENTION_DAYS . ' days',
        ]);
    }

    private function insertTombstoneItem(
        int $userId,
        string $deletionId,
        int $order,
        array $item,
        ?array $attachment,
        int $terminalRevision
    ): void {
        $stmt = $this->db->prepare(
            'INSERT INTO deletion_tombstone_items
                (user_id, deletion_id, item_id, category_id, item_order, item_json, attachment_json, terminal_revision)
             VALUES
                (:user_id, :deletion_id, :item_id, :category_id, :item_order, :item_json, :attachment_json, :terminal_revision)'
        );
        $stmt->execute([
            ':user_id' => $userId,
            ':deletion_id' => $deletionId,
            ':item_id' => (int) $item['id'],
            ':category_id' => (int) $item['category_id'],
            ':item_order' => $order,
            ':item_json' => $this->encodeJson($item),
            ':attachment_json' => $attachment !== null ? $this->encodeJson($attachment) : null,
            ':terminal_revision' => $terminalRevision,
        ]);
    }

    private function findTombstone(int $userId, string $deletionId): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM deletion_tombstones
             WHERE user_id = :user_id AND deletion_id = :deletion_id
             LIMIT 1'
        );
        $stmt->execute([':user_id' => $userId, ':deletion_id' => $deletionId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return is_array($row) ? $row : null;
    }

    /** @param list<int> $itemIds */
    private function allItemsExist(int $userId, array $itemIds): bool
    {
        $uniqueIds = array_values(array_unique($itemIds));
        if ($uniqueIds === []) {
            return false;
        }

        $placeholders = [];
        $params = [':user_id' => $userId];
        foreach ($uniqueIds as $index => $itemId) {
            $placeholder = ':item_' . $index;
            $placeholders[] = $placeholder;
            $params[$placeholder] = $itemId;
        }
        $stmt = $this->db->prepare(
            'SELECT COUNT(*) FROM items
             WHERE user_id = :user_id AND id IN (' . implode(', ', $placeholders) . ')'
        );
        $stmt->execute($params);

        return (int) $stmt->fetchColumn() === count($uniqueIds);
    }

    private function itemExists(int $userId, int $itemId): bool
    {
        $stmt = $this->db->prepare(
            'SELECT 1 FROM items WHERE user_id = :user_id AND id = :item_id LIMIT 1'
        );
        $stmt->execute([':user_id' => $userId, ':item_id' => $itemId]);
        return $stmt->fetchColumn() !== false;
    }

    private function insertRawRow(string $table, array $row): void
    {
        if (!in_array($table, ['items', 'attachments'], true)) {
            throw new InvalidArgumentException('Unsupported tombstone target table.');
        }

        $schemaColumns = $this->db->query('PRAGMA table_info(' . $table . ')')->fetchAll(PDO::FETCH_ASSOC);
        $allowedColumns = array_fill_keys(array_column($schemaColumns, 'name'), true);
        $columns = [];
        $placeholders = [];
        $params = [];
        foreach ($row as $column => $value) {
            if (!isset($allowedColumns[$column]) || preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $column) !== 1) {
                continue;
            }
            $columns[] = '"' . $column . '"';
            $placeholder = ':value_' . count($placeholders);
            $placeholders[] = $placeholder;
            $params[$placeholder] = $value;
        }
        if ($columns === []) {
            throw new DeletionTombstoneException('deletion_payload_invalid');
        }

        $stmt = $this->db->prepare(
            'INSERT INTO ' . $table
            . ' (' . implode(', ', $columns) . ')'
            . ' VALUES (' . implode(', ', $placeholders) . ')'
        );
        $stmt->execute($params);
    }

    private function existingStageResult(array $row, string $operation, string $fingerprint): array
    {
        if (
            (string) ($row['operation'] ?? '') !== $operation
            || !hash_equals((string) ($row['request_fingerprint'] ?? ''), $fingerprint)
        ) {
            throw new DeletionTombstoneException('deletion_id_conflict');
        }

        $itemIds = $this->decodeJsonArray((string) ($row['item_ids_json'] ?? '[]'));
        $terminalRevisions = $this->decodeJsonArray((string) ($row['terminal_revisions_json'] ?? '{}'));
        $items = [];
        foreach ($itemIds as $itemId) {
            $id = (int) $itemId;
            $items[] = [
                'deleted_id' => $id,
                'terminal_revision' => (int) ($terminalRevisions[$id] ?? $terminalRevisions[(string) $id] ?? 0),
            ];
        }

        return [
            'deletion_id' => (string) $row['deletion_id'],
            'state' => (string) $row['state'],
            'items' => $items,
        ];
    }

    private function fingerprint(array $payload): string
    {
        return hash('sha256', $this->encodeJson($payload));
    }

    private function encodeJson(array $value): string
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private function decodeJsonArray(string $json): array
    {
        $decoded = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        return is_array($decoded) ? $decoded : [];
    }

    private function beginImmediate(): void
    {
        $this->db->exec('BEGIN IMMEDIATE');
    }

    private function commit(): void
    {
        $this->db->exec('COMMIT');
    }

    private function rollBackIfActive(): void
    {
        try {
            $this->db->exec('ROLLBACK');
        } catch (PDOException) {
            // The transaction was already closed.
        }
    }
}
