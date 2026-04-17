<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require __DIR__ . '/theme.php';

enforceCanonicalRequest();
$userId = requireAuth();
$db = getDatabase();

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Nur POST erlaubt.']);
    exit;
}

$rawInput = file_get_contents('php://input');
$data = json_decode($rawInput, true);
$userInput = trim((string) ($data['input'] ?? ''));

if ($userInput === '') {
    http_response_code(422);
    echo json_encode(['error' => 'Keine Eingabe erhalten.']);
    exit;
}

$preferences = getUserPreferences($db, $userId);
// Allow testing a key before saving
$geminiKey = trim((string) ($data['gemini_api_key'] ?? $preferences['gemini_api_key'] ?? ''));

if ($geminiKey === '') {
    http_response_code(403);
    echo json_encode(['error' => 'Bitte hinterlege zuerst deinen Gemini API-Key in den Einstellungen.']);
    exit;
}

if (!empty($data['test_only'])) {
    $apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" . $geminiKey;
    $postData = [
        'contents' => [['parts' => [['text' => 'Hi']]]]
    ];
    $ch = curl_init($apiUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($postData));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    if ($httpCode === 200) {
        echo json_encode(['success' => true, 'message' => 'Key ist gültig.']);
    } else {
        http_response_code(403);
        echo json_encode(['error' => 'Key ungültig (HTTP ' . $httpCode . ')']);
    }
    exit;
}

// Fetch categories to give Gemini context
$categories = loadUserCategories($db, $userId, false);
$catContext = [];
foreach ($categories as $cat) {
    $catContext[] = [
        'id' => $cat['id'],
        'name' => $cat['name'],
        'type' => $cat['type']
    ];
}

$systemPrompt = "Du bist ein Assistent für die App 'Ankerkladde'. 
Analysiere die Benutzereingabe und extrahiere eine Liste von Aufgaben oder Einkaufsartikeln.
Gib NUR valides JSON zurück, ein Array von Objekten.
Jedes Objekt muss folgende Felder haben:
- 'name': Name des Artikels/der Aufgabe
- 'quantity': Menge (nur für Einkaufslisten-Typen), sonst leerer String
- 'category_id': Die ID der am besten passenden Kategorie aus der Liste unten.
- 'due_date': Datum im Format YYYY-MM-DD (nur wenn ein Datum erkennbar ist), sonst leerer String.

Kategorien für diesen Nutzer:
" . json_encode($catContext, JSON_UNESCAPED_UNICODE) . "

Regeln:
1. Wenn mehrere Artikel genannt werden, erstelle für jeden ein Objekt.
2. Wähle die Kategorie sorgfältig. Einkäufe -> list_quantity, Termine/Todos -> list_due_date, Notizen -> notes.
3. Antworte AUSSCHLIESSLICH mit dem JSON-Array. Kein Text davor oder danach.";

$modelName = 'gemini-2.5-flash';
$apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($modelName) . ':generateContent';

$postData = [
    'contents' => [
        [
            'parts' => [
                ['text' => $systemPrompt . "\n\nBenutzereingabe: " . $userInput]
            ]
        ]
    ],
    'generationConfig' => [
        'response_mime_type' => 'application/json'
    ]
];

$ch = curl_init($apiUrl);
$encodedPostData = json_encode($postData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $encodedPostData === false ? '{}' : $encodedPostData);
curl_setopt($ch, CURLOPT_TIMEOUT, 20);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'x-goog-api-key: ' . $geminiKey,
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
if ($response === false) {
    $error = curl_error($ch);
    curl_close($ch);
    http_response_code(502);
    echo json_encode(['error' => 'Gemini konnte nicht erreicht werden: ' . $error]);
    exit;
}
curl_close($ch);

if ($httpCode !== 200) {
    $errorPayload = json_decode($response, true);
    $apiMessage = trim((string) ($errorPayload['error']['message'] ?? ''));
    http_response_code(500);
    echo json_encode([
        'error' => 'Fehler bei der Kommunikation mit Gemini (HTTP ' . $httpCode . ')' . ($apiMessage !== '' ? ': ' . $apiMessage : ''),
    ]);
    exit;
}

$result = json_decode($response, true);
$aiText = $result['candidates'][0]['content']['parts'][0]['text'] ?? '[]';
$aiText = trim((string) $aiText);
if (preg_match('/^```(?:json)?\s*(.*?)\s*```$/s', $aiText, $matches)) {
    $aiText = trim((string) ($matches[1] ?? '[]'));
}
$itemsToAdd = json_decode($aiText, true);

if (!is_array($itemsToAdd)) {
    http_response_code(500);
    echo json_encode(['error' => 'Ungültige Antwort von der KI.']);
    exit;
}

$addedCount = 0;
$db->beginTransaction();
try {
    foreach ($itemsToAdd as $item) {
        $name = trim((string) ($item['name'] ?? ''));
        if ($name === '') continue;

        $catId = (int) ($item['category_id'] ?? 0);
        // Verify category belongs to user
        $validCat = false;
        foreach ($categories as $c) {
            if ($c['id'] === $catId) {
                $validCat = true;
                break;
            }
        }
        if (!$validCat) continue;

        $stmt = $db->prepare(
            'INSERT INTO items (name, quantity, due_date, content, section, category_id, sort_order, user_id)
             VALUES (:name, :quantity, :due_date, \'\', \'\', :category_id, :sort_order, :user_id)'
        );
        $stmt->execute([
            ':name' => mb_substr($name, 0, 120),
            ':quantity' => mb_substr((string) ($item['quantity'] ?? ''), 0, 40),
            ':due_date' => (string) ($item['due_date'] ?? ''),
            ':category_id' => $catId,
            ':sort_order' => prependItemSortOrder($db, $userId, $catId),
            ':user_id' => $userId,
        ]);
        $addedCount++;
    }
    $db->commit();
} catch (Exception $e) {
    $db->rollBack();
    http_response_code(500);
    echo json_encode(['error' => 'Fehler beim Speichern in der Datenbank: ' . $e->getMessage()]);
    exit;
}

echo json_encode([
    'success' => true,
    'added_count' => $addedCount,
    'message' => $addedCount > 0
        ? $addedCount . ' Artikel erfolgreich hinzugefügt.'
        : 'Keine passenden Artikel erkannt.'
]);
