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

function promptPassword(string $prompt): string
{
    echo $prompt;
    system('stty -echo');
    $value = trim((string) fgets(STDIN));
    system('stty echo');
    echo "\n";
    if ($value === '') {
        fwrite(STDERR, "Passwort darf nicht leer sein.\n");
        exit(1);
    }
    return $value;
}

function createUser(PDO $db, string $username, string $password, bool $isAdmin): int
{
    $username = normalizeUsername($username);

    if ($username === '') {
        throw new InvalidArgumentException('Benutzername darf nicht leer sein.');
    }

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
$envVal = getenv('EINKAUF_ADMIN_USER');
$envAdminUser = is_string($envVal) ? normalizeUsername($envVal) : '';
$envVal = getenv('EINKAUF_ADMIN_PASS');
$envAdminPass = is_string($envVal) ? $envVal : '';

if ($envAdminUser !== '' && $envAdminPass !== '') {
    try {
        $adminId = createUser($db, $envAdminUser, $envAdminPass, true);
        echo "Admin '{$envAdminUser}' angelegt (ID: {$adminId}).\n";
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'UNIQUE constraint failed')) {
            fwrite(STDERR, "Fehler: Benutzername '{$envAdminUser}' ist bereits vergeben.\n");
            exit(1);
        }
        throw $e;
    }
} else {
    echo "=== Admin-Nutzer anlegen ===\n";
    $adminUser = promptLine('Benutzername: ');
    $adminPass = promptPassword('Passwort: ');
    if (strlen($adminPass) < 8) {
        fwrite(STDERR, "Passwort muss mindestens 8 Zeichen lang sein.\n");
        exit(1);
    }
    try {
        $adminId = createUser($db, $adminUser, $adminPass, true);
        echo "Admin '{$adminUser}' angelegt (ID: {$adminId}).\n";
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'UNIQUE constraint failed')) {
            fwrite(STDERR, "Fehler: Benutzername '{$adminUser}' ist bereits vergeben.\n");
            exit(1);
        }
        throw $e;
    }
}

// Optionally create a first regular user and assign existing items
$envVal = getenv('EINKAUF_REGULAR_USER');
$envRegularUser = is_string($envVal) ? normalizeUsername($envVal) : '';
$envVal = getenv('EINKAUF_REGULAR_PASS');
$envRegularPass = is_string($envVal) ? $envVal : '';
unset($envVal);

if ($envRegularUser !== '' && $envRegularPass !== '') {
    try {
        $userId = createUser($db, $envRegularUser, $envRegularPass, false);
        $db->prepare('UPDATE items SET user_id = :uid WHERE user_id IS NULL')
           ->execute([':uid' => $userId]);
        $count = $db->query('SELECT changes()')->fetchColumn();
        echo "Nutzer '{$envRegularUser}' angelegt (ID: {$userId}), {$count} Items zugewiesen.\n";
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'UNIQUE constraint failed')) {
            fwrite(STDERR, "Fehler: Benutzername '{$envRegularUser}' ist bereits vergeben.\n");
            exit(1);
        }
        throw $e;
    }
} else {
    $orphanCount = (int) $db->query('SELECT COUNT(*) FROM items WHERE user_id IS NULL')->fetchColumn();
    if ($orphanCount > 0) {
        echo "\n{$orphanCount} vorhandene Item(s) ohne Nutzer gefunden.\n";
        echo "Regulären Nutzer anlegen und Items zuweisen? [j/N] ";
        $answer = strtolower(trim((string) fgets(STDIN)));
        if ($answer === 'j') {
            $regularUser = promptLine('Benutzername: ');
            $regularPass = promptPassword('Passwort: ');
            if (strlen($regularPass) < 8) {
                fwrite(STDERR, "Passwort muss mindestens 8 Zeichen lang sein.\n");
                exit(1);
            }
            try {
                $userId = createUser($db, $regularUser, $regularPass, false);
                $db->prepare('UPDATE items SET user_id = :uid WHERE user_id IS NULL')
                   ->execute([':uid' => $userId]);
                $count = $db->query('SELECT changes()')->fetchColumn();
                echo "Nutzer '{$regularUser}' angelegt, {$count} Items zugewiesen.\n";
            } catch (PDOException $e) {
                if (str_contains($e->getMessage(), 'UNIQUE constraint failed')) {
                    fwrite(STDERR, "Fehler: Benutzername '{$regularUser}' ist bereits vergeben.\n");
                    exit(1);
                }
                throw $e;
            }
        }
    }
}

echo "Fertig.\n";
