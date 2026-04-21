<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';

enforceCanonicalRequest();
$userId = requireAuth();

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

function mediaShouldForceDownload(): bool
{
    $download = $_GET['download'] ?? null;

    if (is_array($download) || $download === null) {
        return false;
    }

    return in_array(strtolower(trim((string) $download)), ['1', 'true', 'yes', 'on'], true);
}

function mediaRequestedVariant(): string
{
    $variant = $_GET['variant'] ?? null;

    if (!is_string($variant)) {
        return 'original';
    }

    $variant = strtolower(trim($variant));
    return $variant === 'thumb' ? 'thumb' : 'original';
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
            categories.type AS category_type,
            attachments.storage_section,
            attachments.stored_name,
            attachments.original_name,
            attachments.media_type,
            attachments.size_bytes,
            attachments.updated_at
         FROM items
         INNER JOIN categories
            ON categories.id = items.category_id
         INNER JOIN attachments
            ON attachments.item_id = items.id
         WHERE items.id = :item_id
           AND items.user_id = :user_id
         LIMIT 1'
    );
    $stmt->execute([':item_id' => $itemId, ':user_id' => $userId]);
    $attachment = $stmt->fetch();

    if (!is_array($attachment)) {
        mediaFail(404, 'Datei nicht gefunden.');
    }

    $absolutePath = getAttachmentAbsolutePath($attachment);
    $variant = mediaRequestedVariant();

    if (
        $variant === 'thumb'
        && (string) ($attachment['storage_section'] ?? '') === 'images'
        && !mediaShouldForceDownload()
    ) {
        $thumbnailPath = getAttachmentThumbnailAbsolutePath($attachment);

        if (!is_file($thumbnailPath)) {
            @generateImageThumbnailFile($absolutePath, $thumbnailPath);
        }

        if (is_file($thumbnailPath)) {
            $absolutePath = $thumbnailPath;
            $attachment['media_type'] = 'image/jpeg';
            $attachment['original_name'] = preg_replace('/\.[^.]+$/', '', (string) ($attachment['original_name'] ?? 'bild')) . '.jpg';
        } else {
            mediaFail(404, 'Vorschaubild nicht gefunden.');
        }
    }

    if (!is_file($absolutePath)) {
        mediaFail(404, 'Datei nicht gefunden.');
    }

    $mediaType = trim((string) ($attachment['media_type'] ?? ''));
    if ($mediaType === '') {
        $mediaType = 'application/octet-stream';
    }

    $filename = mediaDispositionFilename((string) ($attachment['original_name'] ?? ''));
    $dispositionType = (($attachment['storage_section'] ?? '') === 'images' && !mediaShouldForceDownload())
        ? 'inline'
        : 'attachment';
    $fileSize = filesize($absolutePath);

    // ETag based on attachment updated_at + stored_name — changes only when the file is replaced.
    // Enables conditional GET (304 Not Modified) so browsers skip re-downloading unchanged files.
    // max-age raised from 60 s to 3600 s (1 h) since attachments rarely change; ETag handles
    // staleness detection on revalidation. Weak ETag (W/) because chunked transfer may differ.
    $etagValue = sprintf('W/"%s-%s"', (string) ($attachment['updated_at'] ?? ''), (string) ($attachment['stored_name'] ?? ''));
    $ifNoneMatch = $_SERVER['HTTP_IF_NONE_MATCH'] ?? null;

    header('Content-Type: ' . $mediaType);
    header('Content-Length: ' . (string) ($fileSize !== false ? $fileSize : (int) ($attachment['size_bytes'] ?? 0)));
    header('Content-Disposition: ' . $dispositionType . '; filename="' . addcslashes($filename, "\"\\") . '"; filename*=UTF-8\'\'' . rawurlencode($filename));
    header('Cache-Control: private, max-age=3600');
    header('ETag: ' . $etagValue);
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');

    // Return 304 if the client already has the current version — no body needed.
    if (is_string($ifNoneMatch) && trim($ifNoneMatch) === $etagValue) {
        http_response_code(304);
        exit;
    }

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
