<?php
declare(strict_types=1);

const IMAGE_UPLOAD_MIME_TYPES = [
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
    'image/webp' => 'webp',
    'image/gif' => 'gif',
];
const MIME_TYPE_EXTENSIONS = [
    'application/pdf' => 'pdf',
    'application/zip' => 'zip',
    'application/x-zip-compressed' => 'zip',
    'application/gzip' => 'gz',
    'application/x-tar' => 'tar',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' => 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation' => 'pptx',
    'application/msword' => 'doc',
    'application/vnd.ms-excel' => 'xls',
    'application/vnd.ms-powerpoint' => 'ppt',
    'text/plain' => 'txt',
    'text/csv' => 'csv',
    'text/html' => 'html',
    'audio/mpeg' => 'mp3',
    'audio/ogg' => 'ogg',
    'audio/wav' => 'wav',
    'audio/flac' => 'flac',
    'audio/mp4' => 'm4a',
    'video/mp4' => 'mp4',
    'video/webm' => 'webm',
    'video/quicktime' => 'mov',
    'video/x-matroska' => 'mkv',
    'video/x-msvideo' => 'avi',
];
const REMOTE_FILE_IMPORT_TIMEOUT_SECONDS = 7200;

function normalizeOriginalFilename(?string $filename): string
{
    $filename = trim((string) $filename);
    $filename = str_replace(["\r", "\n", "\0"], '', $filename);
    $filename = preg_replace('/[\/\\\\]+/', ' ', $filename) ?? '';
    $filename = preg_replace('/\s+/u', ' ', $filename) ?? '';
    $filename = trim($filename, " .\t");

    if ($filename === '') {
        return 'upload';
    }

    return truncateText($filename, 255);
}

function getProductCatalogDatasets(): array
{
    return ['food', 'beauty', 'petfood', 'products'];
}

function getProductCatalogTableName(string $dataset): string
{
    if (!in_array($dataset, getProductCatalogDatasets(), true)) {
        throw new InvalidArgumentException('Ungültiges Produkt-Dataset.');
    }

    return 'product_catalog_' . $dataset;
}

function quoteSqlIdentifier(string $identifier): string
{
    return '"' . str_replace('"', '""', $identifier) . '"';
}

function normalizeStoredExtension(string $extension): string
{
    $extension = strtolower(trim($extension));
    $extension = preg_replace('/[^a-z0-9]+/', '', $extension) ?? '';

    return truncateText($extension, 16);
}

function detectMimeType(string $path): string
{
    $mediaType = '';

    if (class_exists('finfo')) {
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $detected = $finfo->file($path);
        if (is_string($detected) && trim($detected) !== '') {
            $mediaType = trim($detected);
        }
    }

    if ($mediaType === '' && function_exists('mime_content_type')) {
        $detected = mime_content_type($path);
        if (is_string($detected) && trim($detected) !== '') {
            $mediaType = trim($detected);
        }
    }

    if ($mediaType === '' && function_exists('getimagesize')) {
        $info = @getimagesize($path);
        if (is_array($info) && isset($info['mime']) && is_string($info['mime']) && $info['mime'] !== '') {
            $mediaType = $info['mime'];
        }
    }

    return $mediaType !== '' ? $mediaType : 'application/octet-stream';
}

function uploadedFileErrorMessage(int $errorCode): array
{
    return match ($errorCode) {
        UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => [413, t('error.upload_too_large'), 'error.upload_too_large'],
        UPLOAD_ERR_PARTIAL => [422, t('error.upload_partial'), 'error.upload_partial'],
        UPLOAD_ERR_NO_FILE => [422, t('error.file_required'), 'error.file_required'],
        UPLOAD_ERR_NO_TMP_DIR, UPLOAD_ERR_CANT_WRITE, UPLOAD_ERR_EXTENSION => [500, t('error.upload_save_failed'), 'error.upload_save_failed'],
        default => [422, t('error.invalid_upload'), 'error.invalid_upload'],
    };
}

function activeUploadLimits(): array
{
    static $limits = null;

    if ($limits === null) {
        $limits = getUploadLimitSettings(getDatabase());
    }

    return $limits;
}

function activeUploadLimitBytes(string $key): int
{
    $limits = activeUploadLimits();
    $megabytes = (int) ($limits[$key] ?? DEFAULT_UPLOAD_LIMITS_MB[$key] ?? 1);

    return uploadLimitMegabytesToBytes($megabytes);
}

function formatBytesForMessage(int $bytes): string
{
    if ($bytes >= 1073741824) {
        $value = $bytes / 1073741824;
        return (floor($value) == $value ? (int) $value : round($value, 1)) . ' GB';
    }
    if ($bytes >= 1048576) {
        $value = $bytes / 1048576;
        return (floor($value) == $value ? (int) $value : round($value, 1)) . ' MB';
    }
    if ($bytes >= 1024) {
        $value = $bytes / 1024;
        return (floor($value) == $value ? (int) $value : round($value, 1)) . ' KB';
    }

    return $bytes . ' B';
}

