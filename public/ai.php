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
$aiProvider = (string) ($data['ai_provider'] ?? $preferences['ai_provider'] ?? 'gemini');
$validProviders = array_keys(getAvailableProviders());
if (!in_array($aiProvider, $validProviders, true)) {
    $aiProvider = 'gemini';
}

if ($aiProvider === 'openai_compatible') {
    $requestKey = $data['openai_compatible_api_key'] ?? null;
    $aiKey = trim((string) ($requestKey !== null ? $requestKey : ($preferences['openai_compatible_api_key'] ?? '')));
    $requestModel = $data['openai_compatible_model'] ?? null;
    $aiModel = trim((string) ($requestModel !== null && $requestModel !== '' ? $requestModel : ($preferences['openai_compatible_model'] ?? 'gpt-4o-mini')));
    if ($aiModel === '') $aiModel = 'gpt-4o-mini';
    $requestBaseUrl = $data['openai_compatible_base_url'] ?? null;
    $aiBaseUrl = trim((string) ($requestBaseUrl !== null && $requestBaseUrl !== '' ? $requestBaseUrl : ($preferences['openai_compatible_base_url'] ?? 'https://api.openai.com/v1')));
    if ($aiBaseUrl === '') $aiBaseUrl = 'https://api.openai.com/v1';
    if (validateAiBaseUrl($aiBaseUrl) !== null) {
        http_response_code(422);
        echo json_encode(['error' => 'Ungültige Basis-URL.']);
        exit;
    }
    $availableModels = []; // Freitext, keine Whitelist
} else {
    $requestKey = $data['gemini_api_key'] ?? null;
    $aiKey = trim((string) ($requestKey !== null ? $requestKey : ($preferences['gemini_api_key'] ?? '')));
    $availableModels = getAvailableAiModels('gemini');
    $requestModel = $data['gemini_model'] ?? null;
    $aiModel = (string) ($requestModel !== null && $requestModel !== '' ? $requestModel : ($preferences['gemini_model'] ?? 'gemini-2.5-flash'));
    $aiBaseUrl = '';
}
if (!array_key_exists($aiModel, $availableModels) && $availableModels !== []) {
    $aiModel = array_key_first($availableModels);
}

if ($aiKey === '' && $mode !== 'confirm' && $aiProvider !== 'openai_compatible') {
    http_response_code(403);
    echo json_encode(['error' => 'Bitte hinterlege zuerst einen API-Key in den Einstellungen.']);
    exit;
}

if (!empty($data['test_only'])) {
    $result = callAiProvider($aiKey, $aiProvider, $aiModel, 'Hi', [
        'timeout' => 30,
        'connect_timeout' => 10,
        'base_url' => $aiBaseUrl,
    ]);

    if ($result['ok']) {
        echo json_encode(['success' => true, 'message' => 'Key ist gültig für ' . $aiModel . '.']);
    } else {
        $providerName = getProviderDisplayName($aiProvider);
        http_response_code(403);
        echo json_encode(['error' => 'Key oder Modell ungültig' . ($result['http_code'] > 0 ? ' (HTTP ' . $result['http_code'] . ')' : '') . ($result['error'] !== '' ? ': ' . $result['error'] : '')]);
    }
    exit;
}

// Fetch categories (needed for both preview and confirm)
$categories = loadUserCategories($db, $userId, false);
$typeDescriptions = [
    'list_quantity' => 'Einkaufsliste mit Mengenangaben',
    'list_due_date' => 'Aufgaben/Termine mit Fälligkeitsdatum',
    'notes' => 'Notizen und Texte',
    'images' => 'Bilder',
    'files' => 'Dateien',
    'links' => 'Links/URLs',
];

