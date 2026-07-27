<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require_once dirname(__DIR__) . '/src/AiClient.php';
require_once dirname(__DIR__) . '/src/AiProvider.php';
require_once dirname(__DIR__) . '/src/MagicBar.php';
require __DIR__ . '/theme.php';

enforceCanonicalRequest();
$userId = requireAuth();
$db = getDatabase();

header('Content-Type: application/json; charset=utf-8');

function buildMagicToastMessage(array $createdItems): string
{
    $count = count($createdItems);
    if ($count === 0) {
        return 'Keine passenden Objekte erkannt.';
    }

    if ($count === 1) {
        $item = $createdItems[0];
        $label = (string) ($item['object_label'] ?? 'Eintrag');
        $name = trim((string) ($item['name'] ?? ''));
        $categoryName = trim((string) ($item['category_name'] ?? ''));
        $message = $label . ' erstellt';
        if ($name !== '') {
            $message .= ': ' . $name;
        }
        if ($categoryName !== '') {
            $message .= ' in ' . $categoryName;
        }

        return $message . '.';
    }

    $previewNames = array_values(array_filter(array_map(
        static fn(array $item): string => trim((string) ($item['name'] ?? '')),
        array_slice($createdItems, 0, 3)
    )));
    $preview = implode(', ', $previewNames);

    return $count . ' Einträge hinzugefügt' . ($preview !== '' ? ': ' . $preview : '') . ($count > 3 ? ' ...' : '') . '.';
}

function resolveMagicTargetCategory(array $createdItems): array
{
    if ($createdItems === []) {
        return [
            'id' => null,
            'name' => '',
            'ambiguous' => false,
        ];
    }

    $firstItem = $createdItems[0];
    $categoryIds = array_values(array_unique(array_map(
        static fn(array $item): int => (int) ($item['category_id'] ?? 0),
        $createdItems
    )));

    return [
        'id' => (int) ($firstItem['category_id'] ?? 0),
        'name' => (string) ($firstItem['category_name'] ?? ''),
        'ambiguous' => count($categoryIds) > 1,
    ];
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Nur POST erlaubt.']);
    exit;
}

$rawInput = file_get_contents('php://input');
$data = json_decode($rawInput, true);
requireCsrfToken($data ?? []);

$userInput = trim((string) ($data['input'] ?? ''));
$mode = (string) ($data['mode'] ?? 'preview');

if ($userInput === '' && $mode !== 'confirm') {
    http_response_code(422);
    echo json_encode(['error' => 'Keine Eingabe erhalten.']);
    exit;
}

$preferences = getUserPreferences($db, $userId);

// Allow testing a key before saving — provider-aware
[$config, $err] = aiProviderResolve($preferences, $data ?? []);
if ($err !== null) {
    http_response_code($err['status']);
    echo json_encode(['error' => $err['message']]);
    exit;
}
$aiProvider = $config['provider'];
$aiKey = $config['key'];

if ($aiKey === '' && $mode !== 'confirm' && $aiProvider !== 'openai_compatible') {
    http_response_code(403);
    echo json_encode(['error' => 'Bitte hinterlege zuerst einen API-Key in den Einstellungen.']);
    exit;
}

if (!empty($data['test_only'])) {
    $result = aiProviderCall($config, 'Hi', [
        'timeout' => 30,
        'connect_timeout' => 10,
    ]);

    if ($result['ok']) {
        echo json_encode(['success' => true, 'message' => 'Key ist gültig für ' . $config['model'] . '.']);
    } else {
        $providerName = getProviderDisplayName($aiProvider);
        http_response_code(403);
        echo json_encode(['error' => 'Key oder Modell ungültig' . ($result['http_code'] > 0 ? ' (HTTP ' . $result['http_code'] . ')' : '') . ($result['error'] !== '' ? ': ' . $result['error'] : '')]);
    }
    exit;
}

// Fetch categories (needed for both preview and confirm)
$categories = loadUserCategories($db, $userId, false);

// ── CONFIRM MODE: save previously previewed items ──
if ($mode === 'confirm') {
    $itemsToSave = $data['items'] ?? [];
    if (!is_array($itemsToSave) || $itemsToSave === []) {
        http_response_code(422);
        echo json_encode(['error' => 'Keine Artikel zum Speichern.']);
        exit;
    }

    try {
        $result = magicBarConfirm($itemsToSave, [
            'db' => $db,
            'user_id' => $userId,
            'categories' => $categories,
        ]);
    } catch (RuntimeException $e) {
        http_response_code($e->getCode() >= 400 && $e->getCode() < 600 ? $e->getCode() : 422);
        echo json_encode(['error' => $e->getMessage()]);
        exit;
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Fehler beim Speichern in der Datenbank.']);
        exit;
    }

    $targetCategory = resolveMagicTargetCategory($result['created_items']);

    echo json_encode([
        'success' => true,
        'added_count' => $result['added_count'],
        'created_items' => $result['created_items'],
        'toast_message' => buildMagicToastMessage($result['created_items']),
        'target_category_id' => $targetCategory['id'],
        'target_category_name' => $targetCategory['name'],
        'target_category_ambiguous' => $targetCategory['ambiguous'],
    ]);
    exit;
}

// ── PREVIEW MODE (default): ask Gemini, return suggestions without saving ──

try {
    $previewResult = magicBarPreview($userInput, [
        'db' => $db,
        'user_id' => $userId,
        'categories' => $categories,
        'config' => $config,
        'active_category_id' => (int) ($data['active_category_id'] ?? 0),
    ]);
} catch (RuntimeException $e) {
    http_response_code($e->getCode() >= 400 && $e->getCode() < 600 ? $e->getCode() : 500);
    echo json_encode(['error' => $e->getMessage()]);
    exit;
}

if (isset($previewResult['clarification'])) {
    echo json_encode([
        'success' => true,
        'clarification' => $previewResult['clarification'],
    ]);
    exit;
}

echo json_encode([
    'success' => true,
    'preview' => true,
    'items' => $previewResult['items'] ?? [],
]);