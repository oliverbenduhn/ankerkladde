<?php
declare(strict_types=1);

require dirname(__DIR__) . '/security.php';
/** @var string $assetVersion */
$assetVersion = require __DIR__ . '/version.php';

enforceCanonicalRequest();

$scriptName = $_SERVER['SCRIPT_NAME'] ?? '/manifest.php';
if (!is_string($scriptName) || $scriptName === '') {
    $scriptName = '/manifest.php';
}

$appBasePath = dirname(str_replace('\\', '/', $scriptName));
if ($appBasePath === '' || $appBasePath === '.') {
    $appBasePath = '/';
} else {
    $appBasePath = rtrim($appBasePath, '/') . '/';
}

$requestHost = getRequestHost();
$manifestBase = isCanonicalProductionHost($requestHost)
    ? rtrim(getCanonicalAppOrigin(), '/') . $appBasePath
    : $appBasePath;

$manifest = [
    'id' => $manifestBase,
    'name' => 'Ankerkladde',
    'short_name' => 'Ankerkladde',
    'description' => 'Mobile Kladde für Listen, Notizen, Bilder, Dateien und Links.',
    'lang' => 'de',
    'start_url' => $manifestBase,
    'scope' => $manifestBase,
    'display' => 'standalone',
    'background_color' => '#0f2a44',
    'theme_color' => '#0f2a44',
    'share_target' => [
        'action'  => $manifestBase,
        'method'  => 'POST',
        'enctype' => 'multipart/form-data',
        'params'  => [
            'title' => 'title',
            'text'  => 'text',
            'url'   => 'url',
            'files' => [
                [
                    'name'   => 'file',
                    'accept' => ['image/*', 'video/*', 'audio/*', 'application/pdf'],
                ],
            ],
        ],
    ],
    'icons' => [
        ['src' => $manifestBase . 'icons/icon-72.png',             'sizes' => '72x72',    'type' => 'image/png'],
        ['src' => $manifestBase . 'icons/icon-96.png',             'sizes' => '96x96',    'type' => 'image/png'],
        ['src' => $manifestBase . 'icons/icon-128.png',            'sizes' => '128x128',  'type' => 'image/png'],
        ['src' => $manifestBase . 'icons/icon-144.png',            'sizes' => '144x144',  'type' => 'image/png'],
        ['src' => $manifestBase . 'icons/icon-152.png',            'sizes' => '152x152',  'type' => 'image/png'],
        ['src' => $manifestBase . 'icons/icon-180.png',            'sizes' => '180x180',  'type' => 'image/png'],
        ['src' => $manifestBase . 'icons/icon-192.png',            'sizes' => '192x192',  'type' => 'image/png', 'purpose' => 'any'],
        ['src' => $manifestBase . 'icons/icon-192-maskable.png',   'sizes' => '192x192',  'type' => 'image/png', 'purpose' => 'maskable'],
        ['src' => $manifestBase . 'icons/icon-384.png',            'sizes' => '384x384',  'type' => 'image/png'],
        ['src' => $manifestBase . 'icons/icon-512.png',            'sizes' => '512x512',  'type' => 'image/png', 'purpose' => 'any'],
        ['src' => $manifestBase . 'icons/icon-512-maskable.png',   'sizes' => '512x512',  'type' => 'image/png', 'purpose' => 'maskable'],
    ],
];

header('Content-Type: application/manifest+json; charset=utf-8');
header('Cache-Control: public, max-age=300');
header('X-Content-Type-Options: nosniff');

echo json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
