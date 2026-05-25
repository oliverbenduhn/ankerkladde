<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require __DIR__ . '/theme.php';

enforceCanonicalRequest();
$userId = requireAuth();
$db = getDatabase();

header('Content-Type: application/json; charset=utf-8');

function magicObjectLabel(string $categoryType): string
{
    return match ($categoryType) {
        'list_quantity' => 'Artikel',
        'list_due_date' => 'Aufgabe',
        'notes' => 'Notiz',
        'images' => 'Bild',
        'files' => 'Datei',
        'links' => 'Link',
        default => 'Eintrag',
    };
}

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

    return $count . ' Objekte erstellt' . ($preview !== '' ? ': ' . $preview : '') . ($count > 3 ? ' ...' : '') . '.';
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
$userInput = trim((string) ($data['input'] ?? ''));

if ($userInput === '') {
    http_response_code(422);
    echo json_encode(['error' => 'Keine Eingabe erhalten.']);
    exit;
}

$preferences = getUserPreferences($db, $userId);
// Allow testing a key before saving
$geminiKey = trim((string) ($data['gemini_api_key'] ?? $preferences['gemini_api_key'] ?? ''));
$availableGeminiModels = getAvailableGeminiModels();
$geminiModel = (string) ($data['gemini_model'] ?? $preferences['gemini_model'] ?? 'gemini-2.5-flash');
if (!array_key_exists($geminiModel, $availableGeminiModels)) {
    $geminiModel = 'gemini-2.5-flash';
}

if ($geminiKey === '') {
    http_response_code(403);
    echo json_encode(['error' => 'Bitte hinterlege zuerst deinen Gemini API-Key in den Einstellungen.']);
    exit;
}

if (!empty($data['test_only'])) {
    $apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($geminiModel) . ':generateContent';
    $postData = [
        'contents' => [['parts' => [['text' => 'Hi']]]]
    ];
    $ch = curl_init($apiUrl);
    $encodedPostData = json_encode($postData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $encodedPostData === false ? '{}' : $encodedPostData);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'x-goog-api-key: ' . $geminiKey,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);

    if ($httpCode === 200) {
        echo json_encode(['success' => true, 'message' => 'Key ist gültig für ' . $geminiModel . '.']);
    } else {
        $errorPayload = json_decode(is_string($response) ? $response : '', true);
        $apiMessage = trim((string) ($errorPayload['error']['message'] ?? ''));
        http_response_code(403);
        echo json_encode(['error' => 'Key oder Modell ungültig (HTTP ' . $httpCode . ')' . ($apiMessage !== '' ? ': ' . $apiMessage : '')]);
    }
    exit;
}

// Fetch categories to give Gemini context
$categories = loadUserCategories($db, $userId, false);
$catContext = [];
$typeDescriptions = [
    'list_quantity' => 'Einkaufsliste mit Mengenangaben',
    'list_due_date' => 'Aufgaben/Termine mit Fälligkeitsdatum',
    'notes' => 'Notizen und Texte',
    'images' => 'Bilder',
    'files' => 'Dateien',
    'links' => 'Links/URLs',
];
foreach ($categories as $cat) {
    $catContext[] = [
        'id' => $cat['id'],
        'name' => $cat['name'],
        'type' => $cat['type'],
        'purpose' => $typeDescriptions[$cat['type']] ?? $cat['type'],
    ];
}

// Active category context from frontend
$activeCategoryId = (int) ($data['active_category_id'] ?? 0);
$activeCategory = null;
if ($activeCategoryId > 0) {
    foreach ($categories as $c) {
        if ($c['id'] === $activeCategoryId) {
            $activeCategory = $c;
            break;
        }
    }
}

// Existing items for duplicate detection
$existingItemNames = [];
if ($activeCategoryId > 0) {
    $stmt = $db->prepare('SELECT name FROM items WHERE user_id = :uid AND category_id = :cid AND done = 0 ORDER BY sort_order LIMIT 100');
    $stmt->execute([':uid' => $userId, ':cid' => $activeCategoryId]);
    $existingItemNames = $stmt->fetchAll(PDO::FETCH_COLUMN);
}

$activeCategoryHint = '';
if ($activeCategory !== null) {
    $activeCategoryHint = "\n\nDer Nutzer hat gerade die Kategorie \"{$activeCategory['name']}\" (Typ: {$activeCategory['type']}, Zweck: " . ($typeDescriptions[$activeCategory['type']] ?? '') . ") geöffnet. Ordne Einträge bevorzugt dieser Kategorie zu, es sei denn sie passen eindeutig in eine andere.";
}

$existingItemsHint = '';
if ($existingItemNames !== []) {
    $existingItemsHint = "\n\nBereits auf der aktuellen Liste (NICHT erneut hinzufügen): " . implode(', ', $existingItemNames);
}

$today = date('Y-m-d');
$dayOfWeek = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][(int) date('w')];

$systemPrompt = "Du bist ein intelligenter Assistent für die App \"Ankerkladde\".
Deine Aufgabe: Interpretiere die Benutzereingabe und erstelle daraus konkrete, einzelne Einträge.

