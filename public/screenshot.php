<?php
declare(strict_types=1);

require dirname(__DIR__) . '/security.php';

enforceCanonicalRequest();

$allowed = [
    'mobile-02-einkauf',
    'mobile-04-privat-todos',
    'mobile-06-notizen',
];

$name = (string)filter_input(INPUT_GET, 'name', FILTER_DEFAULT);
if (!in_array($name, $allowed, true)) {
    $name = 'mobile-02-einkauf';
}

$file = dirname(__DIR__) . '/screenshots/' . $name . '.png';

if (!is_file($file)) {
    http_response_code(404);
    header('Content-Type: text/plain');
    echo 'Screenshot not found.';
    exit;
}

header('Content-Type: image/png');
header('Cache-Control: public, max-age=86400');
header('X-Content-Type-Options: nosniff');
readfile($file);
