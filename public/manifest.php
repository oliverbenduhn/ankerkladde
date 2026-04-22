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
        ['src' => $manifestBase . 'icon.php?size=72',  'sizes' => '72x72',    'type' => 'image/png'],
        ['src' => $manifestBase . 'icon.php?size=96',  'sizes' => '96x96',    'type' => 'image/png'],
        ['src' => $manifestBase . 'icon.php?size=128', 'sizes' => '128x128',  'type' => 'image/png'],
        ['src' => $manifestBase . 'icon.php?size=144', 'sizes' => '144x144',  'type' => 'image/png'],
        ['src' => $manifestBase . 'icon.php?size=152', 'sizes' => '152x152',  'type' => 'image/png'],
        ['src' => $manifestBase . 'icon.php?size=180', 'sizes' => '180x180',  'type' => 'image/png'],
        ['src' => $manifestBase . 'icon.php?size=192', 'sizes' => '192x192',  'type' => 'image/png', 'purpose' => 'any'],
        ['src' => $manifestBase . 'icon.php?size=192', 'sizes' => '192x192',  'type' => 'image/png', 'purpose' => 'maskable'],
        ['src' => $manifestBase . 'icon.php?size=384', 'sizes' => '384x384',  'type' => 'image/png'],
        ['src' => $manifestBase . 'icon.php?size=512', 'sizes' => '512x512',  'type' => 'image/png', 'purpose' => 'any'],
        ['src' => $manifestBase . 'icon.php?size=512', 'sizes' => '512x512',  'type' => 'image/png', 'purpose' => 'maskable'],
    ],
];

header('Content-Type: application/manifest+json; charset=utf-8');
header('Cache-Control: public, max-age=300');
header('X-Content-Type-Options: nosniff');

echo json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
