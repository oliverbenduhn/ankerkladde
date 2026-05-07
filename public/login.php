<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require __DIR__ . '/theme.php';

enforceCanonicalRequest();
sendHtmlPageSecurityHeaders();
startAppSession();
$basePath = appPath();
$assetVersion = require __DIR__ . '/version.php';
$defaultThemePreferences = getThemePreferenceDefaults();
$effectiveTheme = resolveEffectiveTheme($defaultThemePreferences);
$themeColor = getThemeColor($effectiveTheme);
$brandMarkSrc = appPath('icon.php?size=192&theme=' . rawurlencode($effectiveTheme) . '&v=' . rawurlencode($assetVersion));

// Already logged in → redirect to appropriate page
$alreadyLoggedIn = getCurrentUserId() !== null;
if ($alreadyLoggedIn) {
    if (isPasswordChangeRequired()) {
        header('Location: ' . appPath('settings.php?tab=password&required=1'));
    } else {
        header('Location: ' . (empty($_SESSION['is_admin']) ? appPath('index.php') : appPath('admin.php')));
    }
    exit;
}

$error = null;

// Brute-force protection: track failed login attempts in the session.
// After 5 failures an exponential delay (up to 30 s) is applied before
// each attempt, making automated password guessing impractical.
const LOGIN_ATTEMPT_DELAY_FREE = 5;       // attempts before delay kicks in
const LOGIN_ATTEMPT_DELAY_MAX_US = 30_000_000; // 30 s ceiling in microseconds

function getLoginFailureCount(): int
{
    return (int) ($_SESSION['login_failures'] ?? 0);
}

function incrementLoginFailureCount(): void
{
    $_SESSION['login_failures'] = getLoginFailureCount() + 1;
}

function resetLoginFailureCount(): void
{
    unset($_SESSION['login_failures']);
}

function applyLoginBruteForceDelay(): void
{
    $failures = getLoginFailureCount();
    if ($failures < LOGIN_ATTEMPT_DELAY_FREE) {
        return;
    }

    // 2^(failures-5) seconds, capped at LOGIN_ATTEMPT_DELAY_MAX_US
    $delayUs = min(
        (int) (1_000_000 * (2 ** ($failures - LOGIN_ATTEMPT_DELAY_FREE))),
        LOGIN_ATTEMPT_DELAY_MAX_US
    );
    usleep($delayUs);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $providedToken = $_POST['csrf_token'] ?? null;

    if (!hasValidCsrfToken(is_string($providedToken) ? $providedToken : null)) {
        $error = t('login.invalid_csrf');
    } else {
        $username = normalizeUsername((string) ($_POST['username'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');

        if ($username === '' || $password === '') {
            $error = t('login.credentials_required');
        } else {
            // Apply delay before verifying — delay scales with prior failures
            applyLoginBruteForceDelay();

            $db = getDatabase();
            $stmt = $db->prepare(
                'SELECT id, password_hash, is_admin, must_change_password FROM users WHERE username = :username LIMIT 1'
            );
            $stmt->execute([':username' => $username]);
            $user = $stmt->fetch();

            if (is_array($user) && password_verify($password, (string) $user['password_hash'])) {
                resetLoginFailureCount();
                session_regenerate_id(true);
                $_SESSION['user_id']  = (int) $user['id'];
                $_SESSION['is_admin'] = (bool) $user['is_admin'];
                $_SESSION['must_change_password'] = (bool) ($user['must_change_password'] ?? false);
                if ($_SESSION['must_change_password']) {
                    header('Location: ' . appPath('settings.php?tab=password&required=1'));
                } else {
                    header('Location: ' . ($user['is_admin'] ? appPath('admin.php') : appPath('index.php')));
                }
                exit;
            }

            incrementLoginFailureCount();
            $error = t('login.invalid_credentials');
        }
    }
}

$csrfToken = getCsrfToken();
?>
<!DOCTYPE html>
<html lang="<?= htmlspecialchars(getCurrentLanguage(), ENT_QUOTES, 'UTF-8') ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="<?= htmlspecialchars($themeColor, ENT_QUOTES, 'UTF-8') ?>">
    <?= renderThemeBootScript($defaultThemePreferences) ?>
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-title" content="Ankerkladde">
    <link rel="manifest" href="<?= htmlspecialchars(appPath('manifest.php?v=' . $assetVersion), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="icon" type="image/png" href="<?= htmlspecialchars(appPath('icon.php?size=96&v=' . rawurlencode($assetVersion)), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="apple-touch-icon" href="<?= htmlspecialchars(appPath('icon.php?size=180&v=' . rawurlencode($assetVersion)), ENT_QUOTES, 'UTF-8') ?>">
    <title><?= t('login.title') ?></title>
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('theme-css.php'), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('style.css?v=' . $assetVersion), ENT_QUOTES, 'UTF-8') ?>">
</head>
<body class="login-page" data-theme="<?= htmlspecialchars($effectiveTheme, ENT_QUOTES, 'UTF-8') ?>">

<div class="install-banner" id="installBanner" hidden style="position:fixed;top:0;left:0;right:0;z-index:100">
    <span class="install-text"><?= t('ui.install_prompt') ?></span>
    <button type="button" id="installBtn" class="btn-install"><?= t('ui.install') ?></button>
    <button type="button" id="installDismiss" class="btn-install-dismiss" aria-label="<?= t('ui.close') ?>">✕</button>
</div>

<div class="login-card">
    <div class="login-brand">
        <img src="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>" alt="Ankerkladde Logo" class="brand-mark brand-mark-login">
        <h1>Ankerkladde</h1>
    </div>
    <?php if ($error !== null): ?>
        <p class="login-error" role="alert"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></p>
    <?php endif; ?>
    <form method="post" action="<?= htmlspecialchars(appPath('login.php'), ENT_QUOTES, 'UTF-8') ?>">
        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
        <div class="login-field">
            <label for="username"><?= t('login.username') ?></label>
            <input type="text" id="username" name="username"
                   autocomplete="username" required autofocus
                   <?= $error !== null ? 'aria-invalid="true"' : '' ?>
                   value="<?= htmlspecialchars((string) ($_POST['username'] ?? ''), ENT_QUOTES, 'UTF-8') ?>">
        </div>
        <div class="login-field">
            <label for="password"><?= t('login.password') ?></label>
            <input type="password" id="password" name="password"
                   autocomplete="current-password" required
                   <?= $error !== null ? 'aria-invalid="true"' : '' ?>
                   enterkeyhint="go">
        </div>
        <button type="submit" class="login-btn"><?= t('login.submit') ?></button>
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
        navigator.serviceWorker.register(basePath + 'sw.js?v=<?= urlencode($assetVersion) ?>').catch(() => {});
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
