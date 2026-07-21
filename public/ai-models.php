<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';

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
$userId = requireAuth();
$preferences = getExtendedUserPreferences($db, $userId);

$aiProvider = (string) ($data['ai_provider'] ?? $preferences['ai_provider'] ?? 'gemini');
$validProviders = array_keys(getAvailableProviders());
if (!in_array($aiProvider, $validProviders, true)) {
    http_response_code(422);
    echo json_encode(['error' => 'Unbekannter Provider.', 'models' => []]);
    exit;
}

if ($aiProvider === 'gemini') {
    $apiKey = trim((string) (
        $data['gemini_api_key']
        ?? $preferences['gemini_api_key']
        ?? ''
    ));
    if ($apiKey === '') {
        http_response_code(403);
        echo json_encode(['error' => 'Bitte zuerst Gemini API-Key eintragen.', 'models' => []]);
        exit;
    }
    $result = listGeminiModels($apiKey);
} else {
    $requestKey = $data['openai_compatible_api_key'] ?? null;
    $apiKey = trim((string) ($requestKey !== null ? $requestKey : ($preferences['openai_compatible_api_key'] ?? '')));
    $requestBaseUrl = $data['openai_compatible_base_url'] ?? null;
    $baseUrl = trim((string) ($requestBaseUrl !== null && $requestBaseUrl !== '' ? $requestBaseUrl : ($preferences['openai_compatible_base_url'] ?? 'https://api.openai.com/v1')));
    if ($baseUrl === '') $baseUrl = 'https://api.openai.com/v1';
    $result = listOpenAiCompatibleModels($apiKey, $baseUrl);
}

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
