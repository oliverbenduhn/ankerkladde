<?php
declare(strict_types=1);

require dirname(__DIR__) . '/security.php';

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

$canonicalBaseUrl = rtrim(getCanonicalAppOrigin(), '/') . $appBasePath;

$manifest = [
    'id' => $canonicalBaseUrl,
    'name' => 'Ankerkladde',
    'short_name' => 'Ankerkladde',
    'description' => 'Mobile Kladde für Listen, Notizen, Bilder, Dateien und Links.',
    'lang' => 'de',
    'start_url' => $canonicalBaseUrl,
    'scope' => $canonicalBaseUrl,
    'display' => 'standalone',
    'background_color' => '#f5f0eb',
    'theme_color' => '#f5f0eb',
    'share_target' => [
        'action'  => $canonicalBaseUrl,
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
        [
            'src' => $canonicalBaseUrl . 'icon.php?size=192',
            'sizes' => '192x192',
            'type' => 'image/png',
            'purpose' => 'any',
        ],
        [
            'src' => $canonicalBaseUrl . 'icon.php?size=192',
            'sizes' => '192x192',
            'type' => 'image/png',
            'purpose' => 'maskable',
        ],
        [
            'src' => $canonicalBaseUrl . 'icon.php?size=512',
            'sizes' => '512x512',
            'type' => 'image/png',
            'purpose' => 'any',
        ],
        [
            'src' => $canonicalBaseUrl . 'icon.php?size=512',
            'sizes' => '512x512',
            'type' => 'image/png',
            'purpose' => 'maskable',
        ],
    ],
];

header('Content-Type: application/manifest+json; charset=utf-8');
header('Cache-Control: public, max-age=300');
header('X-Content-Type-Options: nosniff');

echo json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