WICHTIG — Nutze dein Weltwissen! Beispiele:
- \"Zutaten für Pizza\" → einzelne Zutaten: Pizzateig, Tomatensoße, Mozzarella, Basilikum, Olivenöl
- \"Zutaten für Lasagne für 4 Personen\" → Lasagneplatten (250g), Hackfleisch (500g), Tomaten (400g Dose), Zwiebeln (2), Knoblauch (2 Zehen), Mozzarella (200g), Parmesan (50g), Béchamelsauce oder Milch+Butter+Mehl, Salz, Pfeffer, Olivenöl
- \"Was brauche ich zum Campen?\" → Zelt, Schlafsack, Isomatte, Taschenlampe, Campingkocher, ...
- \"Einkauf fürs Frühstück\" → Brötchen, Butter, Marmelade, Eier, Kaffee, Orangensaft
- \"Todos für Umzug\" → Kartons besorgen, Umzugswagen mieten, Adresse ummelden, Nachsendeauftrag, ...

Wenn der Nutzer ein Rezept, eine Aktivität oder ein Thema nennt, löse es IMMER in die einzelnen Bestandteile auf. Gib niemals die Eingabe einfach als einzelnen Eintrag zurück.

Bei Einkaufsartikeln: Gib sinnvolle Mengenangaben im quantity-Feld an (z.B. \"500g\", \"1 Pkg\", \"2\", \"200ml\").
Bei Aufgaben: Leite aus dem Kontext sinnvolle Fälligkeitsdaten ab wenn möglich.

Heute ist {$dayOfWeek}, der {$today}.

Gib NUR valides JSON zurück — entweder:

A) Ein Array von Objekten (normale Antwort):
[{\"name\": \"...\", \"quantity\": \"...\", \"category_id\": ..., \"due_date\": \"...\"}]

B) Ein Rückfrage-Objekt, wenn die Eingabe zu unklar ist:
{\"clarification\": \"Deine Rückfrage hier\"}

Felder pro Objekt:
- \"name\": Name des Artikels/der Aufgabe (kurz und präzise)
- \"quantity\": Menge (bei list_quantity-Kategorien sinnvoll befüllen), sonst leerer String
- \"category_id\": Die ID der passendsten Kategorie
- \"due_date\": Datum im Format YYYY-MM-DD (wenn erkennbar), sonst leerer String

Kategorien des Nutzers:
" . json_encode($catContext, JSON_UNESCAPED_UNICODE) . "

Regeln:
1. Löse Oberbegriffe, Rezepte und Themen IMMER in Einzeleinträge auf.
2. Wähle die Kategorie sorgfältig anhand des Zwecks.
3. Nutze Rückfragen (B) nur wenn die Eingabe wirklich nicht interpretierbar ist — im Zweifel lieber eine sinnvolle Annahme treffen.
4. Antworte AUSSCHLIESSLICH mit JSON. Kein Text davor oder danach." . $activeCategoryHint . $existingItemsHint;

$apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($geminiModel) . ':generateContent';

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
    http_response_code(502);
    echo json_encode(['error' => 'Gemini konnte nicht erreicht werden: ' . $error]);
    exit;
}

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

// Handle clarification response from Gemini
if (isset($itemsToAdd['clarification'])) {
    echo json_encode([
        'success' => true,
        'clarification' => (string) $itemsToAdd['clarification'],
        'added_count' => 0,
        'created_items' => [],
        'toast_message' => '',
    ]);
    exit;
}

$addedCount = 0;
$createdItems = [];
$db->beginTransaction();
try {
    foreach ($itemsToAdd as $item) {
        $name = trim((string) ($item['name'] ?? ''));
        if ($name === '') continue;

        $catId = (int) ($item['category_id'] ?? 0);
        // Verify category belongs to user
        $validCat = false;
        $matchedCategory = null;
        foreach ($categories as $c) {
            if ($c['id'] === $catId) {
                $validCat = true;
                $matchedCategory = $c;
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
        $createdItems[] = [
            'name' => mb_substr($name, 0, 120),
            'category_id' => $catId,
            'category_name' => (string) ($matchedCategory['name'] ?? ''),
            'category_type' => (string) ($matchedCategory['type'] ?? ''),
            'object_label' => magicObjectLabel((string) ($matchedCategory['type'] ?? '')),
            'quantity' => mb_substr((string) ($item['quantity'] ?? ''), 0, 40),
            'due_date' => (string) ($item['due_date'] ?? ''),
        ];
    }
    $db->commit();
} catch (Exception $e) {
    $db->rollBack();
    http_response_code(500);
    echo json_encode(['error' => 'Fehler beim Speichern in der Datenbank: ' . $e->getMessage()]);
    exit;
}

$targetCategory = resolveMagicTargetCategory($createdItems);

echo json_encode([
    'success' => true,
    'added_count' => $addedCount,
    'created_items' => $createdItems,
    'toast_message' => buildMagicToastMessage($createdItems),
    'target_category_id' => $targetCategory['id'],
    'target_category_name' => $targetCategory['name'],
    'target_category_ambiguous' => $targetCategory['ambiguous'],
    'message' => $addedCount > 0
        ? $addedCount . ' Artikel erfolgreich hinzugefügt.'
        : 'Keine passenden Artikel erkannt.'
]);
