<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require __DIR__ . '/theme.php';

enforceCanonicalRequest();
startAppSession();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const IMAGE_UPLOAD_MIME_TYPES = [
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
    'image/webp' => 'webp',
    'image/gif' => 'gif',
];
const IMAGE_UPLOAD_MAX_BYTES = 20971520;
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
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && $_POST !== []) {
        return $_POST;
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

function normalizeIdList(mixed $ids): array
{
    if (!is_array($ids) || $ids === []) {
        return [];
    }

    $normalized = [];

    foreach ($ids as $rawId) {
        $id = filter_var($rawId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

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

function validateFileUpload(array $uploadedFile): array
{
    $pathInfoExtension = pathinfo((string) $uploadedFile['original_name'], PATHINFO_EXTENSION);
    $extension = normalizeStoredExtension(is_string($pathInfoExtension) ? $pathInfoExtension : '');
    $mediaType = detectMimeType((string) $uploadedFile['tmp_name']);

    if ($extension === '') {
        $extension = normalizeStoredExtension(MIME_TYPE_EXTENSIONS[$mediaType] ?? '');
    }

    return [
        'media_type' => $mediaType,
        'stored_extension' => $extension,
    ];
}

function buildStoredFilename(string $type, string $extension): string
{
    $randomName = bin2hex(random_bytes(16));
    $suffix = $extension !== '' ? '.' . $extension : '';

    return $type . '-' . $randomName . $suffix;
}

function resolveCategoryId(array $data, PDO $db, int $userId): int
{
    $categoryId = filter_var($_GET['category_id'] ?? ($data['category_id'] ?? null), FILTER_VALIDATE_INT, [
        'options' => ['min_range' => 1],
    ]);

    if (is_int($categoryId)) {
        return $categoryId;
    }

    $legacySection = $_GET['section'] ?? ($data['section'] ?? null);
    if (!is_string($legacySection) || trim($legacySection) === '') {
        $preferences = getExtendedUserPreferences($db, $userId);
        $preferredCategoryId = filter_var($preferences['last_category_id'] ?? null, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1],
        ]);

        if (is_int($preferredCategoryId) && loadUserCategory($db, $userId, $preferredCategoryId) !== null) {
            return $preferredCategoryId;
        }

        $categories = loadUserCategories($db, $userId, false);
        if ($categories !== []) {
            return (int) $categories[0]['id'];
        }

        respond(404, ['error' => 'Kategorie nicht gefunden.']);
    }

    $definition = legacyCategoryDefinition(trim($legacySection));
    if ($definition === null) {
        respond(422, ['error' => 'Ungültige Kategorie.']);
    }

    $stmt = $db->prepare(
        'SELECT id FROM categories
         WHERE user_id = :user_id AND legacy_key = :legacy_key
         ORDER BY id ASC
         LIMIT 1'
    );
    $stmt->execute([
        ':user_id' => $userId,
        ':legacy_key' => trim($legacySection),
    ]);
    $categoryId = $stmt->fetchColumn();

    if ($categoryId === false) {
        respond(404, ['error' => 'Kategorie nicht gefunden.']);
    }

    return (int) $categoryId;
}

function requireCategory(array $data, PDO $db, int $userId): array
{
    $categoryId = resolveCategoryId($data, $db, $userId);
    $category = loadUserCategory($db, $userId, $categoryId);

    if ($category === null) {
        respond(404, ['error' => 'Kategorie nicht gefunden.']);
    }

    return $category;
}

function validateCategoryType(array $category, array $allowedTypes, string $message): void
{
    if (!in_array((string) $category['type'], $allowedTypes, true)) {
        respond(422, ['error' => $message]);
    }
}

function buildAttachmentPayload(array $item): ?array
{
    $section = (string) ($item['attachment_storage_section'] ?? '');
    $hasAttachment = (int) ($item['has_attachment'] ?? 0) === 1;

    if (!$hasAttachment || !isAttachmentCategoryType($section)) {
        return null;
    }

    $baseUrl = requestPath('media.php?item_id=' . (int) $item['id']);
    $versionSource = '';

    if ($section === 'images' && !empty($item['attachment_stored_name'])) {
        $thumbnailPath = getAttachmentThumbnailAbsolutePath([
            'storage_section' => $section,
            'stored_name' => (string) $item['attachment_stored_name'],
        ]);
        $thumbnailMtime = is_file($thumbnailPath) ? @filemtime($thumbnailPath) : false;
        if (is_int($thumbnailMtime) && $thumbnailMtime > 0) {
            $versionSource = 'thumb-' . $thumbnailMtime;
        }
    }

    if ($versionSource === '') {
        $versionSource = (string) ($item['attachment_updated_at'] ?? '');
    }
    if ($versionSource === '') {
        $versionSource = (string) ($item['attachment_stored_name'] ?? '');
    }
    $versionQuery = $versionSource !== '' ? '&v=' . rawurlencode($versionSource) : '';

    return [
        'preview_url' => $section === 'images' ? $baseUrl . '&variant=thumb' . $versionQuery : null,
        'original_url' => $section === 'images' ? $baseUrl : $baseUrl . '&download=1' . $versionQuery,
        'download_url' => $baseUrl . '&download=1' . $versionQuery,
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
        'category_id' => (int) ($item['category_id'] ?? 0),
        'category_name' => (string) ($item['category_name'] ?? ''),
        'category_type' => (string) ($item['category_type'] ?? ''),
        'name' => (string) ($item['name'] ?? ''),
        'barcode' => (string) ($item['barcode'] ?? ''),
        'quantity' => (string) ($item['quantity'] ?? ''),
        'due_date' => (string) ($item['due_date'] ?? ''),
        'is_pinned' => (int) ($item['is_pinned'] ?? 0),
        'content' => (string) ($item['content'] ?? ''),
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
        'attachment_original_url' => $attachment['original_url'] ?? null,
        'attachment_download_url' => $attachment['download_url'] ?? null,
    ];
}

function fetchItemForUser(PDO $db, int $userId, int $itemId): ?array
{
    $stmt = $db->prepare(
        'SELECT
            items.id,
            items.category_id,
            categories.name AS category_name,
            categories.type AS category_type,
            items.name,
            items.barcode,
            items.quantity,
            items.due_date,
            items.is_pinned,
            items.content,
            items.done,
            items.sort_order,
            items.created_at,
            items.updated_at,
            attachments.storage_section AS attachment_storage_section,
            attachments.stored_name AS attachment_stored_name,
            attachments.original_name AS attachment_original_name,
            attachments.media_type AS attachment_media_type,
            attachments.size_bytes AS attachment_size_bytes,
            attachments.updated_at AS attachment_updated_at,
            CASE WHEN attachments.id IS NULL THEN 0 ELSE 1 END AS has_attachment
         FROM items
         INNER JOIN categories ON categories.id = items.category_id
         LEFT JOIN attachments ON attachments.item_id = items.id
         WHERE items.id = :id AND items.user_id = :user_id
         LIMIT 1'
    );
    $stmt->execute([':id' => $itemId, ':user_id' => $userId]);
    $item = $stmt->fetch();

    return is_array($item) ? $item : null;
}

$action = $_GET['action'] ?? 'list';
$db = getDatabase();
$userId = requireApiAuthWithKey($db);

try {
    switch ($action) {
        case 'categories_list':
            requireMethod('GET');
            respond(200, [
                'categories' => loadUserCategories($db, $userId),
                'preferences' => getExtendedUserPreferences($db, $userId),
            ]);

        case 'categories_create':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $name = normalizeName($data['name'] ?? null);
            $type = trim((string) ($data['type'] ?? ''));

            if ($name === '') {
                respond(422, ['error' => 'Bitte gib einen Kategorienamen ein.']);
            }

            if (!in_array($type, CATEGORY_TYPES, true)) {
                respond(422, ['error' => 'Ungültiger Kategorietyp.']);
            }

            $icon = normalizeCategoryIcon($data['icon'] ?? null, $type);

            $stmt = $db->prepare(
                'INSERT INTO categories (user_id, name, type, icon, sort_order, is_hidden)
                 VALUES (:user_id, :name, :type, :icon, :sort_order, 0)'
            );
            $stmt->execute([
                ':user_id' => $userId,
                ':name' => $name,
                ':type' => $type,
                ':icon' => $icon,
                ':sort_order' => nextCategorySortOrder($db, $userId),
            ]);

            $categoryId = (int) $db->lastInsertId();
            updateExtendedUserPreferences($db, $userId, ['last_category_id' => $categoryId]);

            respond(201, [
                'message' => 'Kategorie erstellt.',
                'category' => loadUserCategory($db, $userId, $categoryId),
            ]);

        case 'categories_update':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $categoryId = filter_var($data['category_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if (!is_int($categoryId)) {
                respond(422, ['error' => 'Ungültige Kategorie.']);
            }

            $category = loadUserCategory($db, $userId, $categoryId);
            if ($category === null) {
                respond(404, ['error' => 'Kategorie nicht gefunden.']);
            }

            $patches = [];
            $params = [':id' => $categoryId, ':user_id' => $userId];

            if (array_key_exists('name', $data)) {
                $name = normalizeName($data['name'] ?? null);
                if ($name === '') {
                    respond(422, ['error' => 'Bitte gib einen Kategorienamen ein.']);
                }
                $patches[] = 'name = :name';
                $params[':name'] = $name;
            }

            if (array_key_exists('icon', $data)) {
                $patches[] = 'icon = :icon';
                $params[':icon'] = normalizeCategoryIcon((string) $data['icon'], (string) $category['type']);
            }

            if (array_key_exists('is_hidden', $data)) {
                $patches[] = 'is_hidden = :is_hidden';
                $params[':is_hidden'] = filter_var($data['is_hidden'], FILTER_VALIDATE_BOOL) ? 1 : 0;
            }

            if ($patches === []) {
                respond(422, ['error' => 'Keine Änderungen übergeben.']);
            }

            $stmt = $db->prepare(
                'UPDATE categories SET ' . implode(', ', $patches) . ', updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id AND user_id = :user_id'
            );
            $stmt->execute($params);

            respond(200, [
                'message' => 'Kategorie aktualisiert.',
                'category' => loadUserCategory($db, $userId, $categoryId),
            ]);

        case 'categories_reorder':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $ids = normalizeIdList($data['ids'] ?? ($data['ids[]'] ?? null));
            if ($ids === []) {
                respond(422, ['error' => 'Ungültige Reihenfolge.']);
            }

            $stmt = $db->prepare('SELECT id FROM categories WHERE user_id = :user_id ORDER BY sort_order ASC, id ASC');
            $stmt->execute([':user_id' => $userId]);
            $existingIds = array_map(static fn(mixed $id): int => (int) $id, $stmt->fetchAll(PDO::FETCH_COLUMN));

            $sortedIds = $ids;
            sort($sortedIds);
            $sortedExisting = $existingIds;
            sort($sortedExisting);

            if ($sortedIds !== $sortedExisting) {
                respond(422, ['error' => 'Reihenfolge passt nicht zu den vorhandenen Kategorien.']);
            }

            $stmt = $db->prepare(
                'UPDATE categories SET sort_order = :sort_order, updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id AND user_id = :user_id'
            );

            $db->beginTransaction();
            foreach ($ids as $index => $id) {
                $stmt->execute([
                    ':sort_order' => $index + 1,
                    ':id' => $id,
                    ':user_id' => $userId,
                ]);
            }
            $db->commit();

            respond(200, ['message' => 'Kategorien neu sortiert.']);

        case 'categories_delete':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $category = requireCategory($data, $db, $userId);

            $countStmt = $db->prepare('SELECT COUNT(*) FROM items WHERE user_id = :user_id AND category_id = :category_id');
            $countStmt->execute([':user_id' => $userId, ':category_id' => (int) $category['id']]);
            if ((int) $countStmt->fetchColumn() > 0) {
                respond(422, ['error' => 'Kategorie kann nur gelöscht werden, wenn sie leer ist.']);
            }

            $db->prepare('DELETE FROM categories WHERE id = :id AND user_id = :user_id')
                ->execute([':id' => (int) $category['id'], ':user_id' => $userId]);

            $preferences = getExtendedUserPreferences($db, $userId);
            if ((int) ($preferences['last_category_id'] ?? 0) === (int) $category['id']) {
                $fallback = loadUserCategories($db, $userId, false)[0]['id'] ?? null;
                updateExtendedUserPreferences($db, $userId, ['last_category_id' => $fallback]);
            }

            respond(200, ['message' => 'Kategorie gelöscht.']);

        case 'list':
            requireMethod('GET');
            $category = requireCategory([], $db, $userId);

            $stmt = $db->prepare(
                'SELECT
                    items.id,
                    items.category_id,
                    categories.name AS category_name,
                    categories.type AS category_type,
                    items.name,
                    items.barcode,
                    items.quantity,
                    items.due_date,
                    items.is_pinned,
                    items.content,
                    items.done,
                    items.sort_order,
                    items.created_at,
                    items.updated_at,
                    attachments.storage_section AS attachment_storage_section,
                    attachments.stored_name AS attachment_stored_name,
                    attachments.original_name AS attachment_original_name,
                    attachments.media_type AS attachment_media_type,
                    attachments.size_bytes AS attachment_size_bytes,
                    attachments.updated_at AS attachment_updated_at,
                    CASE WHEN attachments.id IS NULL THEN 0 ELSE 1 END AS has_attachment
                 FROM items
                 INNER JOIN categories ON categories.id = items.category_id
                 LEFT JOIN attachments ON attachments.item_id = items.id
                 WHERE items.category_id = :category_id
                   AND items.user_id = :user_id
                 ORDER BY items.is_pinned DESC, items.sort_order ASC, items.id ASC'
            );
            $stmt->execute([':category_id' => (int) $category['id'], ':user_id' => $userId]);

            $items = array_map(static fn(array $item): array => formatListItem($item), $stmt->fetchAll());
            $response = ['items' => $items, 'category' => $category];

            if (isAttachmentCategoryType((string) $category['type'])) {
                $freeBytes = disk_free_space(getDataDirectory());
                if ($freeBytes !== false) {
                    $response['disk_free_bytes'] = (int) $freeBytes;
                }
            }

            respond(200, $response);

        case 'add':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $category = requireCategory($data, $db, $userId);
            $name = normalizeName($data['name'] ?? null);
            $barcode = preg_replace('/\D+/', '', (string) ($data['barcode'] ?? '')) ?? '';
            $barcode = truncateText($barcode, 64);
            $quantity = normalizeQuantity($data['quantity'] ?? null);
            $dueDate = normalizeDueDate($data['due_date'] ?? null);
            $content = normalizeContent($data['content'] ?? null);

            if ($name === '') {
                respond(422, ['error' => 'Bitte gib einen Artikelnamen ein.']);
            }

            $type = (string) $category['type'];

            if ($type === 'list_due_date') {
                $quantity = '';
                $barcode = '';
            } elseif ($type === 'list_quantity') {
                $dueDate = '';
                $content = '';
            } elseif ($type === 'notes') {
                $quantity = '';
                $dueDate = '';
                $barcode = '';
            } elseif ($type === 'links') {
                $quantity = '';
                $dueDate = '';
                $content = '';
                $barcode = '';
            } else {
                $quantity = '';
                $dueDate = '';
                $content = '';
                $barcode = '';
            }

            $stmt = $db->prepare(
                'INSERT INTO items (name, barcode, quantity, due_date, content, section, category_id, sort_order, user_id)
                 VALUES (:name, :barcode, :quantity, :due_date, :content, :section, :category_id, :sort_order, :user_id)'
            );
            $stmt->execute([
                ':name' => $name,
                ':barcode' => $barcode,
                ':quantity' => $quantity,
                ':due_date' => $dueDate,
                ':content' => $content,
                ':section' => '',
                ':category_id' => (int) $category['id'],
                ':sort_order' => prependItemSortOrder($db, $userId, (int) $category['id']),
                ':user_id' => $userId,
            ]);

            respond(201, [
                'message' => 'Artikel hinzugefügt.',
                'id' => (int) $db->lastInsertId(),
            ]);

        case 'upload':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $category = requireCategory($data, $db, $userId);
            validateCategoryType($category, ['images', 'files'], 'Uploads sind nur in Kategorien vom Typ Bilder oder Dateien erlaubt.');

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
                $existingItem = fetchItemForUser($db, $userId, $replaceItemId);
                if ($existingItem === null || (int) $existingItem['category_id'] !== (int) $category['id']) {
                    respond(404, ['error' => 'Artikel nicht gefunden.']);
                }

                $storedName = buildStoredFilename((string) $category['type'], (string) $uploadMeta['stored_extension']);
                $targetPath = getAttachmentStorageDirectory((string) $category['type']) . '/' . $storedName;
                $storedFileMoved = false;

                $db->beginTransaction();
                try {
                    if ($name !== '') {
                        $db->prepare('UPDATE items SET name = :name, updated_at = CURRENT_TIMESTAMP WHERE id = :id')
                            ->execute([':name' => $name, ':id' => $replaceItemId]);
                    }

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

                    $oldAttachment = findAttachmentByItemId($db, $replaceItemId);
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

                    $db->commit();

                    if ($oldAttachment !== null) {
                        deleteAttachmentStorageFile($oldAttachment);
                    }
                } catch (Throwable $exception) {
                    if ($db->inTransaction()) {
                        $db->rollBack();
                    }
                    if ($storedFileMoved && is_file($targetPath)) {
                        @unlink($targetPath);
                    }
                    throw $exception;
                }

                respond(200, ['message' => 'Anhang ersetzt.', 'id' => $replaceItemId]);
            }

            if ($name === '') {
                respond(422, ['error' => 'Bitte gib einen Artikelnamen ein.']);
            }

            $storedName = buildStoredFilename((string) $category['type'], (string) $uploadMeta['stored_extension']);
            $targetPath = getAttachmentStorageDirectory((string) $category['type']) . '/' . $storedName;
            $storedFileMoved = false;
            $itemId = null;

            $db->beginTransaction();
            try {
                $db->prepare(
                    'INSERT INTO items (name, quantity, due_date, content, section, category_id, sort_order, user_id)
                     VALUES (:name, \'\', \'\', \'\', \'\', :category_id, :sort_order, :user_id)'
                )->execute([
                    ':name' => $name,
                    ':category_id' => (int) $category['id'],
                    ':sort_order' => prependItemSortOrder($db, $userId, (int) $category['id']),
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

        case 'toggle':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $done = filter_var($data['done'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 1]]);

            if (!is_int($id) || !is_int($done)) {
                respond(422, ['error' => 'Ungültige Parameter für den Statuswechsel.']);
            }

            $stmt = $db->prepare('UPDATE items SET done = :done, updated_at = CURRENT_TIMESTAMP WHERE id = :id AND user_id = :user_id');
            $stmt->execute([':done' => $done, ':id' => $id, ':user_id' => $userId]);

            if ($stmt->rowCount() === 0) {
                respond(404, ['error' => 'Artikel nicht gefunden.']);
            }

            respond(200, ['message' => 'Status aktualisiert.']);

        case 'update':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if (!is_int($id)) {
                respond(422, ['error' => 'Ungültige ID.']);
            }

            $item = fetchItemForUser($db, $userId, $id);
            if ($item === null) {
                respond(404, ['error' => 'Artikel nicht gefunden.']);
            }

            $type = (string) $item['category_type'];
            $name = normalizeName($data['name'] ?? null);
            $barcode = preg_replace('/\D+/', '', (string) ($data['barcode'] ?? ($item['barcode'] ?? ''))) ?? '';
            $barcode = truncateText($barcode, 64);
            $quantity = normalizeQuantity($data['quantity'] ?? null);
            $dueDate = normalizeDueDate($data['due_date'] ?? null);
            $content = normalizeContent($data['content'] ?? null);

            if ($name === '') {
                respond(422, ['error' => 'Bitte gib einen Artikelnamen ein.']);
            }

            if ($type !== 'list_quantity') {
                $quantity = '';
                $barcode = '';
            }
            if ($type !== 'list_due_date') {
                $dueDate = '';
            }
            if ($type !== 'notes') {
                $content = '';
            }

            $stmt = $db->prepare(
                'UPDATE items
                 SET name = :name, barcode = :barcode, quantity = :quantity, due_date = :due_date, content = :content, updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id AND user_id = :user_id'
            );
            $stmt->execute([
                ':id' => $id,
                ':name' => $name,
                ':barcode' => $barcode,
                ':quantity' => $quantity,
                ':due_date' => $dueDate,
                ':content' => $content,
                ':user_id' => $userId,
            ]);

            respond(200, ['message' => 'Artikel aktualisiert.']);

        case 'delete':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if (!is_int($id)) {
                respond(422, ['error' => 'Ungültige ID.']);
            }

            $attachment = findAttachmentByItemId($db, $id);
            $db->beginTransaction();
            $stmt = $db->prepare('DELETE FROM items WHERE id = :id AND user_id = :user_id');
            $stmt->execute([':id' => $id, ':user_id' => $userId]);

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
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $category = requireCategory($data, $db, $userId);

            $attachmentStmt = $db->prepare(
                'SELECT attachments.id, attachments.item_id, attachments.storage_section, attachments.stored_name
                 FROM attachments
                 INNER JOIN items ON items.id = attachments.item_id
                 WHERE items.done = 1 AND items.category_id = :category_id AND items.user_id = :user_id'
            );
            $attachmentStmt->execute([':category_id' => (int) $category['id'], ':user_id' => $userId]);
            $attachments = $attachmentStmt->fetchAll();

            $db->beginTransaction();
            $stmt = $db->prepare('DELETE FROM items WHERE done = 1 AND category_id = :category_id AND user_id = :user_id');
            $stmt->execute([':category_id' => (int) $category['id'], ':user_id' => $userId]);
            $deletedCount = (int) $stmt->rowCount();
            $db->commit();

            foreach ($attachments as $attachment) {
                try {
                    deleteAttachmentStorageFile($attachment);
                } catch (Throwable $cleanupException) {
                    error_log(sprintf('Einkauf attachment cleanup error [clear:%d:%d]: %s', (int) $category['id'], (int) ($attachment['item_id'] ?? 0), $cleanupException->getMessage()));
                }
            }

            respond(200, ['message' => 'Erledigte Artikel gelöscht.', 'deleted' => $deletedCount]);

        case 'reorder':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $category = requireCategory($data, $db, $userId);
            $orderedIds = normalizeIdList($data['ids'] ?? ($data['ids[]'] ?? null));
            if ($orderedIds === []) {
                respond(422, ['error' => 'Ungültige Reihenfolge.']);
            }

            $existingStmt = $db->prepare(
                'SELECT id FROM items WHERE category_id = :category_id AND user_id = :user_id ORDER BY sort_order ASC, id ASC'
            );
            $existingStmt->execute([':category_id' => (int) $category['id'], ':user_id' => $userId]);
            $existingIds = array_map(static fn(mixed $id): int => (int) $id, $existingStmt->fetchAll(PDO::FETCH_COLUMN));

            $sortedIds = $orderedIds;
            sort($sortedIds);
            $sortedExistingIds = $existingIds;
            sort($sortedExistingIds);

            if ($sortedIds !== $sortedExistingIds) {
                respond(422, ['error' => 'Reihenfolge passt nicht zur aktuellen Liste.']);
            }

            $stmt = $db->prepare(
                'UPDATE items SET sort_order = :sort_order, updated_at = CURRENT_TIMESTAMP WHERE id = :id AND user_id = :user_id'
            );

            $db->beginTransaction();
            foreach ($orderedIds as $index => $id) {
                $stmt->execute([
                    ':sort_order' => $index + 1,
                    ':id' => $id,
                    ':user_id' => $userId,
                ]);
            }
            $db->commit();

            respond(200, ['message' => 'Reihenfolge aktualisiert.']);

        case 'pin':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $isPinned = filter_var($data['is_pinned'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 1]]);

            if (!is_int($id) || !is_int($isPinned)) {
                respond(422, ['error' => 'Ungültige Parameter.']);
            }

            $stmt = $db->prepare('UPDATE items SET is_pinned = :is_pinned, updated_at = CURRENT_TIMESTAMP WHERE id = :id AND user_id = :user_id');
            $stmt->execute([':is_pinned' => $isPinned, ':id' => $id, ':user_id' => $userId]);

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
                    items.category_id,
                    categories.name AS category_name,
                    categories.type AS category_type,
                    items.name,
                    items.barcode,
                    items.quantity,
                    items.due_date,
                    items.is_pinned,
                    items.content,
                    items.done,
                    items.sort_order,
                    items.created_at,
                    items.updated_at,
                    attachments.storage_section AS attachment_storage_section,
                    attachments.stored_name AS attachment_stored_name,
                    attachments.original_name AS attachment_original_name,
                    attachments.media_type AS attachment_media_type,
                    attachments.size_bytes AS attachment_size_bytes,
                    attachments.updated_at AS attachment_updated_at,
                    CASE WHEN attachments.id IS NULL THEN 0 ELSE 1 END AS has_attachment
                 FROM items_fts
                 INNER JOIN items ON items.id = items_fts.rowid
                 INNER JOIN categories ON categories.id = items.category_id
                 LEFT JOIN attachments ON attachments.item_id = items.id
                 WHERE items_fts MATCH :q AND items.user_id = :user_id
                 ORDER BY rank
                 LIMIT 50'
            );
            $stmt->execute([':q' => $ftsQuery, ':user_id' => $userId]);

            $items = array_map(static fn(array $item): array => formatListItem($item), $stmt->fetchAll());
            respond(200, ['items' => $items]);

        case 'product_lookup':
            requireMethod('GET');
            $barcode = preg_replace('/\D+/', '', (string) ($_GET['barcode'] ?? '')) ?? '';
            $barcode = truncateText($barcode, 64);

            if ($barcode === '') {
                respond(422, ['error' => 'Ungültiger Barcode.']);
            }

            $stmt = $db->prepare(
                'SELECT barcode, product_name, brands, quantity, source
                 FROM product_catalog
                 WHERE barcode = :barcode
                 LIMIT 1'
            );
            $stmt->execute([':barcode' => $barcode]);
            $product = $stmt->fetch();

            if (!is_array($product)) {
                respond(404, ['error' => 'Produkt nicht gefunden.']);
            }

            respond(200, [
                'product' => [
                    'barcode' => (string) ($product['barcode'] ?? ''),
                    'product_name' => (string) ($product['product_name'] ?? ''),
                    'brands' => (string) ($product['brands'] ?? ''),
                    'quantity' => (string) ($product['quantity'] ?? ''),
                    'source' => (string) ($product['source'] ?? ''),
                ],
            ]);

        case 'product_details':
            requireMethod('GET');
            $barcode = preg_replace('/\D+/', '', (string) ($_GET['barcode'] ?? '')) ?? '';
            $barcode = truncateText($barcode, 64);

            if ($barcode === '') {
                respond(422, ['error' => 'Ungültiger Barcode.']);
            }

            $summaryStmt = $db->prepare(
                'SELECT barcode, product_name, brands, quantity, source
                 FROM product_catalog
                 WHERE barcode = :barcode
                 LIMIT 1'
            );
            $summaryStmt->execute([':barcode' => $barcode]);
            $summary = $summaryStmt->fetch();

            if (!is_array($summary)) {
                respond(404, ['error' => 'Produkt nicht gefunden.']);
            }

            $sources = [];
            $sourceNames = array_values(array_filter(array_map('trim', explode(',', (string) ($summary['source'] ?? '')))));

            foreach ($sourceNames as $dataset) {
                try {
                    $tableName = getProductCatalogTableName($dataset);
                } catch (InvalidArgumentException) {
                    continue;
                }

                $tableIdentifier = quoteSqlIdentifier($tableName);
                $exists = (bool) $db->query(
                    "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = " . $db->quote($tableName)
                )->fetchColumn();

                if (!$exists) {
                    continue;
                }

                $stmt = $db->prepare("SELECT * FROM {$tableIdentifier} WHERE code = :barcode LIMIT 1");
                $stmt->execute([':barcode' => $barcode]);
                $row = $stmt->fetch();

                if (!is_array($row)) {
                    continue;
                }

                $sources[] = [
                    'dataset' => $dataset,
                    'fields' => $row,
                ];
            }

            respond(200, [
                'product' => [
                    'barcode' => (string) ($summary['barcode'] ?? ''),
                    'product_name' => (string) ($summary['product_name'] ?? ''),
                    'brands' => (string) ($summary['brands'] ?? ''),
                    'quantity' => (string) ($summary['quantity'] ?? ''),
                    'source' => (string) ($summary['source'] ?? ''),
                ],
                'sources' => $sources,
            ]);

        case 'preferences':
            if ($_SERVER['REQUEST_METHOD'] === 'GET') {
                respond(200, ['preferences' => getExtendedUserPreferences($db, $userId)]);
            }

            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $patch = [];

            if (array_key_exists('mode', $data) && is_string($data['mode'])) {
                $patch['mode'] = $data['mode'];
            }

            if (array_key_exists('tabs_hidden', $data)) {
                $patch['tabs_hidden'] = filter_var($data['tabs_hidden'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
            }

            if (array_key_exists('category_swipe_enabled', $data)) {
                $patch['category_swipe_enabled'] = filter_var($data['category_swipe_enabled'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
            }

            if (array_key_exists('install_banner_dismissed', $data)) {
                $patch['install_banner_dismissed'] = filter_var($data['install_banner_dismissed'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
            }

            if (array_key_exists('theme_mode', $data) && is_string($data['theme_mode'])) {
                $patch['theme_mode'] = $data['theme_mode'];
            }

            if (array_key_exists('last_category_id', $data)) {
                $lastCategoryId = filter_var($data['last_category_id'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
                if (is_int($lastCategoryId) && loadUserCategory($db, $userId, $lastCategoryId) !== null) {
                    $patch['last_category_id'] = $lastCategoryId;
                }
            }

            $preferences = updateExtendedUserPreferences($db, $userId, $patch);
            respond(200, ['preferences' => $preferences]);

        default:
            respond(404, ['error' => 'Unbekannte Aktion.']);
    }
} catch (Throwable $exception) {
    if ($db instanceof PDO && $db->inTransaction()) {
        $db->rollBack();
    }

    error_log(sprintf(
        'Einkauf API error [action=%s method=%s ip=%s]: %s',
        (string) $action,
        (string) ($_SERVER['REQUEST_METHOD'] ?? ''),
        (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
        (string) $exception
    ));
    respond(500, ['error' => 'Serverfehler.']);
}
