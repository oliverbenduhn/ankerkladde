<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';

enforceCanonicalRequest();
startAppSession();
$basePath = appPath();

// Already logged in → redirect to appropriate page
$alreadyLoggedIn = getCurrentUserId() !== null;
if ($alreadyLoggedIn) {
    header('Location: ' . (empty($_SESSION['is_admin']) ? appPath('index.php') : appPath('admin.php')));
    exit;
}

$error = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $providedToken = $_POST['csrf_token'] ?? null;

    if (!hasValidCsrfToken(is_string($providedToken) ? $providedToken : null)) {
        $error = 'Ungültiges Sicherheits-Token. Bitte Seite neu laden.';
    } else {
        $username = trim((string) ($_POST['username'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');

        if ($username === '' || $password === '') {
            $error = 'Benutzername und Passwort sind erforderlich.';
        } else {
            $db = getDatabase();
            $stmt = $db->prepare(
                'SELECT id, password_hash, is_admin FROM users WHERE username = :username LIMIT 1'
            );
            $stmt->execute([':username' => $username]);
            $user = $stmt->fetch();

            if (is_array($user) && password_verify($password, (string) $user['password_hash'])) {
                session_regenerate_id(true);
                $_SESSION['user_id']  = (int) $user['id'];
                $_SESSION['is_admin'] = (bool) $user['is_admin'];
                header('Location: ' . ($user['is_admin'] ? appPath('admin.php') : appPath('index.php')));
                exit;
            }

            $error = 'Ungültige Anmeldedaten.';
        }
    }
}

$csrfToken = getCsrfToken();
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#f5f0eb">
    <title>Anmelden — Zettel</title>
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('style.css'), ENT_QUOTES, 'UTF-8') ?>">
</head>
<body class="login-page">
<div class="login-card">
    <h1>Zettel</h1>
    <?php if ($error !== null): ?>
        <p class="login-error"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></p>
    <?php endif; ?>
    <form method="post" action="<?= htmlspecialchars(appPath('login.php'), ENT_QUOTES, 'UTF-8') ?>">
        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
        <div class="login-field">
            <label for="username">Benutzername</label>
            <input type="text" id="username" name="username"
                   autocomplete="username" required autofocus
                   value="<?= htmlspecialchars((string) ($_POST['username'] ?? ''), ENT_QUOTES, 'UTF-8') ?>">
        </div>
        <div class="login-field">
            <label for="password">Passwort</label>
            <input type="password" id="password" name="password"
                   autocomplete="current-password" required>
        </div>
        <button type="submit" class="login-btn">Anmelden</button>
    </form>
</div>
</body>
</html>