function getSingleUploadedFile(): array
{
    if ($_FILES === []) {
        respond(422, ['error' => t('error.file_required'), 'error_key' => 'error.file_required']);
    }

    $candidate = $_FILES['file'] ?? $_FILES['attachment'] ?? $_FILES['upload'] ?? reset($_FILES);

    if (!is_array($candidate)) {
        respond(422, ['error' => t('error.file_required'), 'error_key' => 'error.file_required']);
    }

    if (is_array($candidate['error'] ?? null)) {
        respond(422, ['error' => t('error.multiple_files'), 'error_key' => 'error.multiple_files']);
    }

    $errorCode = (int) ($candidate['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($errorCode !== UPLOAD_ERR_OK) {
        [$status, $message, $errorKey] = uploadedFileErrorMessage($errorCode);
        respond($status, ['error' => $message, 'error_key' => $errorKey]);
    }

    $tmpName = (string) ($candidate['tmp_name'] ?? '');
    if ($tmpName === '' || !is_uploaded_file($tmpName)) {
        respond(422, ['error' => t('error.invalid_upload'), 'error_key' => 'error.invalid_upload']);
    }

    $sizeBytes = filter_var($candidate['size'] ?? null, FILTER_VALIDATE_INT, [
        'options' => ['min_range' => 0],
    ]);

    if (!is_int($sizeBytes)) {
        $actualSize = filesize($tmpName);
        $sizeBytes = $actualSize !== false ? $actualSize : 0;
    }

    return [
        'tmp_name' => $tmpName,
        'size_bytes' => $sizeBytes,
        'original_name' => normalizeOriginalFilename((string) ($candidate['name'] ?? '')),
    ];
}

function validateImageUpload(array $uploadedFile): array
{
    $maxBytes = activeUploadLimitBytes('image_upload_max_mb');
    if ((int) $uploadedFile['size_bytes'] > $maxBytes) {
        respond(413, ['error' => t('error.image_too_large', ['max' => formatBytesForMessage($maxBytes)]), 'error_key' => 'error.image_too_large']);
    }

    $mediaType = detectMimeType((string) $uploadedFile['tmp_name']);
    $extension = IMAGE_UPLOAD_MIME_TYPES[$mediaType] ?? null;

    if (!is_string($extension)) {
        respond(422, ['error' => t('error.image_type_invalid'), 'error_key' => 'error.image_type_invalid']);
    }

    if (function_exists('getimagesize') && @getimagesize((string) $uploadedFile['tmp_name']) === false) {
        respond(422, ['error' => t('error.image_corrupt'), 'error_key' => 'error.image_corrupt']);
    }

    return [
        'media_type' => $mediaType,
        'stored_extension' => $extension,
    ];
}

function validateFileUpload(array $uploadedFile, string $limitKey = 'file_upload_max_mb'): array
{
    $maxBytes = activeUploadLimitBytes($limitKey);
    if ((int) $uploadedFile['size_bytes'] > $maxBytes) {
        respond(413, ['error' => t('error.file_too_large', ['max' => formatBytesForMessage($maxBytes)]), 'error_key' => 'error.file_too_large']);
    }

    $pathInfoExtension = pathinfo((string) $uploadedFile['original_name'], PATHINFO_EXTENSION);
    $extension = normalizeStoredExtension(is_string($pathInfoExtension) ? $pathInfoExtension : '');
    $mediaType = detectMimeType((string) $uploadedFile['tmp_name']);

    $mediaType = normalizeAttachmentMediaType($mediaType, (string) $uploadedFile['original_name']);

    if ($extension === '') {
        $extension = normalizeStoredExtension(MIME_TYPE_EXTENSIONS[$mediaType] ?? '');
    }

    return [
        'media_type' => $mediaType,
        'stored_extension' => $extension,
    ];
}

function validateSsrfSafeUrl(string $url): void
{
    if ($url === '' || !isAllowedRemoteUrl($url)) {
        respond(422, ['error' => t('error.url_not_allowed'), 'error_key' => 'error.url_not_allowed']);
    }
}

function extractFilenameFromUrl(string $url): string
{
    $path = parse_url($url, PHP_URL_PATH);
    $filename = is_string($path) ? basename(rawurldecode($path)) : '';

    return normalizeOriginalFilename($filename);
}

function extractFilenameFromContentDisposition(string $header): string
{
    if (preg_match('/filename\*=UTF-8\'\'([^;]+)/i', $header, $matches) === 1) {
        return normalizeOriginalFilename(rawurldecode(trim($matches[1], " \t\"")));
    }

    if (preg_match('/filename="([^"]+)"/i', $header, $matches) === 1) {
        return normalizeOriginalFilename($matches[1]);
    }

    if (preg_match('/filename=([^;]+)/i', $header, $matches) === 1) {
        return normalizeOriginalFilename(trim($matches[1], " \t\""));
    }

    return '';
}

function downloadRemoteFile(string $url): array
{
    validateSsrfSafeUrl($url);
    @set_time_limit(0);

    $tmpPath = tempnam(sys_get_temp_dir(), 'ankerkladde-url-');
    if ($tmpPath === false) {
        return ['error' => 'Temporäre Datei konnte nicht angelegt werden.'];
    }

    $contentType = '';
    $originalName = extractFilenameFromUrl($url);
    $maxBytes = activeUploadLimitBytes('remote_file_import_max_mb');

    if (function_exists('curl_init')) {
        $handle = @fopen($tmpPath, 'wb');
        if ($handle === false) {
            @unlink($tmpPath);
            return ['error' => 'Temporäre Datei konnte nicht geöffnet werden.'];
        }

        $headers = [];
        $abortedDueToSize = false;
        $ch = curl_init($url);
        if ($ch === false) {
            fclose($handle);
            @unlink($tmpPath);
            return ['error' => 'Download konnte nicht gestartet werden.'];
        }

        curl_setopt_array($ch, [
            CURLOPT_FILE => $handle,
            // Do not auto-follow redirects: a public URL could redirect to a private host.
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => REMOTE_FILE_IMPORT_TIMEOUT_SECONDS,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_NOPROGRESS => false,
            CURLOPT_PROGRESSFUNCTION => static function ($resource, float $downloadTotal, float $downloadNow) use ($maxBytes, &$abortedDueToSize): int {
                $abortedDueToSize = $downloadNow > $maxBytes || $downloadTotal > $maxBytes;
                return $abortedDueToSize ? 1 : 0;
            },
            CURLOPT_HEADERFUNCTION => static function ($resource, string $headerLine) use (&$headers): int {
                $trimmed = trim($headerLine);
                if ($trimmed !== '' && str_contains($trimmed, ':')) {
                    [$name, $value] = explode(':', $trimmed, 2);
                    $headers[strtolower(trim($name))] = trim($value);
                }
                return strlen($headerLine);
            },
        ]);

        $ok = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $curlErrno = curl_errno($ch);
        $error = curl_error($ch);
        fclose($handle);

        $sizeBytes = filesize($tmpPath);
        $sizeBytes = $sizeBytes !== false ? $sizeBytes : 0;

        if ($ok === false || $status < 200 || $status >= 300) {
            @unlink($tmpPath);
            if ($abortedDueToSize || (defined('CURLE_ABORTED_BY_CALLBACK') && $curlErrno === CURLE_ABORTED_BY_CALLBACK)) {
                return ['error' => t('error.file_too_large', ['max' => formatBytesForMessage($maxBytes)]), 'error_key' => 'error.file_too_large'];
            }
            return ['error' => $error !== '' ? $error : t('error.page_unreachable'), 'error_key' => 'error.page_unreachable'];
        }
        if ($sizeBytes > $maxBytes) {
            @unlink($tmpPath);
            return ['error' => t('error.file_too_large', ['max' => formatBytesForMessage($maxBytes)]), 'error_key' => 'error.file_too_large'];
        }

        $contentType = preg_replace('/;.*$/', '', (string) ($headers['content-type'] ?? '')) ?? '';
        if (isset($headers['content-disposition'])) {
            $headerName = extractFilenameFromContentDisposition((string) $headers['content-disposition']);
            if ($headerName !== '') {
                $originalName = $headerName;
            }
        }

        return [
            'tmp_path' => $tmpPath,
            'size_bytes' => $sizeBytes,
            'original_name' => $originalName,
            'content_type' => $contentType,
        ];
    }

    $source = @fopen($url, 'rb', false, stream_context_create([
        'http' => ['follow_location' => 0, 'max_redirects' => 0, 'timeout' => REMOTE_FILE_IMPORT_TIMEOUT_SECONDS],
        'https' => ['follow_location' => 0, 'max_redirects' => 0, 'timeout' => REMOTE_FILE_IMPORT_TIMEOUT_SECONDS],
    ]));
    $target = @fopen($tmpPath, 'wb');
    if ($source === false || $target === false) {
        if (is_resource($source)) fclose($source);
        if (is_resource($target)) fclose($target);
        @unlink($tmpPath);
        return ['error' => 'Datei konnte nicht geladen werden.'];
    }

    $sizeBytes = 0;
    while (!feof($source)) {
        $chunk = fread($source, 1048576);
        if ($chunk === false) break;
        $sizeBytes += strlen($chunk);
        if ($sizeBytes > $maxBytes) {
            fclose($source);
            fclose($target);
            @unlink($tmpPath);
            return ['error' => t('error.file_too_large', ['max' => formatBytesForMessage($maxBytes)]), 'error_key' => 'error.file_too_large'];
        }
        fwrite($target, $chunk);
    }
    fclose($source);
    fclose($target);

    return [
        'tmp_path' => $tmpPath,
        'size_bytes' => $sizeBytes,
        'original_name' => $originalName,
        'content_type' => $contentType,
    ];
}

function buildStoredFilename(string $type, string $extension): string
{
    $randomName = bin2hex(random_bytes(16));
    $suffix = $extension !== '' ? '.' . $extension : '';

    return $type . '-' . $randomName . $suffix;
}
