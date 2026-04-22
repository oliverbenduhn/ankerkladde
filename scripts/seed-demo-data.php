#!/usr/bin/env php
<?php
declare(strict_types=1);

require dirname(__DIR__) . '/security.php';
require dirname(__DIR__) . '/db.php';

$db = getDatabase();

$userId = (int) ($db->query("SELECT id FROM users WHERE username = 'tester' LIMIT 1")->fetchColumn());
if ($userId === 0) {
    fwrite(STDERR, "Benutzer 'tester' nicht gefunden.\n");
    exit(1);
}

// Alle vorhandenen Items löschen
$db->exec("DELETE FROM items WHERE category_id IN (SELECT id FROM categories WHERE user_id = $userId)");
echo "Alte Items gelöscht.\n";

// Kategorie-IDs laden
$cats = $db->query(
    "SELECT id, name, type FROM categories WHERE user_id = $userId ORDER BY sort_order"
)->fetchAll(PDO::FETCH_ASSOC);

$catByType = [];
foreach ($cats as $c) {
    $catByType[$c['type']] = $c;
}

function insertItem(PDO $db, int $userId, int $catId, string $name, array $extra = []): int
{
    $quantity  = $extra['quantity'] ?? '';
    $content   = $extra['content'] ?? '';
    $done      = $extra['done'] ?? 0;
    $dueDate   = $extra['due_date'] ?? '';
    $isPinned  = $extra['is_pinned'] ?? 0;
    $sortOrder = $extra['sort_order'] ?? 999;

    $stmt = $db->prepare(
        'INSERT INTO items (user_id, name, quantity, content, done, category_id, due_date, is_pinned, sort_order, created_at, updated_at)
         VALUES (:user_id, :name, :quantity, :content, :done, :category_id, :due_date, :is_pinned, :sort_order, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
    );
    $stmt->execute([
        ':user_id'    => $userId,
        ':name'       => $name,
        ':quantity'   => $quantity,
        ':content'    => $content,
        ':done'       => $done,
        ':category_id'=> $catId,
        ':due_date'   => $dueDate,
        ':is_pinned'  => $isPinned,
        ':sort_order' => $sortOrder,
    ]);
    return (int) $db->lastInsertId();
}

// --- Einkauf (list_quantity) ---
if (isset($catByType['list_quantity'])) {
    $id = $catByType['list_quantity']['id'];
    $items = [
        ['name' => 'Milch',           'quantity' => '2 Liter'],
        ['name' => 'Vollkornbrot',    'quantity' => '1 Laib'],
        ['name' => 'Äpfel',           'quantity' => '1 kg'],
        ['name' => 'Butter',          'quantity' => '250 g'],
        ['name' => 'Gouda',           'quantity' => '200 g'],
        ['name' => 'Naturjoghurt',    'quantity' => '4 Becher'],
        ['name' => 'Tomaten',         'quantity' => '500 g'],
        ['name' => 'Pasta',           'quantity' => '2 Packungen'],
        ['name' => 'Olivenöl',        'quantity' => '1 Flasche'],
        ['name' => 'Eier',            'quantity' => '10 Stück'],
        ['name' => 'Bananen',         'quantity' => '1 Bund',  'done' => 1],
        ['name' => 'Mineralwasser',   'quantity' => '6 × 1,5 L','done' => 1],
        ['name' => 'Kaffee',          'quantity' => '500 g',   'done' => 1],
    ];
    foreach ($items as $i => $item) {
        insertItem($db, $userId, $id, $item['name'], [
            'quantity'   => $item['quantity'],
            'done'       => $item['done'] ?? 0,
            'sort_order' => $i + 1,
        ]);
    }
    echo "Einkauf befüllt.\n";
}

// --- Privat (list_due_date) ---
if (isset($catByType['list_due_date'])) {
    $cats_due = array_filter($cats, fn($c) => $c['type'] === 'list_due_date');
    $privatCat = array_values($cats_due)[0] ?? null;

    if ($privatCat) {
        $id = $privatCat['id'];
        $items = [
            ['name' => 'Arzttermin (Hausarzt)',         'due_date' => '2026-04-25'],
            ['name' => 'Geburtstagsgeschenk für Mama',  'due_date' => '2026-04-28'],
            ['name' => 'Auto zum TÜV',                  'due_date' => '2026-05-15'],
            ['name' => 'Steuererklärung abgeben',       'due_date' => '2026-05-31'],
            ['name' => 'Balkon bepflanzen',             'due_date' => '2026-05-10'],
            ['name' => 'Bibliotheksbücher zurückgeben', 'due_date' => '2026-04-22', 'done' => 1],
            ['name' => 'Versicherung kündigen',         'due_date' => '2026-04-20', 'done' => 1],
        ];
        foreach ($items as $i => $item) {
            insertItem($db, $userId, $id, $item['name'], [
                'due_date'   => $item['due_date'],
                'done'       => $item['done'] ?? 0,
                'sort_order' => $i + 1,
            ]);
        }
        echo "Privat befüllt.\n";
    }

    // --- Arbeit (zweite list_due_date) ---
    $arbeitCat = array_values($cats_due)[1] ?? null;
    if ($arbeitCat) {
        $id = $arbeitCat['id'];
        $items = [
            ['name' => 'Präsentation Q2 vorbereiten',   'due_date' => '2026-04-22'],
            ['name' => 'Angebot an Kunde Fischer',       'due_date' => '2026-04-24'],
            ['name' => 'Monatsbericht einreichen',       'due_date' => '2026-04-30'],
            ['name' => 'Server-Backup einrichten',       'due_date' => '2026-05-08'],
            ['name' => 'Onboarding neuer Kollege',       'due_date' => '2026-05-04'],
            ['name' => 'Sprint-Review Protokoll',        'due_date' => '2026-04-18', 'done' => 1],
            ['name' => 'Urlaub eintragen',               'due_date' => '2026-04-17', 'done' => 1],
        ];
        foreach ($items as $i => $item) {
            insertItem($db, $userId, $id, $item['name'], [
                'due_date'   => $item['due_date'],
                'done'       => $item['done'] ?? 0,
                'sort_order' => $i + 1,
            ]);
        }
        echo "Arbeit befüllt.\n";
    }
}

// --- Notizen (notes) ---
if (isset($catByType['notes'])) {
    $id = $catByType['notes']['id'];

    insertItem($db, $userId, $id, 'Urlaubsplanung Sommer 2026', [
        'content' => '<h2>Kroatien – Ideen</h2><ul><li>Dubrovnik &amp; Altstadt</li><li>Insel Hvar – Bootstour</li><li>Nationalpark Plitvicer Seen</li></ul><p>Flüge am besten <strong>Ende Juni</strong> buchen, vor dem Schulferienstart. Budget: ca. 1.500 € p. P.</p>',
        'is_pinned' => 1,
        'sort_order' => 1,
    ]);

    insertItem($db, $userId, $id, 'Pasta Carbonara (Originalrezept)', [
        'content' => '<p>Zutaten für 2 Personen: 200 g Spaghetti, 100 g Guanciale, 2 Eigelb + 1 ganzes Ei, 50 g Pecorino Romano, schwarzer Pfeffer.</p><p><strong>Wichtig:</strong> Keine Sahne! Ei-Käse-Mischung nur <em>vom Herd</em> unterrühren, damit sie nicht stockt.</p>',
        'sort_order' => 2,
    ]);

    insertItem($db, $userId, $id, 'WLAN-Passwörter', [
        'content' => '<p>Heimnetz: <strong>Sonnenschein2024!</strong><br>Gastnetz: <strong>Besucher42</strong><br>Büro-WLAN: im IT-Ticket #4821 hinterlegt</p>',
        'sort_order' => 3,
    ]);

    insertItem($db, $userId, $id, 'Buchempfehlungen', [
        'content' => '<ul><li>„Das Café am Rande der Welt" – John Strelecky</li><li>„Atomic Habits" – James Clear</li><li>„Der Alchemist" – Paulo Coelho ✓ gelesen</li><li>„Project Hail Mary" – Andy Weir</li></ul>',
        'sort_order' => 4,
    ]);

    echo "Notizen befüllt.\n";
}

// --- Links ---
if (isset($catByType['links'])) {
    $id = $catByType['links']['id'];
    $links = [
        ['name' => 'GitHub',            'content' => 'https://github.com'],
        ['name' => 'Wetterdienst DWD',  'content' => 'https://www.dwd.de'],
        ['name' => 'DB Reiseauskunft',  'content' => 'https://www.bahn.de'],
        ['name' => 'Rezepte – Chefkoch','content' => 'https://www.chefkoch.de'],
        ['name' => 'Nextcloud',         'content' => 'https://nextcloud.com'],
    ];
    foreach ($links as $i => $link) {
        insertItem($db, $userId, $id, $link['name'], [
            'content'    => $link['content'],
            'sort_order' => $i + 1,
        ]);
    }
    echo "Links befüllt.\n";
}

echo "\nFertig! Alle Demodaten eingetragen.\n";
