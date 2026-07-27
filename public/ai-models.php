<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require_once dirname(__DIR__) . '/src/AiClient.php';
require_once dirname(__DIR__) . '/src/AiProvider.php';
require __DIR__ . '/theme.php';

enforceCanonicalRequest();
requireAuth();

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Nur POST erlaubt.', 'models' => []]);
    exit;
}

$rawInput = file_get_contents('php://input');
$data = json_decode($rawInput, true);
requireCsrfToken($data ?? []);

$db = getDatabase();
$userId = getCurrentUserId();
if ($userId === null) {
    http_response_code(401);
    echo json_encode(['error' => 'Nicht angemeldet.', 'models' => []]);
    exit;
}
$preferences = getExtendedUserPreferences($db, $userId);

[$config, $err] = aiProviderResolve($preferences, $data ?? []);
if ($err !== null) {
    http_response_code($err['status']);
    echo json_encode(['error' => $err['message'], 'models' => []]);
    exit;
}

if ($config['provider'] === 'gemini' && $config['key'] === '') {
    http_response_code(403);
    echo json_encode(['error' => 'Bitte zuerst Gemini API-Key eintragen.', 'models' => []]);
    exit;
}

$result = aiProviderListModels($config);
if (!$result['ok']) {
    http_response_code(502);
    echo json_encode([
        'error' => $result['error'] !== '' ? $result['error'] : 'Modelle konnten nicht geladen werden.',
        'models' => [],
    ]);
    exit;
}

echo json_encode([
    'success' => true,
    'models' => $result['models'],
]);