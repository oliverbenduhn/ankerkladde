<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';

enforceCanonicalRequest();
startAppSession();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const VALID_SECTIONS = ['shopping', 'meds', 'todo_private', 'todo_work', 'notes', 'images', 'files', 'links'];
const UPLOADABLE_SECTIONS = ['images', 'files'];
const IMAGE_UPLOAD_MIME_TYPES = [
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
    'image/webp' => 'webp',
    'image/gif' => 'gif',
];
const IMAGE_UPLOAD_MAX_BYTES = 20971520;

function respond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function requireMethod(string $expectedMethod): void
{
    if ($_SERVER['REQUEST_METHOD'] !== $expectedMethod) {
        header('Allow: ' . $expectedMethod);
        respond(405, ['error' => sprintf('Nur %s ist für diese Aktion erlaubt.', $expectedMethod)]);
    }
}

function requestData(): array
{
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if ($_POST !== []) {
            return $_POST;
        }
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

function requireCsrfToken(array $data): void
{
    $providedToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($data['csrf_token'] ?? null);

    if (!hasValidCsrfToken(is_string($providedToken) ? $providedToken : null)) {
        respond(403, ['error' => 'Ungültiges Sicherheits-Token.']);
    }
}

function getSection(array $data = []): string
{
    $section = $_GET['section'] ?? ($data['section'] ?? 'shopping');
    if (!in_array($section, VALID_SECTIONS, true)) {
        respond(422, ['error' => 'Ungültige Sektion.']);
    }
    return (string) $section;
}

function normalizeName(?string $name): string
{
    $name = trim((string) $name);
    $name = preg_replace('/\s+/u', ' ', $name) ?? '';
    return truncateText($name, 120);
}

function normalizeQuantity(?string $quantity): string
{
    $quantity = trim((string) $quantity);
    $quantity = preg_replace('/\s+/u', ' ', $quantity) ?? '';
    return truncateText($quantity, 40);
}

function normalizeDueDate(?string $date): string
{
    $date = trim((string) $date);
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ? $date : '';
}

function sanitizeFtsQuery(string $q): string
{
    $q = trim($q);
    if ($q === '') {
        return '';
    }

    $words = array_values(array_filter(preg_split('/\s+/u', $q) ?: []));
    if ($words === []) {
        return '';
    }

    $parts = array_map(
        static fn(string $w): string => '"' . str_replace('"', '""', $w) . '"*',
        $words
    );

    return implode(' ', $parts);
}

function normalizeContent(?string $content): string
{
    return sanitizeRichTextHtml(truncateText(trim((string) $content), 102400));
}

function sanitizeRichTextHref(string $href): ?string
{
    $href = trim($href);
    if ($href === '') {
        return null;
    }

    if (preg_match('/^(https?:|mailto:|tel:)/i', $href) !== 1) {
        return null;
    }

    return $href;
}

function sanitizeRichTextHtmlFallback(string $html): string
{
    $html = preg_replace('#<(script|style)\b[^>]*>.*?</\1>#is', '', $html) ?? '';
    $html = preg_replace('/\son[a-z]+\s*=\s*(".*?"|\'.*?\'|[^\s>]+)/is', '', $html) ?? '';
    $html = preg_replace('/\sstyle\s*=\s*(".*?"|\'.*?\')/is', '', $html) ?? '';

    return strip_tags($html, '<p><br><strong><b><em><i><s><ul><ol><li><blockquote><pre><code><h1><h2><h3><a>');
}

function sanitizeRichTextNode(DOMNode $node, DOMDocument $document): void
{
    if ($node instanceof DOMComment) {
        $node->parentNode?->removeChild($node);
        return;
    }

    if (!($node instanceof DOMElement)) {
        foreach (iterator_to_array($node->childNodes) as $childNode) {
            sanitizeRichTextNode($childNode, $document);
        }
        return;
    }

    $allowedTags = ['p', 'br', 'strong', 'b', 'em', 'i', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'a'];
    $tagName = strtolower($node->tagName);

    if (!in_array($tagName, $allowedTags, true)) {
        $parentNode = $node->parentNode;
        if ($parentNode !== null) {
            while ($node->firstChild !== null) {
                $parentNode->insertBefore($node->firstChild, $node);
            }
            $parentNode->removeChild($node);
        }
        return;
    }

    foreach (iterator_to_array($node->attributes) as $attribute) {
        $attributeName = strtolower($attribute->nodeName);

        if ($tagName !== 'a' || !in_array($attributeName, ['href', 'target', 'rel'], true)) {
            $node->removeAttributeNode($attribute);
            continue;
        }

        if ($attributeName === 'href') {
            $sanitizedHref = sanitizeRichTextHref($attribute->nodeValue);
            if ($sanitizedHref === null) {
                $node->removeAttribute('href');
            } else {
                $node->setAttribute('href', $sanitizedHref);
            }
        }

        if ($attributeName === 'target' && strtolower($attribute->nodeValue) !== '_blank') {
            $node->removeAttribute('target');
        }
    }

    if ($tagName === 'a') {
        if ($node->hasAttribute('target')) {
            $node->setAttribute('rel', 'noopener noreferrer');
        } else {
            $node->removeAttribute('rel');
        }
    }

    foreach (iterator_to_array($node->childNodes) as $childNode) {
        sanitizeRichTextNode($childNode, $document);
    }
}

function sanitizeRichTextHtml(string $html): string
{
    if ($html === '') {
        return '';
    }

    if (!class_exists(DOMDocument::class)) {
        return sanitizeRichTextHtmlFallback($html);
    }

    $document = new DOMDocument('1.0', 'UTF-8');
    $previousUseInternalErrors = libxml_use_internal_errors(true);
    $loaded = $document->loadHTML(
        '<!DOCTYPE html><html><body>' . $html . '</body></html>',
        LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
    );
    libxml_clear_errors();
    libxml_use_internal_errors($previousUseInternalErrors);

    if (!$loaded) {
        return sanitizeRichTextHtmlFallback($html);
    }

    $body = $document->getElementsByTagName('body')->item(0);
    if (!$body instanceof DOMElement) {
        return sanitizeRichTextHtmlFallback($html);
    }

    foreach (iterator_to_array($body->childNodes) as $childNode) {
        sanitizeRichTextNode($childNode, $document);
    }

    $sanitized = '';
    foreach ($body->childNodes as $childNode) {
        $sanitized .= $document->saveHTML($childNode);
    }

    return trim($sanitized);
}

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

function normalizeStoredExtension(string $extension): string
{
    $extension = strtolower(trim($extension));
    $extension = preg_replace('/[^a-z0-9]+/', '', $extension) ?? '';

    return truncateText($extension, 16);
}

function nextSortOrder(PDO $db, string $section): int
{
    $maxStmt = $db->prepare('SELECT COALESCE(MAX(sort_order), 0) FROM items WHERE section = :section');
    $maxStmt->execute([':section' => $section]);
    return (int) $maxStmt->fetchColumn() + 1;
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
        UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => [413, 'Datei ist zu groß.'],
        UPLOAD_ERR_PARTIAL => [422, 'Datei wurde unvollständig hochgeladen.'],
        UPLOAD_ERR_NO_FILE => [422, 'Bitte wähle eine Datei aus.'],
        UPLOAD_ERR_NO_TMP_DIR, UPLOAD_ERR_CANT_WRITE, UPLOAD_ERR_EXTENSION => [500, 'Upload konnte nicht gespeichert werden.'],
        default => [422, 'Ungültiger Upload.'],
    };
}

