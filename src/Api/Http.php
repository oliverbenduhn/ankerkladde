<?php
declare(strict_types=1);

function respond(int $status, array $payload): never
{
    $db = $GLOBALS['db'] ?? null;
    if ($status >= 400 && ($GLOBALS['current_idempotency_operation'] ?? false) && $db instanceof TransactionalPDO) {
        $db->rollBackAll();
        $GLOBALS['current_idempotency_operation'] = false;
        $GLOBALS['current_idempotency_reservation_owned'] = false;
    }
    if ($status >= 200 && $status < 300) {
        storeIdempotentResponse($status, $payload);
        if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
            $notifyUserId = $GLOBALS['current_user_id'] ?? null;
            if (is_int($notifyUserId)) {
                notifyWebSocketUser($notifyUserId);
            }
        }
    } elseif (getIdempotencyRequestId() !== '') {
        releaseOwnedIdempotencyReservation();
        $payload['error_key'] = $payload['error_key'] ?? 'error.idempotency_replay_blocked';
    }

    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function requireMethod(string $expectedMethod): void
{
    if ($_SERVER['REQUEST_METHOD'] !== $expectedMethod) {
        header('Allow: ' . $expectedMethod);
        respond(405, ['error' => t('error.method_not_allowed', ['method' => $expectedMethod]), 'error_key' => 'error.method_not_allowed']);
    }
}

// Read-or-insert operations acquire the write lock before their first SELECT.
// TransactionalPDO turns nested use-case transactions into savepoints.
function beginImmediateTransaction(PDO $db): void
{
    $db->exec('BEGIN IMMEDIATE');
}

function commitImmediateTransaction(PDO $db): void
{
    $db->exec('COMMIT');
}

function rollBackImmediateTransaction(PDO $db): void
{
    $db->exec('ROLLBACK');
}

// Also supports plain PDO connections used by isolated helper tests.
function rollBackImmediateTransactionIfActive(PDO $db): void
{
    try {
        $db->exec('ROLLBACK');
    } catch (PDOException $error) {
        // Transaktion war bereits beendet — nichts zurueckzurollen.
    }
}

// ponytail: replaces the 4-line POST auth dance (method check + body read +
// CSRF for browser sessions). API key requests still skip CSRF as before.
function requireWriteRequest(): array
{
    requireMethod('POST');
    $data = requestData();
    if (!isApiKeyAuthRequest()) {
        requireCsrfToken($data);
    }
    replayIdempotentIfKnown($data);
    return $data;
}

function ensureUtf8(mixed $value): mixed
{
    if (is_string($value)) {
        if (!mb_check_encoding($value, 'UTF-8')) {
            $detectedEncoding = mb_detect_encoding($value, 'UTF-8, Windows-1252, ISO-8859-1', true) ?: 'Windows-1252';
            $value = mb_convert_encoding($value, 'UTF-8', $detectedEncoding);
        }

        return $value;
    }
    if (is_array($value)) {
        return array_map('ensureUtf8', $value);
    }
    return $value;
}

function requestData(): array
{
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && $_POST !== []) {
        return ensureUtf8($_POST);
    }

    $raw = file_get_contents('php://input');
    if (!$raw) {
        return [];
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function requestPath(string $path): string
{
    $scriptName = $_SERVER['SCRIPT_NAME'] ?? '';
    $directory = str_replace('\\', '/', dirname(is_string($scriptName) ? $scriptName : ''));

    if ($directory === '/' || $directory === '.') {
        $directory = '';
    }

    return $directory . '/' . ltrim($path, '/');
}

function truncateText(string $value, int $length): string
{
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $length);
    }

    return substr($value, 0, $length);
}

function normalizeWhitespace(string $value): string
{
    return trim(preg_replace('/\s+/u', ' ', $value) ?? '');
}
