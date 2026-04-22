<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';

enforceCanonicalRequest();

function categoryIconFail(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo $message;
    exit;
}

$icon = normalizeCategoryIcon((string) ($_GET['icon'] ?? ''));
if (!in_array($icon, CATEGORY_ICON_OPTIONS, true)) {
    categoryIconFail(404, 'Category icon not found.');
}

$absolute = __DIR__ . '/icons/categories/' . $icon . '.svg';
if (!is_file($absolute)) {
    categoryIconFail(404, 'Category icon not found.');
}

header('Content-Type: image/svg+xml; charset=utf-8');
header('Cache-Control: public, max-age=86400');
header('X-Content-Type-Options: nosniff');
header('Content-Length: ' . (string) filesize($absolute));
readfile($absolute);
