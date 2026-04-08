<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';

enforceCanonicalRequest();

function mediaFail(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo $message;
    exit;
}

function mediaDispositionFilename(string $filename): string
{
    $filename = trim($filename);

    if ($filename === '') {
        return 'download';
    }

    $filename = str_replace(["\r", "\n"], '', $filename);
    return $filename;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method !== 'GET' && $method !== 'HEAD') {
    header('Allow: GET, HEAD');
    mediaFail(405, 'Nur GET und HEAD sind erlaubt.');
}

$itemId = filter_input(INPUT_GET, 'item_id', FILTER_VALIDATE_INT, [
    'options' => ['min_range' => 1],
]);

if (!is_int($itemId)) {
    mediaFail(422, 'Ungültige Item-ID.');
}

$db = getDatabase();

try {
    $stmt = $db->prepare(
        'SELECT
            items.id AS item_id,
            items.section AS item_section,
            attachments.storage_section,
            attachments.stored_name,
            attachments.original_name,
            attachments.media_type,
            attachments.size_bytes,
            attachments.updated_at
         FROM items
         INNER JOIN attachments
            ON attachments.item_id = items.id
           AND attachments.storage_section = items.section
         WHERE items.id = :item_id
         LIMIT 1'
    );
    $stmt->execute([':item_id' => $itemId]);
    $attachment = $stmt->fetch();

    if (!is_array($attachment)) {
        mediaFail(404, 'Datei nicht gefunden.');
    }

    $absolutePath = getAttachmentAbsolutePath($attachment);

    if (!is_file($absolutePath)) {
        mediaFail(404, 'Datei nicht gefunden.');
    }

    $mediaType = trim((string) ($attachment['media_type'] ?? ''));
    if ($mediaType === '') {
        $mediaType = 'application/octet-stream';
    }

    $filename = mediaDispositionFilename((string) ($attachment['original_name'] ?? ''));
    $dispositionType = ($attachment['storage_section'] ?? '') === 'images' ? 'inline' : 'attachment';
    $fileSize = filesize($absolutePath);

    header('Content-Type: ' . $mediaType);
    header('Content-Length: ' . (string) ($fileSize !== false ? $fileSize : (int) ($attachment['size_bytes'] ?? 0)));
    header('Content-Disposition: ' . $dispositionType . '; filename="' . addcslashes($filename, "\"\\") . '"; filename*=UTF-8\'\'' . rawurlencode($filename));
    header('Cache-Control: private, max-age=60');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');

    if ($method === 'HEAD') {
        exit;
    }

    $handle = fopen($absolutePath, 'rb');
    if ($handle === false) {
        mediaFail(500, 'Datei konnte nicht gelesen werden.');
    }

    while (!feof($handle)) {
        $chunk = fread($handle, 8192);
        if ($chunk === false) {
            fclose($handle);
            mediaFail(500, 'Datei konnte nicht gelesen werden.');
        }

        echo $chunk;
    }

    fclose($handle);
    exit;
} catch (Throwable $exception) {
    error_log(sprintf('Einkauf media error [item_id=%d]: %s', $itemId, $exception->getMessage()));
    mediaFail(500, 'Serverfehler.');
}
