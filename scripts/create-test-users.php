#!/usr/bin/env php
<?php
declare(strict_types=1);

// Legt fuer jeden uebergebenen Username einen Test-Nutzer an. Leise gegen
// bereits existierende Usernames (UNIQUE-Constraint). Wird vom
// Playwright-Testserver (scripts/ui-test-server.sh) aufgerufen, wenn
// PW_WORKER_COUNT > 1, damit jeder parallele Worker seinen eigenen
// Datenbestand hat.
//
// ENV: PW_USERS = kommagetrennte Liste, z. B. "playwright-user-1,playwright-user-2,playwright-user-3"
//      PW_PASS  = Passwort fuer alle (default "playwright-pass")

require dirname(__DIR__) . '/security.php';
require dirname(__DIR__) . '/db.php';

function pwCreateUser(PDO $db, string $username, string $password): int
{
    $username = normalizeUsername($username);
    if ($username === '') {
        throw new InvalidArgumentException('Benutzername darf nicht leer sein.');
    }
    $stmt = $db->prepare(
        'INSERT INTO users (username, password_hash, is_admin, must_change_password)
         VALUES (:username, :password_hash, 0, 0)'
    );
    $stmt->execute([
        ':username'      => $username,
        ':password_hash' => password_hash($password, PASSWORD_BCRYPT),
    ]);
    return (int) $db->lastInsertId();
}

$envVal = getenv('PW_USERS');
$usersRaw = is_string($envVal) ? trim($envVal) : '';
if ($usersRaw === '') {
    fwrite(STDERR, "PW_USERS ist leer — nichts zu tun.\n");
    exit(0);
}

$envVal = getenv('PW_PASS');
$password = is_string($envVal) && $envVal !== '' ? $envVal : 'playwright-pass';

$db = getDatabase();

$usernames = array_values(array_filter(array_map('trim', explode(',', $usersRaw))));
foreach ($usernames as $username) {
    $username = normalizeUsername($username);
    if ($username === '') {
        continue;
    }
    $check = $db->prepare('SELECT id FROM users WHERE username = :u LIMIT 1');
    $check->execute([':u' => $username]);
    if ($check->fetchColumn() !== false) {
        // ponytail: idempotent — Worker-Restart legt nicht doppelt an
        continue;
    }
    try {
        $userId = pwCreateUser($db, $username, $password);
        createDefaultCategoriesForUser($db, $userId);
        echo "Test-User '{$username}' angelegt (ID: {$userId}).\n";
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'UNIQUE constraint failed')) {
            // race: Worker-Restart zwischen check und insert
            continue;
        }
        throw $e;
    }
}
