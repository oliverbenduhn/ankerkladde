<?php
declare(strict_types=1);

$directory = sys_get_temp_dir() . '/ankerkladde-secret-test-' . bin2hex(random_bytes(6));
mkdir($directory, 0700, true);
putenv('EINKAUF_DATA_DIR=' . $directory);

require dirname(__DIR__) . '/security.php';
require dirname(__DIR__) . '/db.php';

try {
    $db = getDatabase();
    $db->prepare('INSERT INTO users (username, password_hash) VALUES (:username, :password_hash)')->execute([
        ':username' => 'secret-test',
        ':password_hash' => password_hash('not-used-here', PASSWORD_DEFAULT),
    ]);
    $userId = (int) $db->lastInsertId();
    $providerSecret = 'provider-secret-must-not-appear-in-sqlite';
    $appApiKey = setUserApiKey($db, $userId);
    updateUserPreferences($db, $userId, ['gemini_api_key' => $providerSecret]);

    $row = $db->query('SELECT api_key, api_key_hash, preferences_json FROM users WHERE id = ' . $userId)->fetch();
    if (!is_array($row)
        || ($row['api_key'] ?? null) !== null
        || !hash_equals(hash('sha256', $appApiKey), (string) ($row['api_key_hash'] ?? ''))
        || str_contains((string) ($row['preferences_json'] ?? ''), $providerSecret)
    ) {
        throw new RuntimeException('Secrets were stored in plaintext.');
    }
    if (findUserByApiKey($db, $appApiKey) !== $userId) {
        throw new RuntimeException('Hashed API-key authentication failed.');
    }
    $preferences = getUserPreferences($db, $userId);
    if (($preferences['gemini_api_key'] ?? '') !== $providerSecret) {
        throw new RuntimeException('Encrypted provider secret did not round-trip.');
    }
    echo "Secret-storage test passed.\n";
} finally {
    $db = null;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $entry) {
        $entry->isDir() ? rmdir($entry->getPathname()) : unlink($entry->getPathname());
    }
    rmdir($directory);
}
