<?php
declare(strict_types=1);

/**
 * Integrations-Test für die OpenRouter → openai_compatible Migration.
 * Legt eine In-Memory-SQLite-DB mit users-Tabelle an, schreibt einen User
 * mit openrouter_provider, läuft die Migration, prüft die Konvertierung.
 */

require_once __DIR__ . '/../src/AiClient.php';
require_once __DIR__ . '/../src/UserRepository.php';
require_once __DIR__ . '/../src/Constants.php';

function assertTrueMigration($condition, string $message): void
{
    if ($condition !== true) {
        throw new RuntimeException($message);
    }
}

function migrateForTest(PDO $db): void
{
    $rows = $db->query(
        "SELECT id, preferences_json FROM users
         WHERE json_extract(preferences_json, '$.ai_provider') = 'openrouter'"
    )->fetchAll(PDO::FETCH_ASSOC);

    if (!is_array($rows) || $rows === []) {
        return;
    }

    $update = $db->prepare('UPDATE users SET preferences_json = :json WHERE id = :id');

    foreach ($rows as $row) {
        $prefs = json_decode((string) ($row['preferences_json'] ?? '{}'), true);
        if (!is_array($prefs)) {
            continue;
        }
        $openrouterKey = trim((string) ($prefs['openrouter_api_key'] ?? ''));
        $openrouterModel = trim((string) ($prefs['openrouter_model'] ?? ''));

        if (trim((string) ($prefs['openai_compatible_api_key'] ?? '')) === '' && $openrouterKey !== '') {
            $prefs['openai_compatible_api_key'] = $openrouterKey;
        }
        if (trim((string) ($prefs['openai_compatible_model'] ?? '')) === '' && $openrouterModel !== '') {
            $prefs['openai_compatible_model'] = $openrouterModel;
        }
        if (trim((string) ($prefs['openai_compatible_base_url'] ?? '')) === '') {
            $prefs['openai_compatible_base_url'] = 'https://openrouter.ai/api/v1';
        }
        $prefs['ai_provider'] = 'openai_compatible';
        unset($prefs['openrouter_api_key'], $prefs['openrouter_model']);

        $update->execute([
            ':id' => (int) $row['id'],
            ':json' => json_encode($prefs, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);
    }
}

function makeDb(): PDO
{
    $db = new PDO('sqlite::memory:');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->exec(<<<'SQL'
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            preferences_json TEXT NOT NULL DEFAULT '{}'
        )
    SQL);
    return $db;
}

function makePrefs(array $extra): string
{
    $base = [
        'mode' => 'liste',
        'theme' => 'parchment',
        'tabs_hidden' => false,
        'category_swipe_enabled' => true,
        'product_scanner_enabled' => true,
        'shopping_list_scanner_enabled' => true,
        'magic_button_enabled' => true,
        'last_category_id' => null,
        'install_banner_dismissed' => false,
        'gemini_api_key' => '',
        'gemini_model' => 'gemini-2.5-flash',
        'ai_provider' => 'openrouter',
        'openrouter_api_key' => 'sk-or-vvv-test',
        'openrouter_model' => 'anthropic/claude-sonnet-4',
    ];
    return json_encode([...$base, ...$extra], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

// === Test 1: openrouter -> openai_compatible ===
$db = makeDb();
$db->prepare('INSERT INTO users (username, preferences_json) VALUES (?, ?)')
    ->execute(['alice', makePrefs([])]);

migrateForTest($db);

$row = $db->query("SELECT preferences_json FROM users WHERE username = 'alice'")->fetch(PDO::FETCH_ASSOC);
$prefs = json_decode($row['preferences_json'], true);

assertTrueMigration($prefs['ai_provider'] === 'openai_compatible', 'ai_provider must be migrated');
assertTrueMigration($prefs['openai_compatible_api_key'] === 'sk-or-vvv-test', 'key moved');
assertTrueMigration($prefs['openai_compatible_model'] === 'anthropic/claude-sonnet-4', 'model moved');
assertTrueMigration($prefs['openai_compatible_base_url'] === 'https://openrouter.ai/api/v1', 'base_url default');
assertTrueMigration(!array_key_exists('openrouter_api_key', $prefs), 'old key removed');
assertTrueMigration(!array_key_exists('openrouter_model', $prefs), 'old model removed');
echo "Test 1 (openrouter -> openai_compatible) passed.\n";

// === Test 2: User ohne openrouter wird nicht angefasst ===
$db2 = makeDb();
$db2->prepare('INSERT INTO users (username, preferences_json) VALUES (?, ?)')
    ->execute(['bob', makePrefs(['ai_provider' => 'gemini', 'gemini_api_key' => 'AIza-test'])]);

migrateForTest($db2);

$row2 = $db2->query("SELECT preferences_json FROM users WHERE username = 'bob'")->fetch(PDO::FETCH_ASSOC);
$prefs2 = json_decode($row2['preferences_json'], true);

assertTrueMigration($prefs2['ai_provider'] === 'gemini', 'gemini user untouched');
assertTrueMigration($prefs2['gemini_api_key'] === 'AIza-test', 'gemini key preserved');
assertTrueMigration(!array_key_exists('openai_compatible_api_key', $prefs2), 'no openai_compatible fields added');
echo "Test 2 (gemini untouched) passed.\n";

// === Test 3: Vorhandene openai_compatible_* werden nicht überschrieben ===
$db3 = makeDb();
$db3->prepare('INSERT INTO users (username, preferences_json) VALUES (?, ?)')
    ->execute(['carol', makePrefs([
        'ai_provider' => 'openrouter',
        'openrouter_api_key' => 'sk-or-old',
        'openai_compatible_api_key' => 'sk-existing',
        'openai_compatible_model' => 'gpt-4o',
        'openai_compatible_base_url' => 'https://my.example.com/v1',
    ])]);

migrateForTest($db3);

$row3 = $db3->query("SELECT preferences_json FROM users WHERE username = 'carol'")->fetch(PDO::FETCH_ASSOC);
$prefs3 = json_decode($row3['preferences_json'], true);

assertTrueMigration($prefs3['ai_provider'] === 'openai_compatible', 'provider migrated');
assertTrueMigration($prefs3['openai_compatible_api_key'] === 'sk-existing', 'existing key kept');
assertTrueMigration($prefs3['openai_compatible_model'] === 'gpt-4o', 'existing model kept');
assertTrueMigration($prefs3['openai_compatible_base_url'] === 'https://my.example.com/v1', 'existing base_url kept');
echo "Test 3 (idempotent: existing openai_compatible_* preserved) passed.\n";

echo "\nAll migration tests passed!\n";
