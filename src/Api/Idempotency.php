<?php
declare(strict_types=1);

function getIdempotencyRequestId(): string
{
    return trim((string) ($_SERVER['HTTP_X_IDEMPOTENCY_KEY'] ?? ''));
}

function isValidIdempotencyRequestId(string $requestId): bool
{
    if ($requestId === '' || strlen($requestId) > 128) {
        return false;
    }
    return preg_match('/^[A-Za-z0-9_-]+$/', $requestId) === 1;
}

function requireIdempotencyRequestId(): string
{
    $requestId = getIdempotencyRequestId();
    if ($requestId === '') {
        respond(428, [
            'error' => t('error.idempotency_key_required'),
            'error_key' => 'error.idempotency_key_required',
        ]);
    }

    return $requestId;
}

function canonicalizeForHash(array $data): array
{
    foreach ($data as $key => $value) {
        if (is_array($value)) {
            $data[$key] = canonicalizeForHash($value);
        }
    }
    ksort($data);
    return $data;
}

function computeIdempotencyRequestHash(string $action, array $data): string
{
    $files = [];
    foreach ($_FILES as $key => $info) {
        if (!is_array($info)) {
            continue;
        }
        $files[(string) $key] = [
            'name' => (string) ($info['name'] ?? ''),
            'size' => (int) ($info['size'] ?? 0),
            'type' => (string) ($info['type'] ?? ''),
            'error' => (int) ($info['error'] ?? 0),
            'sha256' => is_string($info['tmp_name'] ?? null) && is_file((string) $info['tmp_name'])
                ? (hash_file('sha256', (string) $info['tmp_name']) ?: '')
                : '',
        ];
    }
    ksort($files);

    $payload = [
        'action' => $action,
        'data' => canonicalizeForHash($data),
        'files' => $files,
    ];
    return hash('sha256', json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

function replayIdempotentIfKnown(array $data): void
{
    $requestId = getIdempotencyRequestId();
    if ($requestId === '') {
        return;
    }
    if (!isValidIdempotencyRequestId($requestId)) {
        respond(400, ['error' => t('error.idempotency_key_invalid'), 'error_key' => 'error.idempotency_key_invalid']);
    }

    $db = $GLOBALS['db'] ?? null;
    $userId = $GLOBALS['current_user_id'] ?? null;
    $action = $GLOBALS['current_action'] ?? '';
    if (!($db instanceof PDO) || !is_int($userId) || $action === '') {
        return;
    }

    $requestHash = computeIdempotencyRequestHash($action, $data);
    $GLOBALS['current_idempotency_request_hash'] = $requestHash;

    // Reserve the key under the same SQLite write lock used by every competing
    // request. response_status=0 is a durable in-flight marker. Without this
    // insert-before-mutate step two workers can both observe a missing key,
    // commit different mutations and overwrite each other's cached response.
    beginImmediateTransaction($db);
    try {
        $stmt = $db->prepare(
            'SELECT request_hash, response_status, response_body, created_at
             FROM idempotency_keys
             WHERE user_id = :user_id AND request_id = :request_id
             LIMIT 1'
        );
        $stmt->execute([':user_id' => $userId, ':request_id' => $requestId]);
        $cached = $stmt->fetch();

        if ($cached === false) {
            $reserveStmt = $db->prepare(
                'INSERT INTO idempotency_keys
                    (user_id, request_id, action, request_hash, response_status, response_body)
                 VALUES (:user_id, :request_id, :action, :request_hash, 0, :response_body)'
            );
            $reserveStmt->execute([
                ':user_id' => $userId,
                ':request_id' => $requestId,
                ':action' => $action,
                ':request_hash' => $requestHash,
                ':response_body' => '',
            ]);
            $GLOBALS['current_idempotency_reservation_owned'] = true;
            // Keep reservation, mutation and response in the same transaction.
            // Nested use-case transactions are savepoints on this connection.
            $GLOBALS['current_idempotency_operation'] = true;
            return;
        }

        if (!hash_equals((string) ($cached['request_hash'] ?? ''), $requestHash)) {
            commitImmediateTransaction($db);
            respond(422, ['error' => t('error.idempotency_key_mismatch'), 'error_key' => 'error.idempotency_key_mismatch']);
        }

        $status = (int) ($cached['response_status'] ?? 0);
        if ($status === 0) {
            // A crashed worker must not reserve the key forever. Three hours is
            // deliberately above the two-hour remote-import timeout.
            $reclaimStmt = $db->prepare(
                "UPDATE idempotency_keys
                 SET action = :action, created_at = CURRENT_TIMESTAMP
                 WHERE user_id = :user_id
                   AND request_id = :request_id
                   AND request_hash = :request_hash
                   AND response_status = 0
                   AND created_at <= datetime('now', '-3 hours')"
            );
            $reclaimStmt->execute([
                ':action' => $action,
                ':user_id' => $userId,
                ':request_id' => $requestId,
                ':request_hash' => $requestHash,
            ]);
            $reclaimed = $reclaimStmt->rowCount() === 1;
            if ($reclaimed) {
                $GLOBALS['current_idempotency_reservation_owned'] = true;
                $GLOBALS['current_idempotency_operation'] = true;
                return;
            }
            commitImmediateTransaction($db);
            respond(409, [
                'error' => 'Eine Anfrage mit diesem Idempotency-Key wird bereits verarbeitet.',
                'error_key' => 'error.idempotency_in_progress',
            ]);
        }

        $decoded = json_decode((string) ($cached['response_body'] ?? '{}'), true);
        $payload = is_array($decoded) ? $decoded : [];
        $payload['idempotent_replay'] = 1;
        commitImmediateTransaction($db);
        $GLOBALS['current_idempotency_replay'] = true;
        respond($status, $payload);
    } catch (Throwable $error) {
        rollBackImmediateTransactionIfActive($db);
        throw $error;
    }
}

function storeIdempotentResponse(int $status, array $payload): void
{
    if (($GLOBALS['current_idempotency_replay'] ?? false) === true) {
        return;
    }

    $requestId = getIdempotencyRequestId();
    if ($requestId === '') {
        return;
    }

    $db = $GLOBALS['db'] ?? null;
    $userId = $GLOBALS['current_user_id'] ?? null;
    $action = $GLOBALS['current_action'] ?? '';
    if (!($db instanceof PDO) || !is_int($userId) || $action === '') {
        return;
    }

    $data = requestData();
    $requestHash = (string) ($GLOBALS['current_idempotency_request_hash'] ?? '');
    if ($requestHash === '') {
        $requestHash = computeIdempotencyRequestHash($action, $data);
    }
    $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    // Both the domain mutation and this response remain uncommitted until the
    // final write succeeds. Failure rolls back the entire operation, so a retry
    // can safely acquire the same key again.
    for ($attempt = 1; $attempt <= 3; $attempt++) {
        try {
            $stmt = $db->prepare(
                'UPDATE idempotency_keys
                 SET action = :action, response_status = :response_status, response_body = :response_body
                 WHERE user_id = :user_id
                   AND request_id = :request_id
                   AND request_hash = :request_hash
                   AND response_status = 0'
            );
            $stmt->execute([
                ':user_id' => $userId,
                ':request_id' => $requestId,
                ':action' => $action,
                ':request_hash' => $requestHash,
                ':response_status' => $status,
                ':response_body' => (string) $body,
            ]);
            if ($stmt->rowCount() !== 1) {
                throw new RuntimeException('Idempotency reservation was not finalized exactly once.');
            }
            if (($GLOBALS['current_idempotency_operation'] ?? false) && $db instanceof TransactionalPDO) {
                if ($db->transactionDepth() !== 1) throw new RuntimeException('Unclosed mutation transaction.');
                $db->commit();
                $GLOBALS['current_idempotency_operation'] = false;
            }
            $GLOBALS['current_idempotency_reservation_owned'] = false;
            return;
        } catch (Throwable $error) {
            if ($attempt < 3) {
                usleep(25000 * $attempt);
                continue;
            }
            throw $error;
        }
    }
}

function releaseOwnedIdempotencyReservation(): void
{
    if (($GLOBALS['current_idempotency_reservation_owned'] ?? false) !== true) {
        return;
    }

    $db = $GLOBALS['db'] ?? null;
    $userId = $GLOBALS['current_user_id'] ?? null;
    $requestId = getIdempotencyRequestId();
    $requestHash = (string) ($GLOBALS['current_idempotency_request_hash'] ?? '');
    if (!($db instanceof PDO) || !is_int($userId) || $requestId === '' || $requestHash === '') {
        return;
    }

    try {
        $stmt = $db->prepare(
            'DELETE FROM idempotency_keys
             WHERE user_id = :user_id
               AND request_id = :request_id
               AND request_hash = :request_hash
               AND response_status = 0'
        );
        $stmt->execute([
            ':user_id' => $userId,
            ':request_id' => $requestId,
            ':request_hash' => $requestHash,
        ]);
    } catch (Throwable $error) {
        error_log('Idempotency reservation release failed: ' . $error->getMessage());
    } finally {
        $GLOBALS['current_idempotency_reservation_owned'] = false;
    }
}