// ── CONFIRM MODE: save previously previewed items ──
if ($mode === 'confirm') {
    $itemsToSave = $data['items'] ?? [];
    if (!is_array($itemsToSave) || $itemsToSave === []) {
        http_response_code(422);
        echo json_encode(['error' => 'Keine Artikel zum Speichern.']);
        exit;
    }

    $validItems = [];
    $countsByCategory = [];
    foreach ($itemsToSave as $item) {
        $name = trim((string) ($item['name'] ?? ''));
        if ($name === '') continue;

        $catId = (int) ($item['category_id'] ?? 0);
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

        $validItems[] = [
            'item' => $item,
            'category' => $matchedCategory
        ];

        if (!isset($countsByCategory[$catId])) {
            $countsByCategory[$catId] = 0;
        }
        $countsByCategory[$catId]++;
    }

    if ($validItems === []) {
        http_response_code(422);
        echo json_encode(['error' => 'Keine Artikel zum Speichern.']);
        exit;
    }

    $addedCount = 0;
    $createdItems = [];
    $db->beginTransaction();
    try {
        // Step 1: Pre-shift all categories once
        foreach ($countsByCategory as $catId => $count) {
            prependItemSortOrder($db, $userId, $catId, $count);
        }

        // Step 2: Track remaining counts per category for assigning sort_order
        $remainingCounts = $countsByCategory;

        // Step 3: Insert items
        foreach ($validItems as $entry) {
            $item = $entry['item'];
            $matchedCategory = $entry['category'];
            $catId = $matchedCategory['id'];
            $name = trim((string) ($item['name'] ?? ''));

            $content = ($matchedCategory['type'] === 'notes')
                ? trim((string) ($item['content'] ?? ''))
                : '';

            // The sort order is assigned in descending order from $count down to 1
            $sortOrder = $remainingCounts[$catId]--;

            $stmt = $db->prepare(
                'INSERT INTO items (name, quantity, due_date, content, section, category_id, sort_order, user_id)
                 VALUES (:name, :quantity, :due_date, :content, \'\', :category_id, :sort_order, :user_id)'
            );
            $stmt->execute([
                ':name' => mb_substr($name, 0, 120),
                ':quantity' => mb_substr((string) ($item['quantity'] ?? ''), 0, 40),
                ':due_date' => normalizeDueDate($item['due_date'] ?? null),
                ':content' => $content,
                ':category_id' => $catId,
                ':sort_order' => $sortOrder,
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
                'content' => $content,
                'due_date' => normalizeDueDate($item['due_date'] ?? null),
            ];
        }
        $db->commit();
    } catch (Exception $e) {
        $db->rollBack();
        error_log('Fehler beim Speichern in der Datenbank (ai.php): ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['error' => 'Fehler beim Speichern in der Datenbank.']);
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
    ]);
    exit;
}

// ── PREVIEW MODE (default): ask Gemini, return suggestions without saving ──

$catContext = [];
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
    $activeCategoryHint = "\n\nDer Nutzer hat gerade die Kategorie \"{$activeCategory['name']}\" (ID: {$activeCategory['id']}, Typ: {$activeCategory['type']}) geöffnet. Verwende für alle Einträge, die zu diesem Typ passen, IMMER die category_id {$activeCategory['id']}. Nur Einträge, die eindeutig einen anderen Typ brauchen (z.B. ein Link oder eine Notiz bei einer Einkaufsliste), dürfen in eine andere Kategorie.";
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

Verhalten je nach Kategorie-Typ:
- list_quantity (Einkaufsliste): Löse Oberbegriffe/Rezepte/Themen in einzelne Artikel auf. Gib sinnvolle Mengen im quantity-Feld an (z.B. \"500g\", \"1 Pkg\", \"2\").
- list_due_date (Aufgaben): Löse in einzelne Aufgaben auf. Leite Fälligkeitsdaten aus dem Kontext ab.
- notes (Notizen): Erstelle EINEN Eintrag. Der \"name\" ist der Titel. Das \"content\"-Feld enthält den eigentlichen Notiztext als HTML (z.B. \"<p>Text</p>\"). Nutze dein Weltwissen, um eine informative Notiz zu schreiben.
- links (Links): Erstelle einen Eintrag pro URL.

Heute ist {$dayOfWeek}, der {$today}.

Gib NUR valides JSON zurück — entweder:

A) Ein Array von Objekten (normale Antwort):
[{\"name\": \"...\", \"quantity\": \"...\", \"content\": \"...\", \"category_id\": ..., \"due_date\": \"...\"}]

B) Ein Rückfrage-Objekt, wenn die Eingabe zu unklar ist:
{\"clarification\": \"Deine Rückfrage hier\"}

Felder pro Objekt:
- \"name\": Titel/Name (kurz und präzise, max 120 Zeichen)
- \"quantity\": Menge (nur bei list_quantity), sonst leerer String
- \"content\": Textinhalt als HTML (nur bei notes-Kategorien, z.B. \"<p>Bruce Willis ist ein ...</p>\"), sonst leerer String
- \"category_id\": Die ID der passendsten Kategorie
- \"due_date\": Datum im Format YYYY-MM-DD (wenn erkennbar), sonst leerer String

Kategorien des Nutzers:
" . json_encode($catContext, JSON_UNESCAPED_UNICODE) . "

Regeln:
1. Bei Einkäufen und Aufgaben: Löse Oberbegriffe in Einzeleinträge auf.
2. Bei Notizen: Erstelle EINEN Eintrag mit ausführlichem content (HTML).
3. Wähle die Kategorie sorgfältig anhand des Zwecks.
4. Nutze Rückfragen (B) nur wenn die Eingabe wirklich nicht interpretierbar ist.
5. Antworte AUSSCHLIESSLICH mit JSON." . $activeCategoryHint . $existingItemsHint;

$prompt = $systemPrompt . "\n\nBenutzereingabe: " . $userInput;

$result = callAiProvider($aiKey, $aiProvider, $aiModel, $prompt, [
    'timeout' => 30,
    'connect_timeout' => 10,
    'json_mode' => true,
    'base_url' => $aiBaseUrl,
]);

if (!$result['ok']) {
    $providerName = getProviderDisplayName($aiProvider);
    http_response_code($result['http_code'] === 0 ? 502 : 500);
    echo json_encode([
        'error' => $providerName . ' konnte nicht erreicht werden' . ($result['error'] !== '' ? ': ' . $result['error'] : ''),
    ]);
    exit;
}

$aiText = trim($result['text']);
if (preg_match('/^```(?:json)?\s*(.*?)\s*```$/s', $aiText, $matches)) {
    $aiText = trim((string) ($matches[1] ?? '[]'));
}
$parsedItems = json_decode($aiText, true);

// Fix double-encoded UTF-8 from Gemini (e.g. "Ã¼" instead of "ü")
function fixDoubleEncodedUtf8(string $text): string
{
    // Detect double-encoded UTF-8: valid UTF-8 that decodes to Latin-1 Gemini artifacts
    $decoded = @mb_convert_encoding($text, 'UTF-8', 'Windows-1252');
    if ($decoded !== false && mb_check_encoding($decoded, 'UTF-8') && $decoded !== $text) {
        // Verify it actually fixed something (contains fewer multi-byte sequences)
        if (strlen($decoded) < strlen($text)) {
            return $decoded;
        }
    }
    return $text;
}

function fixItemEncoding(array $item): array
{
    foreach (['name', 'content', 'quantity', 'clarification'] as $field) {
        if (isset($item[$field]) && is_string($item[$field])) {
            $item[$field] = fixDoubleEncodedUtf8($item[$field]);
        }
    }
    return $item;
}

if (is_array($parsedItems)) {
    if (isset($parsedItems['clarification'])) {
        $parsedItems = fixItemEncoding($parsedItems);
    } else {
        $parsedItems = array_map('fixItemEncoding', $parsedItems);
    }
}

if (!is_array($parsedItems)) {
    http_response_code(500);
    echo json_encode(['error' => 'Ungültige Antwort von der KI.']);
    exit;
}

// Handle clarification response from Gemini
if (isset($parsedItems['clarification'])) {
    echo json_encode([
        'success' => true,
        'clarification' => (string) $parsedItems['clarification'],
    ]);
    exit;
}

// Validate and enrich items for preview (no DB writes)
// If active category is set, redirect same-type items to it
$activeType = $activeCategory !== null ? $activeCategory['type'] : null;

$previewItems = [];
foreach ($parsedItems as $item) {
    $name = trim((string) ($item['name'] ?? ''));
    if ($name === '') continue;

    $catId = (int) ($item['category_id'] ?? 0);
    $matchedCategory = null;
    foreach ($categories as $c) {
        if ($c['id'] === $catId) {
            $matchedCategory = $c;
            break;
        }
    }
    if ($matchedCategory === null) continue;

    // Force items of the same type into the active category
    if ($activeCategory !== null && $matchedCategory['type'] === $activeType && $catId !== $activeCategoryId) {
        $catId = $activeCategoryId;
        $matchedCategory = $activeCategory;
    }

    $content = ($matchedCategory['type'] === 'notes')
        ? trim((string) ($item['content'] ?? ''))
        : '';

    $previewItems[] = [
        'name' => mb_substr($name, 0, 120),
        'quantity' => mb_substr((string) ($item['quantity'] ?? ''), 0, 40),
        'content' => $content,
        'due_date' => normalizeDueDate($item['due_date'] ?? null),
        'category_id' => $catId,
        'category_name' => (string) ($matchedCategory['name'] ?? ''),
        'category_type' => (string) ($matchedCategory['type'] ?? ''),
    ];
}

echo json_encode([
    'success' => true,
    'preview' => true,
    'items' => $previewItems,
]);
