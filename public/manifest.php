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

$manifest = [
    'id' => $appBasePath,
    'name' => 'Einkaufsliste',
    'short_name' => 'Einkauf',
    'description' => 'Schnelle mobile Einkaufsliste mit Offline-Unterstützung.',
    'lang' => 'de',
    'start_url' => $appBasePath,
    'scope' => $appBasePath,
    'display' => 'standalone',
    'background_color' => '#f5f0eb',
    'theme_color' => '#f5f0eb',
    'icons' => [
        [
            'src' => $appBasePath . 'icons/icon-192.png',
            'sizes' => '192x192',
            'type' => 'image/png',
            'purpose' => 'any',
        ],
        [
            'src' => $appBasePath . 'icons/icon-192.png',
            'sizes' => '192x192',
            'type' => 'image/png',
            'purpose' => 'maskable',
        ],
        [
            'src' => $appBasePath . 'icons/icon-512.png',
            'sizes' => '512x512',
            'type' => 'image/png',
            'purpose' => 'any',
        ],
        [
            'src' => $appBasePath . 'icons/icon-512.png',
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
