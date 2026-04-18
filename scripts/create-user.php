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

function validatePassword(string $password): void
{
    if (strlen($password) < 8) {
        fwrite(STDERR, "Passwort muss mindestens 8 Zeichen lang sein.\n");
        exit(1);
    }
}

function createRegularUser(PDO $db, string $username, string $password): int
{
    $username = normalizeUsername($username);

    if ($username === '') {
        throw new InvalidArgumentException('Benutzername darf nicht leer sein.');
    }

    $stmt = $db->prepare(
        'INSERT INTO users (username, password_hash, is_admin) VALUES (:username, :password_hash, 0)'
    );
    $stmt->execute([
        ':username' => $username,
        ':password_hash' => password_hash($password, PASSWORD_BCRYPT),
    ]);

    $userId = (int) $db->lastInsertId();
    createDefaultCategoriesForUser($db, $userId);

    return $userId;
}

$db = getDatabase();

$envVal = getenv('EINKAUF_USER');
$envUser = is_string($envVal) ? normalizeUsername($envVal) : '';
$envVal = getenv('EINKAUF_PASS');
$envPass = is_string($envVal) ? $envVal : '';
unset($envVal);

if ($envUser !== '' && $envPass !== '') {
    $username = $envUser;
    $password = $envPass;
} else {
    echo "=== Nutzer anlegen ===\n";
    $username = normalizeUsername(promptLine('Benutzername: '));
    $password = promptPassword('Passwort: ');
}

validatePassword($password);

try {
    $userId = createRegularUser($db, $username, $password);
    echo "Nutzer '{$username}' angelegt (ID: {$userId}).\n";
} catch (PDOException $e) {
    if (str_contains($e->getMessage(), 'UNIQUE constraint failed')) {
        fwrite(STDERR, "Fehler: Benutzername '{$username}' ist bereits vergeben.\n");
        exit(1);
    }

    throw $e;
}
