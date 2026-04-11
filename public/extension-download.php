<?php
declare(strict_types=1);

require dirname(__DIR__) . '/security.php';
require dirname(__DIR__) . '/browser-extension/build-lib.php';

enforceCanonicalRequest();
requireAuth();

$extensionDir = dirname(__DIR__) . '/browser-extension';

try {
    $zipData = buildExtensionZipData($extensionDir);
} catch (Throwable $exception) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Extension konnte nicht erstellt werden.';
    exit;
}

header('Content-Type: application/zip');
header('Content-Length: ' . strlen($zipData));
header('Content-Disposition: attachment; filename="zettel-save-extension.zip"');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

echo $zipData;
