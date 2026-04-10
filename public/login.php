<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';

enforceCanonicalRequest();
startAppSession();
$basePath = appPath();
$assetVersion = '26';

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
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-title" content="Ankerkladde">
    <link rel="manifest" href="<?= htmlspecialchars(appPath('manifest.php?v=' . $assetVersion), ENT_QUOTES, 'UTF-8') ?>">
    <title>Anmelden — Ankerkladde</title>
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('style.css?v=' . $assetVersion), ENT_QUOTES, 'UTF-8') ?>">
</head>
<body class="login-page">

<div class="install-banner" id="installBanner" hidden style="position:fixed;top:0;left:0;right:0;z-index:100">
    <span class="install-text">App installieren?</span>
    <button type="button" id="installBtn" class="btn-install">Installieren</button>
    <button type="button" id="installDismiss" class="btn-install-dismiss" aria-label="Schließen">✕</button>
</div>

<div class="login-card">
    <div class="login-brand">
        <img src="<?= htmlspecialchars(appPath('icon.php?size=192'), ENT_QUOTES, 'UTF-8') ?>" alt="Ankerkladde Logo" class="brand-mark brand-mark-login">
        <h1>Ankerkladde</h1>
    </div>
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
<script>
(function () {
    'use strict';
    const basePath = <?= json_encode($basePath, JSON_UNESCAPED_SLASHES) ?>;
    const bannerEl = document.getElementById('installBanner');
    const installBtn = document.getElementById('installBtn');
    const dismissBtn = document.getElementById('installDismiss');
    let deferredPrompt = null;

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register(basePath + 'sw.js?v=26').catch(() => {});
    }

    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferredPrompt = e;
        if (bannerEl) bannerEl.hidden = false;
    });

    installBtn?.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        bannerEl.hidden = true;
        await deferredPrompt.prompt();
        deferredPrompt = null;
    });

    dismissBtn?.addEventListener('click', () => {
        if (bannerEl) bannerEl.hidden = true;
    });
}());
</script>
</body>
</html>
