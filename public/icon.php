<?php
declare(strict_types=1);

require dirname(__DIR__) . '/security.php';

enforceCanonicalRequest();

const ICON_SIZE_MAP = [
    72  => '/public/icons/icon-72.png',
    96  => '/public/icons/icon-96.png',
    128 => '/public/icons/icon-128.png',
    144 => '/public/icons/icon-144.png',
    152 => '/public/icons/icon-152.png',
    180 => '/public/icons/icon-180.png',
    192 => '/public/icons/icon-192.png',
    384 => '/public/icons/icon-384.png',
    512 => '/public/icons/icon-512.png',
];

function iconFail(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo $message;
    exit;
}

function requestedIconSize(): int
{
    $size = filter_input(INPUT_GET, 'size', FILTER_VALIDATE_INT, [
        'options' => ['min_range' => 32, 'max_range' => 1024],
    ]);

    if (!is_int($size) || !array_key_exists($size, ICON_SIZE_MAP)) {
        return 192;
    }

    return $size;
}

$size = requestedIconSize();
$absolute = dirname(__DIR__) . ICON_SIZE_MAP[$size];

if (!is_file($absolute)) {
    iconFail(404, 'Icon not found.');
}

header('Content-Type: image/png');
header('Cache-Control: public, max-age=86400');
header('X-Content-Type-Options: nosniff');
header('Content-Length: ' . (string) filesize($absolute));
readfile($absolute);