function getSingleUploadedFile(): array
{
    if ($_FILES === []) {
        respond(422, ['error' => 'Bitte wähle eine Datei aus.']);
    }

    $candidate = $_FILES['file'] ?? $_FILES['attachment'] ?? $_FILES['upload'] ?? reset($_FILES);

    if (!is_array($candidate)) {
        respond(422, ['error' => 'Bitte wähle eine Datei aus.']);
    }

    if (is_array($candidate['error'] ?? null)) {
        respond(422, ['error' => 'Mehrere Dateien pro Request werden nicht unterstützt.']);
    }

    $errorCode = (int) ($candidate['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($errorCode !== UPLOAD_ERR_OK) {
        [$status, $message] = uploadedFileErrorMessage($errorCode);
        respond($status, ['error' => $message]);
    }

    $tmpName = (string) ($candidate['tmp_name'] ?? '');
    if ($tmpName === '' || !is_uploaded_file($tmpName)) {
        respond(422, ['error' => 'Ungültiger Upload.']);
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

function validateUploadSection(string $section): void
{
    if (!in_array($section, UPLOADABLE_SECTIONS, true)) {
        respond(422, ['error' => 'Uploads sind nur in den Sektionen Bilder und Dateien erlaubt.']);
    }
}

function validateImageUpload(array $uploadedFile): array
{
    if ((int) $uploadedFile['size_bytes'] > IMAGE_UPLOAD_MAX_BYTES) {
        respond(413, ['error' => 'Bilder dürfen maximal 20 MB groß sein.']);
    }

    $mediaType = detectMimeType((string) $uploadedFile['tmp_name']);
    $extension = IMAGE_UPLOAD_MIME_TYPES[$mediaType] ?? null;

    if (!is_string($extension)) {
        respond(422, ['error' => 'Nur JPG, PNG, WebP und GIF sind als Bilder erlaubt.']);
    }

    if (function_exists('getimagesize') && @getimagesize((string) $uploadedFile['tmp_name']) === false) {
        respond(422, ['error' => 'Die hochgeladene Datei ist kein gültiges Bild.']);
    }

    return [
        'media_type' => $mediaType,
        'stored_extension' => $extension,
    ];
}

const MIME_TYPE_EXTENSIONS = [
    'application/pdf'                                                          => 'pdf',
    'application/zip'                                                          => 'zip',
    'application/x-zip-compressed'                                             => 'zip',
    'application/gzip'                                                         => 'gz',
    'application/x-tar'                                                        => 'tar',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'  => 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'        => 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'=> 'pptx',
    'application/msword'                                                        => 'doc',
    'application/vnd.ms-excel'                                                  => 'xls',
    'application/vnd.ms-powerpoint'                                             => 'ppt',
    'text/plain'                                                                => 'txt',
    'text/csv'                                                                  => 'csv',
    'text/html'                                                                 => 'html',
    'audio/mpeg'                                                                => 'mp3',
    'audio/ogg'                                                                 => 'ogg',
    'audio/wav'                                                                 => 'wav',
    'audio/flac'                                                                => 'flac',
    'audio/mp4'                                                                 => 'm4a',
    'video/mp4'                                                                 => 'mp4',
    'video/webm'                                                                => 'webm',
    'video/quicktime'                                                           => 'mov',
    'video/x-matroska'                                                          => 'mkv',
    'video/x-msvideo'                                                           => 'avi',
];

function validateFileUpload(array $uploadedFile): array
{
    $pathInfoExtension = pathinfo((string) $uploadedFile['original_name'], PATHINFO_EXTENSION);
    $extension = normalizeStoredExtension(is_string($pathInfoExtension) ? $pathInfoExtension : '');

    $mediaType = detectMimeType((string) $uploadedFile['tmp_name']);

    if ($extension === '') {
        $extension = normalizeStoredExtension(MIME_TYPE_EXTENSIONS[$mediaType] ?? '');
    }

    return [
        'media_type'       => $mediaType,
        'stored_extension' => $extension,
    ];
}

function buildStoredFilename(string $section, string $extension): string
{
    $randomName = bin2hex(random_bytes(16));
    $suffix = $extension !== '' ? '.' . $extension : '';

    return $section . '-' . $randomName . $suffix;
}

function buildAttachmentPayload(array $item): ?array
{
    $section = (string) ($item['attachment_storage_section'] ?? '');
    $hasAttachment = (int) ($item['has_attachment'] ?? 0) === 1;

    if (!$hasAttachment || !isAttachmentSection($section)) {
        return null;
    }

    $baseUrl = requestPath('media.php?item_id=' . (int) $item['id']);

    return [
        'preview_url' => $section === 'images' ? $baseUrl : null,
        'download_url' => $baseUrl . '&download=1',
        'original_name' => (string) ($item['attachment_original_name'] ?? ''),
        'mime_type' => (string) ($item['attachment_media_type'] ?? 'application/octet-stream'),
        'size_bytes' => (int) ($item['attachment_size_bytes'] ?? 0),
    ];
}

function formatListItem(array $item): array
{
    $attachment = buildAttachmentPayload($item);

    return [
        'id' => (int) $item['id'],
        'name' => (string) ($item['name'] ?? ''),
        'quantity' => (string) ($item['quantity'] ?? ''),
        'due_date' => (string) ($item['due_date'] ?? ''),
        'is_pinned' => (int) ($item['is_pinned'] ?? 0),
        'content' => (string) ($item['content'] ?? ''),
        'section' => (string) ($item['section'] ?? ''),
        'done' => (int) ($item['done'] ?? 0),
        'sort_order' => (int) ($item['sort_order'] ?? 0),
        'created_at' => (string) ($item['created_at'] ?? ''),
        'updated_at' => (string) ($item['updated_at'] ?? ''),
        'has_attachment' => $attachment !== null ? 1 : 0,
        'attachment' => $attachment,
        'attachment_storage_section' => $attachment !== null ? (string) ($item['attachment_storage_section'] ?? '') : null,
        'attachment_original_name' => $attachment['original_name'] ?? null,
        'attachment_media_type' => $attachment['mime_type'] ?? null,
        'attachment_size_bytes' => $attachment['size_bytes'] ?? null,
        'attachment_url' => $attachment['preview_url'] ?? $attachment['download_url'] ?? null,
        'attachment_preview_url' => $attachment['preview_url'] ?? null,
        'attachment_download_url' => $attachment['download_url'] ?? null,
    ];
}

function normalizeIdList(mixed $ids): array
{
    if (!is_array($ids) || $ids === []) {
        return [];
    }

    $normalized = [];

    foreach ($ids as $rawId) {
        $id = filter_var($rawId, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1],
        ]);

        if ($id === false || $id === null) {
            return [];
        }

        $normalized[] = (int) $id;
    }

    if (count(array_unique($normalized)) !== count($normalized)) {
        return [];
    }

    return $normalized;
}

$action = $_GET['action'] ?? 'list';
$db = getDatabase();

try {
    switch ($action) {
        case 'list':
            requireMethod('GET');
            $section = getSection();

            $stmt = $db->prepare(
                'SELECT
                    items.id,
                    items.name,
                    items.quantity,
                    items.due_date,
                    items.is_pinned,
                    items.content,
                    items.section,
                    items.done,
                    items.sort_order,
                    items.created_at,
                    items.updated_at,
                    attachments.storage_section AS attachment_storage_section,
                    attachments.original_name AS attachment_original_name,
                    attachments.media_type AS attachment_media_type,
                    attachments.size_bytes AS attachment_size_bytes,
                    CASE WHEN attachments.id IS NULL THEN NULL ELSE "media.php?item_id=" || items.id END AS attachment_url,
                    CASE WHEN attachments.id IS NULL THEN 0 ELSE 1 END AS has_attachment
                 FROM items
                 LEFT JOIN attachments
                    ON attachments.item_id = items.id
                   AND attachments.storage_section = items.section
                 WHERE items.section = :section
                 ORDER BY items.is_pinned DESC, items.sort_order ASC, items.id ASC'
            );
            $stmt->execute([':section' => $section]);

            $items = array_map(
                static fn(array $item): array => formatListItem($item),
                $stmt->fetchAll()
            );

            $response = ['items' => $items];

            if (in_array($section, UPLOADABLE_SECTIONS, true)) {
                $freeBytes = disk_free_space(getDataDirectory());
                if ($freeBytes !== false) {
                    $response['disk_free_bytes'] = (int) $freeBytes;
                }
            }

            respond(200, $response);

        case 'add':
            requireMethod('POST');

            $data     = requestData();
            requireCsrfToken($data);
            $section  = getSection($data);
            $name     = normalizeName($data['name'] ?? null);
            $quantity = normalizeQuantity($data['quantity'] ?? null);
            $due_date = normalizeDueDate($data['due_date'] ?? null);
            $content  = normalizeContent($data['content'] ?? null);

            if ($name == '') {
                respond(422, ['error' => 'Bitte gib einen Artikelnamen ein.']);
            }

            $stmt = $db->prepare(
                'INSERT INTO items (name, quantity, due_date, content, section, sort_order)
                 VALUES (:name, :quantity, :due_date, :content, :section, :sort_order)'
            );
            $stmt->execute([
                ':name'       => $name,
                ':quantity'   => $quantity,
                ':due_date'   => $due_date,
                ':content'    => $content,
                ':section'    => $section,
                ':sort_order' => nextSortOrder($db, $section),
            ]);

            respond(201, [
                'message' => 'Artikel hinzugefügt.',
                'id'      => (int) $db->lastInsertId(),
            ]);

        case 'upload':
            requireMethod('POST');

            $data = requestData();
            requireCsrfToken($data);
            $section = getSection($data);
            validateUploadSection($section);

            $uploadedFile = getSingleUploadedFile();
            $uploadMeta = $section === 'images'
                ? validateImageUpload($uploadedFile)
                : validateFileUpload($uploadedFile);

            $name = normalizeName($data['name'] ?? null);
            if ($name === '') {
                $name = normalizeName((string) $uploadedFile['original_name']);
            }
            $quantity = normalizeQuantity($data['quantity'] ?? null);
            $content = normalizeContent($data['content'] ?? null);

            $replaceItemId = filter_var($data['item_id'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 1],
            ]);

            if ($replaceItemId !== false && $replaceItemId !== null) {
                // Replacement mode: swap the attachment of an existing item.
                $storedName = buildStoredFilename($section, (string) $uploadMeta['stored_extension']);
                $targetPath = getAttachmentStorageDirectory($section) . '/' . $storedName;
                $storedFileMoved = false;

                $db->beginTransaction();

                try {
                    $itemStmt = $db->prepare('SELECT id, section FROM items WHERE id = :id LIMIT 1');
                    $itemStmt->execute([':id' => $replaceItemId]);
                    $existingItem = $itemStmt->fetch();

                    if (!is_array($existingItem) || $existingItem['section'] !== $section) {
                        $db->rollBack();
                        respond(404, ['error' => 'Artikel nicht gefunden.']);
                    }

                    $oldAttachment = findAttachmentByItemId($db, (int) $replaceItemId);

                    if ($name !== '') {
                        $nameStmt = $db->prepare(
                            'UPDATE items SET name = :name, updated_at = CURRENT_TIMESTAMP WHERE id = :id'
                        );
                        $nameStmt->execute([':name' => $name, ':id' => $replaceItemId]);
                    }

                    if (!move_uploaded_file((string) $uploadedFile['tmp_name'], $targetPath)) {
                        throw new RuntimeException('Upload-Datei konnte nicht verschoben werden.');
                    }

                    $storedFileMoved = true;

                    $attachmentStmt = $db->prepare(
                        'INSERT INTO attachments (item_id, storage_section, stored_name, original_name, media_type, size_bytes)
                         VALUES (:item_id, :storage_section, :stored_name, :original_name, :media_type, :size_bytes)
                         ON CONFLICT(item_id) DO UPDATE SET
                            storage_section = excluded.storage_section,
                            stored_name     = excluded.stored_name,
                            original_name   = excluded.original_name,
                            media_type      = excluded.media_type,
                            size_bytes      = excluded.size_bytes,
                            updated_at      = CURRENT_TIMESTAMP'
                    );
                    $attachmentStmt->execute([
                        ':item_id'         => $replaceItemId,
                        ':storage_section' => $section,
                        ':stored_name'     => $storedName,
                        ':original_name'   => (string) $uploadedFile['original_name'],
                        ':media_type'      => (string) $uploadMeta['media_type'],
                        ':size_bytes'      => (int) $uploadedFile['size_bytes'],
                    ]);

                    $db->commit();

                    if ($oldAttachment !== null) {
                        deleteAttachmentStorageFile($oldAttachment);
                    }
                } catch (Throwable $exception) {
                    if ($db->inTransaction()) {
                        $db->rollBack();
                    }

                    if ($storedFileMoved && is_file($targetPath) && !unlink($targetPath)) {
                        error_log(sprintf('Einkauf upload replace cleanup error [%s]: %s', $section, $targetPath));
                    }

                    throw $exception;
                }

                respond(200, [
                    'message' => 'Anhang ersetzt.',
                    'id' => $replaceItemId,
                ]);
            }

            if ($name === '') {
                respond(422, ['error' => 'Bitte gib einen Artikelnamen ein.']);
            }

            $storedName = buildStoredFilename($section, (string) $uploadMeta['stored_extension']);
            $targetPath = getAttachmentStorageDirectory($section) . '/' . $storedName;
            $itemId = null;
            $storedFileMoved = false;

            $db->beginTransaction();

            try {
                $stmt = $db->prepare(
                    'INSERT INTO items (name, quantity, due_date, content, section, sort_order)
                     VALUES (:name, :quantity, :due_date, :content, :section, :sort_order)'
                );
                $stmt->execute([
                    ':name'     => $name,
                    ':quantity' => $quantity,
                    ':due_date' => normalizeDueDate($data['due_date'] ?? null),
                    ':content'  => $content,
                    ':section'  => $section,
                    ':sort_order' => nextSortOrder($db, $section),
                ]);
                $itemId = (int) $db->lastInsertId();

                if (!move_uploaded_file((string) $uploadedFile['tmp_name'], $targetPath)) {
                    throw new RuntimeException('Upload-Datei konnte nicht verschoben werden.');
                }

                $storedFileMoved = true;

                $attachmentStmt = $db->prepare(
                    'INSERT INTO attachments (item_id, storage_section, stored_name, original_name, media_type, size_bytes)
                     VALUES (:item_id, :storage_section, :stored_name, :original_name, :media_type, :size_bytes)'
                );
                $attachmentStmt->execute([
                    ':item_id' => $itemId,
                    ':storage_section' => $section,
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

                if ($storedFileMoved && is_file($targetPath) && !unlink($targetPath)) {
                    error_log(sprintf('Einkauf upload cleanup error [%s]: %s', $section, $targetPath));
                }

                throw $exception;
            }

            respond(201, [
                'message' => 'Upload gespeichert.',
                'id' => $itemId,
            ]);

        case 'toggle':
            requireMethod('POST');

            $data = requestData();
            requireCsrfToken($data);
            $id   = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT);
            $done = filter_var($data['done'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 0, 'max_range' => 1],
            ]);

            if (!$id || $done === false || $done === null) {
                respond(422, ['error' => 'Ungültige Parameter für den Statuswechsel.']);
            }

            $stmt = $db->prepare(
                'UPDATE items SET done = :done, updated_at = CURRENT_TIMESTAMP WHERE id = :id'
            );
            $stmt->execute([':done' => $done, ':id' => $id]);

            if ($stmt->rowCount() === 0) {
                respond(404, ['error' => 'Artikel nicht gefunden.']);
            }

            respond(200, ['message' => 'Status aktualisiert.']);

        case 'update':
            requireMethod('POST');

            $data     = requestData();
            requireCsrfToken($data);
            $id       = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 1],
            ]);
            $name     = normalizeName($data['name'] ?? null);
            $quantity = normalizeQuantity($data['quantity'] ?? null);
            $due_date = normalizeDueDate($data['due_date'] ?? null);
            $content  = normalizeContent($data['content'] ?? null);

            if (!$id) {
                respond(422, ['error' => 'Ungültige ID.']);
            }

            if ($name === '') {
                respond(422, ['error' => 'Bitte gib einen Artikelnamen ein.']);
            }

            $stmt = $db->prepare(
                'UPDATE items
                 SET name = :name, quantity = :quantity, due_date = :due_date,
                     content = :content, updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id'
            );
            $stmt->execute([
                ':id'       => $id,
                ':name'     => $name,
                ':quantity' => $quantity,
                ':due_date' => $due_date,
                ':content'  => $content,
            ]);

            if ($stmt->rowCount() === 0) {
                $existsStmt = $db->prepare('SELECT 1 FROM items WHERE id = :id');
                $existsStmt->execute([':id' => $id]);

                if ($existsStmt->fetchColumn() === false) {
                    respond(404, ['error' => 'Artikel nicht gefunden.']);
                }
            }

            respond(200, ['message' => 'Artikel aktualisiert.']);

        case 'delete':
            requireMethod('POST');

            $data = requestData();
            requireCsrfToken($data);
            $id   = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT);
            if (!$id) {
                respond(422, ['error' => 'Ungültige ID.']);
            }

            $attachment = findAttachmentByItemId($db, (int) $id);

            $db->beginTransaction();
            $stmt = $db->prepare('DELETE FROM items WHERE id = :id');
            $stmt->execute([':id' => $id]);

            if ($stmt->rowCount() === 0) {
                $db->rollBack();
                respond(404, ['error' => 'Artikel nicht gefunden.']);
            }

            $db->commit();

            if ($attachment !== null) {
                try {
                    deleteAttachmentStorageFile($attachment);
                } catch (Throwable $cleanupException) {
                    error_log(sprintf('Einkauf attachment cleanup error [delete:%d]: %s', $id, $cleanupException->getMessage()));
                }
            }

            respond(200, ['message' => 'Artikel gelöscht.']);

        case 'clear':
            requireMethod('POST');

            $data    = requestData();
            requireCsrfToken($data);
            $section = getSection($data);

            $attachmentStmt = $db->prepare(
                'SELECT attachments.id, attachments.item_id, attachments.storage_section, attachments.stored_name
                 FROM attachments
                 INNER JOIN items
                    ON items.id = attachments.item_id
                 WHERE items.done = 1
                   AND items.section = :section'
            );
            $attachmentStmt->execute([':section' => $section]);
            $attachments = $attachmentStmt->fetchAll();

            $db->beginTransaction();
            $stmt = $db->prepare('DELETE FROM items WHERE done = 1 AND section = :section');
            $stmt->execute([':section' => $section]);
            $deletedCount = (int) $stmt->rowCount();
            $db->commit();

            foreach ($attachments as $attachment) {
                try {
                    deleteAttachmentStorageFile($attachment);
                } catch (Throwable $cleanupException) {
                    error_log(sprintf('Einkauf attachment cleanup error [clear:%s:%d]: %s', $section, (int) ($attachment['item_id'] ?? 0), $cleanupException->getMessage()));
                }
            }

            respond(200, [
                'message' => 'Erledigte Artikel gelöscht.',
                'deleted' => $deletedCount,
            ]);

        case 'reorder':
            requireMethod('POST');

            $data    = requestData();
            requireCsrfToken($data);
            $section = getSection($data);
            $ids     = normalizeIdList($data['ids'] ?? null);

            if ($ids === []) {
                respond(422, ['error' => 'Ungültige Reihenfolge.']);
            }

            $existingStmt = $db->prepare(
                'SELECT id FROM items WHERE section = :section ORDER BY sort_order ASC, id ASC'
            );
            $existingStmt->execute([':section' => $section]);
            $existingIds = array_map(
                static fn(mixed $id): int => (int) $id,
                $existingStmt->fetchAll(PDO::FETCH_COLUMN)
            );

            sort($ids);
            $sortedExistingIds = $existingIds;
            sort($sortedExistingIds);

            if ($ids !== $sortedExistingIds) {
                respond(422, ['error' => 'Reihenfolge passt nicht zur aktuellen Liste.']);
            }

            $orderedIds = normalizeIdList($data['ids'] ?? null);
            $stmt = $db->prepare(
                'UPDATE items
                 SET sort_order = :sort_order, updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id'
            );

            $db->beginTransaction();

            foreach ($orderedIds as $index => $id) {
                $stmt->execute([
                    ':sort_order' => $index + 1,
                    ':id'         => $id,
                ]);
            }

            $db->commit();

            respond(200, ['message' => 'Reihenfolge aktualisiert.']);

        case 'pin':
            requireMethod('POST');

            $data      = requestData();
            requireCsrfToken($data);
            $id        = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT);
            $is_pinned = filter_var($data['is_pinned'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 0, 'max_range' => 1],
            ]);

            if (!$id || $is_pinned === false || $is_pinned === null) {
                respond(422, ['error' => 'Ungültige Parameter.']);
            }

            $stmt = $db->prepare(
                'UPDATE items SET is_pinned = :is_pinned, updated_at = CURRENT_TIMESTAMP WHERE id = :id'
            );
            $stmt->execute([':is_pinned' => $is_pinned, ':id' => $id]);

            if ($stmt->rowCount() === 0) {
                respond(404, ['error' => 'Artikel nicht gefunden.']);
            }

            respond(200, ['message' => 'Pinned-Status aktualisiert.']);

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
                    items.name,
                    items.quantity,
                    items.due_date,
                    items.is_pinned,
                    items.content,
                    items.section,
                    items.done,
                    items.sort_order,
                    items.created_at,
                    items.updated_at,
                    attachments.storage_section AS attachment_storage_section,
                    attachments.original_name AS attachment_original_name,
                    attachments.media_type AS attachment_media_type,
                    attachments.size_bytes AS attachment_size_bytes,
                    CASE WHEN attachments.id IS NULL THEN NULL ELSE "media.php?item_id=" || items.id END AS attachment_url,
                    CASE WHEN attachments.id IS NULL THEN 0 ELSE 1 END AS has_attachment
                 FROM items_fts
                 INNER JOIN items ON items.id = items_fts.rowid
                 LEFT JOIN attachments
                    ON attachments.item_id = items.id
                   AND attachments.storage_section = items.section
                 WHERE items_fts MATCH :q
                 ORDER BY rank
                 LIMIT 50'
            );
            $stmt->execute([':q' => $ftsQuery]);

            $items = array_map(
                static fn(array $item): array => formatListItem($item),
                $stmt->fetchAll()
            );

            respond(200, ['items' => $items]);

        default:
            respond(404, ['error' => 'Unbekannte Aktion.']);
    }
} catch (Throwable $exception) {
    if ($db instanceof PDO && $db->inTransaction()) {
        $db->rollBack();
    }

    error_log(sprintf(
        'Einkauf API error [action=%s section=%s method=%s ip=%s]: %s',
        (string) $action,
        (string) ($section ?? ''),
        (string) ($_SERVER['REQUEST_METHOD'] ?? ''),
        (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
        (string) $exception
    ));
    respond(500, ['error' => 'Serverfehler.']);
}
