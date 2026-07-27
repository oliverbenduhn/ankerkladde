<?php
declare(strict_types=1);

/**
 * Magic-Bar-Modul: zwei Pfade, eine Verantwortung.
 *
 *   magicBarPreview(text, ctx)  -> Item-Liste (oder ['clarification' => ...])
 *   magicBarConfirm(items, ctx) -> ['added_count' => N, 'created_items' => [...]]
 *
 * Encoding-Fix (Gemini-Ã¼-Artefakte), JSON-Parsing und Markdown-Codefence-Strip
 * leben hier, weil sie nur in diesem Pfad auftreten.
 *
 * ponytail: keine Klassen, keine Interfaces. zwei Funktionen + Helper.
 * ponytail: Provider-Config kommt vom Caller — keine doppelte aiProviderResolve.
 */

/**
 * Liefert die deutsche Anzeigebezeichnung eines Kategorie-Typs für ein Item.
 */
function magicBarObjectLabel(string $categoryType): string
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

/**
 * Behebt Gemini-Doppel-UTF-8-Artefakte (z.B. "Ã¼" statt "ü").
 */
function magicBarFixDoubleEncodedUtf8(string $text): string
{
    $decoded = @mb_convert_encoding($text, 'UTF-8', 'Windows-1252');
    if ($decoded !== false && mb_check_encoding($decoded, 'UTF-8') && $decoded !== $text) {
        if (strlen($decoded) < strlen($text)) {
            return $decoded;
        }
    }
    return $text;
}

function magicBarFixItemEncoding(array $item): array
{
    foreach (['name', 'content', 'quantity', 'clarification'] as $field) {
        if (isset($item[$field]) && is_string($item[$field])) {
            $item[$field] = magicBarFixDoubleEncodedUtf8($item[$field]);
        }
    }
    return $item;
}

/**
 * Liefert eine gerundete User-Tagesnotiz-Liste bestehender Items für Duplikaterkennung.
 * ponytail: SELECT mit LIMIT 100 — bei größeren Listen Duplikate schwerer zu erkennen,
 * Upgrade wenn echte Kollisionen auftreten.
 *
 * @return array<int, string>
 */
function magicBarExistingItemNames(PDO $db, int $userId, int $activeCategoryId): array
{
    if ($activeCategoryId <= 0) {
        return [];
    }
    $stmt = $db->prepare('SELECT name FROM items WHERE user_id = :uid AND category_id = :cid AND done = 0 ORDER BY sort_order LIMIT 100');
    $stmt->execute([':uid' => $userId, ':cid' => $activeCategoryId]);
    return $stmt->fetchAll(PDO::FETCH_COLUMN);
}

/**
 * Fragt den Provider mit dem system-prompt und liefert entweder
 * ['items' => [...]] oder ['clarification' => '...'] oder wirft RuntimeException.
 *
 * @return array{items?: array, clarification?: string}
 */
