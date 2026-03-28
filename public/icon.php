<?php
declare(strict_types=1);

require dirname(__DIR__) . '/security.php';

enforceCanonicalRequest();

$size = $_GET['size'] ?? '192';

$iconMap = [
    '192' => dirname(__DIR__) . '/public/icons/icon-192.png',
    '512' => dirname(__DIR__) . '/public/icons/icon-512.png',
];

$iconPath = $iconMap[$size] ?? null;

if (!is_string($iconPath) || !is_file($iconPath)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Icon not found.';
    exit;
}

header('Content-Type: image/png');
header('Cache-Control: public, max-age=86400');
header('X-Content-Type-Options: nosniff');
header('Content-Length: ' . (string) filesize($iconPath));

readfile($iconPath);
