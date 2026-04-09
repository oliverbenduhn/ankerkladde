#!/usr/bin/env php
<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';

function promptLine(string $prompt, bool $required = true): string
{
    while (true) {
        echo $prompt;
        $value = fgets(STDIN);
        if ($value === false) {
            // EOF reached
            exit(1);
        }
        $value = trim($value);
        if (!$required || $value !== '') {
            return $value;
        }
        echo "Eingabe darf nicht leer sein.\n";
    }
}

function createUser(PDO $db, string $username, string $password, bool $isAdmin): int
{
    $stmt = $db->prepare(
        'INSERT INTO users (username, password_hash, is_admin) VALUES (:username, :password_hash, :is_admin)'
    );
    $stmt->execute([
        ':username'      => $username,
        ':password_hash' => password_hash($password, PASSWORD_BCRYPT),
        ':is_admin'      => $isAdmin ? 1 : 0,
    ]);
    return (int) $db->lastInsertId();
}

$db = getDatabase();

// Check if an admin already exists
$existingAdmin = $db->query('SELECT id, username FROM users WHERE is_admin = 1 LIMIT 1')->fetch();
if ($existingAdmin !== false) {
    echo "Admin-Nutzer bereits vorhanden: {$existingAdmin['username']}\n";
    exit(0);
}

// Non-interactive mode via env vars
$envAdminUser = (string) (getenv('EINKAUF_ADMIN_USER') ?: '');
$envAdminPass = (string) (getenv('EINKAUF_ADMIN_PASS') ?: '');

if ($envAdminUser !== '' && $envAdminPass !== '') {
    $adminId = createUser($db, $envAdminUser, $envAdminPass, true);
    echo "Admin '{$envAdminUser}' angelegt (ID: {$adminId}).\n";
} else {
    echo "=== Admin-Nutzer anlegen ===\n";
    $adminUser = promptLine('Benutzername: ');
    $adminPass = promptLine('Passwort: ');
    $adminId   = createUser($db, $adminUser, $adminPass, true);
    echo "Admin '{$adminUser}' angelegt (ID: {$adminId}).\n";
}

// Optionally create a first regular user and assign existing items
$envRegularUser = (string) (getenv('EINKAUF_REGULAR_USER') ?: '');
$envRegularPass = (string) (getenv('EINKAUF_REGULAR_PASS') ?: '');

if ($envRegularUser !== '' && $envRegularPass !== '') {
    $userId = createUser($db, $envRegularUser, $envRegularPass, false);
    $db->prepare('UPDATE items SET user_id = :uid WHERE user_id IS NULL')
       ->execute([':uid' => $userId]);
    $count = $db->query('SELECT changes()')->fetchColumn();
    echo "Nutzer '{$envRegularUser}' angelegt (ID: {$userId}), {$count} Items zugewiesen.\n";
} else {
    $orphanCount = (int) $db->query('SELECT COUNT(*) FROM items WHERE user_id IS NULL')->fetchColumn();
    if ($orphanCount > 0) {
        echo "\n{$orphanCount} vorhandene Item(s) ohne Nutzer gefunden.\n";
        echo "Regulären Nutzer anlegen und Items zuweisen? [j/N] ";
        $answer = strtolower(trim((string) fgets(STDIN)));
        if ($answer === 'j') {
            $regularUser = promptLine('Benutzername: ');
            $regularPass = promptLine('Passwort: ');
            $userId = createUser($db, $regularUser, $regularPass, false);
            $db->prepare('UPDATE items SET user_id = :uid WHERE user_id IS NULL')
               ->execute([':uid' => $userId]);
            $count = $db->query('SELECT changes()')->fetchColumn();
            echo "Nutzer '{$regularUser}' angelegt, {$count} Items zugewiesen.\n";
        }
    }
}

echo "Fertig.\n";