function magicBarPreview(string $userInput, array $ctx): array
{
    $db = $ctx['db'];
    $userId = $ctx['user_id'];
    $categories = $ctx['categories'];
    $config = $ctx['config'];
    $activeCategoryId = (int) ($ctx['active_category_id'] ?? 0);

    $typeDescriptions = [
        'list_quantity' => 'Einkaufsliste mit Mengenangaben',
        'list_due_date' => 'Aufgaben/Termine mit Fälligkeitsdatum',
        'notes' => 'Notizen und Texte',
        'images' => 'Bilder',
        'files' => 'Dateien',
        'links' => 'Links/URLs',
    ];

    $catContext = [];
    $activeCategory = null;
    foreach ($categories as $cat) {
        $catContext[] = [
            'id' => $cat['id'],
            'name' => $cat['name'],
            'type' => $cat['type'],
            'purpose' => $typeDescriptions[$cat['type']] ?? $cat['type'],
        ];
        if ($activeCategoryId > 0 && (int) $cat['id'] === $activeCategoryId) {
            $activeCategory = $cat;
        }
    }

    $activeCategoryHint = '';
    if ($activeCategory !== null) {
        $activeCategoryHint = "\n\nDer Nutzer hat gerade die Kategorie \"{$activeCategory['name']}\" (ID: {$activeCategory['id']}, Typ: {$activeCategory['type']}) geöffnet. Verwende für alle Einträge, die zu diesem Typ passen, IMMER die category_id {$activeCategory['id']}. Nur Einträge, die eindeutig einen anderen Typ brauchen (z.B. ein Link oder eine Notiz bei einer Einkaufsliste), dürfen in eine andere Kategorie.";
    }

    $existingItemNames = magicBarExistingItemNames($db, $userId, $activeCategoryId);
    $existingItemsHint = $existingItemNames !== []
        ? "\n\nBereits auf der aktuellen Liste (NICHT erneut hinzufügen): " . implode(', ', $existingItemNames)
        : '';

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

    $result = aiProviderCall($config, $prompt, [
        'timeout' => 30,
        'connect_timeout' => 10,
        'json_mode' => true,
    ]);

    if (!$result['ok']) {
        $providerName = getProviderDisplayName($config['provider']);
        $status = $result['http_code'] === 0 ? 502 : 500;
        throw new RuntimeException(
            $providerName . ' konnte nicht erreicht werden' . ($result['error'] !== '' ? ': ' . $result['error'] : ''),
            $status
        );
    }

    $aiText = trim($result['text']);
    if (preg_match('/^```(?:json)?\s*(.*?)\s*```$/s', $aiText, $matches)) {
        $aiText = trim((string) ($matches[1] ?? '[]'));
    }
    $parsedItems = json_decode($aiText, true);

    if (is_array($parsedItems)) {
        if (isset($parsedItems['clarification'])) {
            $parsedItems = magicBarFixItemEncoding($parsedItems);
        } else {
            $parsedItems = array_map('magicBarFixItemEncoding', $parsedItems);
        }
    }

    if (!is_array($parsedItems)) {
        throw new RuntimeException('Ungültige Antwort von der KI.', 500);
    }

    if (isset($parsedItems['clarification'])) {
        return ['clarification' => (string) $parsedItems['clarification']];
    }

    $activeType = $activeCategory !== null ? $activeCategory['type'] : null;
    $previewItems = [];
    foreach ($parsedItems as $item) {
        $name = trim((string) ($item['name'] ?? ''));
        if ($name === '') continue;

        $catId = (int) ($item['category_id'] ?? 0);
        $matchedCategory = null;
        foreach ($categories as $c) {
            if ((int) $c['id'] === $catId) {
                $matchedCategory = $c;
                break;
            }
        }
        if ($matchedCategory === null) continue;

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
            'category_type' => (string) $matchedCategory['type'],
        ];
    }

    return ['items' => $previewItems];
}

/**
 * Persistiert vom Frontend bestätigte Items. Liefert ['added_count' => N, 'created_items' => [...]].
 * DB-Fehler werden via Exception propagiert.
 */
function magicBarConfirm(array $items, array $ctx): array
{
    $db = $ctx['db'];
    $userId = $ctx['user_id'];
    $categories = $ctx['categories'];

    $validItems = [];
    $countsByCategory = [];
    foreach ($items as $item) {
        $name = trim((string) ($item['name'] ?? ''));
        if ($name === '') continue;

        $catId = (int) ($item['category_id'] ?? 0);
        $matchedCategory = null;
        foreach ($categories as $c) {
            if ((int) $c['id'] === $catId) {
                $matchedCategory = $c;
                break;
            }
        }
        if ($matchedCategory === null) continue;

        $validItems[] = ['item' => $item, 'category' => $matchedCategory];
        $countsByCategory[$catId] = ($countsByCategory[$catId] ?? 0) + 1;
    }

    if ($validItems === []) {
        throw new RuntimeException('Keine Artikel zum Speichern.', 422);
    }

    $addedCount = 0;
    $createdItems = [];
    $db->beginTransaction();
    try {
        foreach ($countsByCategory as $catId => $count) {
            prependItemSortOrder($db, $userId, (int) $catId, $count);
        }
        $remainingCounts = $countsByCategory;

        foreach ($validItems as $entry) {
            $item = $entry['item'];
            $matchedCategory = $entry['category'];
            $catId = (int) $matchedCategory['id'];
            $name = trim((string) ($item['name'] ?? ''));

            $content = ($matchedCategory['type'] === 'notes')
                ? trim((string) ($item['content'] ?? ''))
                : '';

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
                'category_type' => (string) $matchedCategory['type'],
                'object_label' => magicBarObjectLabel((string) $matchedCategory['type']),
                'quantity' => mb_substr((string) ($item['quantity'] ?? ''), 0, 40),
                'content' => $content,
                'due_date' => normalizeDueDate($item['due_date'] ?? null),
            ];
        }
        $db->commit();
    } catch (Exception $e) {
        $db->rollBack();
        error_log('Fehler beim Speichern in der Datenbank (MagicBar.confirm): ' . $e->getMessage());
        throw $e;
    }

    return ['added_count' => $addedCount, 'created_items' => $createdItems];
}