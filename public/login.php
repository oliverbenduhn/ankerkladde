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
        header('Location: ' . appPath('index.php?screen=settings&tab=password&required=1'));
    } else {
        header('Location: ' . (empty($_SESSION['is_admin']) ? appPath('index.php') : appPath('admin.php')));
    }
    exit;
}

$error = null;

const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_ATTEMPT_WINDOW_SECONDS = 900;
const LOGIN_LOCK_SECONDS = 900;

function loginIpPrefix(): string
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        $parts = explode('.', $ip);
        return implode('.', array_slice($parts, 0, 3)) . '.0/24';
    }
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
        $packed = inet_pton($ip);
        return $packed === false ? 'unknown' : bin2hex(substr($packed, 0, 7)) . '::/56';
    }
    return 'unknown';
}

function loginAttemptKey(string $username): string
{
    return hash('sha256', strtolower(trim($username)));
}

function isLoginRateLimited(PDO $db, string $username): bool
{
    $stmt = $db->prepare(
        'SELECT locked_until FROM login_attempts WHERE username_key = :username_key AND ip_prefix = :ip_prefix'
    );
    $stmt->execute([':username_key' => loginAttemptKey($username), ':ip_prefix' => loginIpPrefix()]);
    $lockedUntil = $stmt->fetchColumn();
    return $lockedUntil !== false && (int) $lockedUntil > time();
}

function recordLoginFailure(PDO $db, string $username): void
{
    $now = time();
    $stmt = $db->prepare(
        'INSERT INTO login_attempts (username_key, ip_prefix, failure_count, window_started_at, locked_until)
         VALUES (:username_key, :ip_prefix, 1, :now, 0)
         ON CONFLICT(username_key, ip_prefix) DO UPDATE SET
            failure_count = CASE
                WHEN login_attempts.window_started_at < :window_start THEN 1
                ELSE login_attempts.failure_count + 1
            END,
            window_started_at = CASE
                WHEN login_attempts.window_started_at < :window_start THEN :now
                ELSE login_attempts.window_started_at
            END,
            locked_until = CASE
                WHEN (CASE WHEN login_attempts.window_started_at < :window_start THEN 1 ELSE login_attempts.failure_count + 1 END) >= :attempt_limit
                THEN :locked_until ELSE login_attempts.locked_until END'
    );
    $stmt->execute([
        ':username_key' => loginAttemptKey($username),
        ':ip_prefix' => loginIpPrefix(),
        ':now' => $now,
        ':window_start' => $now - LOGIN_ATTEMPT_WINDOW_SECONDS,
        ':attempt_limit' => LOGIN_ATTEMPT_LIMIT,
        ':locked_until' => $now + LOGIN_LOCK_SECONDS,
    ]);
}

function clearLoginFailures(PDO $db, string $username): void
{
    $stmt = $db->prepare('DELETE FROM login_attempts WHERE username_key = :username_key AND ip_prefix = :ip_prefix');
    $stmt->execute([':username_key' => loginAttemptKey($username), ':ip_prefix' => loginIpPrefix()]);
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
            $db = getDatabase();
            if (isLoginRateLimited($db, $username)) {
                $error = t('login.invalid_credentials');
            } else {
            $stmt = $db->prepare(
                'SELECT id, password_hash, is_admin, must_change_password FROM users WHERE username = :username LIMIT 1'
            );
            $stmt->execute([':username' => $username]);
            $user = $stmt->fetch();
            // Release the WAL read snapshot before password verification and
            // the subsequent write to login_attempts. Another worker may write
            // meanwhile; upgrading that stale snapshot would fail immediately.
            $stmt->closeCursor();

            if (is_array($user) && password_verify($password, (string) $user['password_hash'])) {
                clearLoginFailures($db, $username);
                session_regenerate_id(true);
                $_SESSION['user_id']  = (int) $user['id'];
                $_SESSION['is_admin'] = (bool) $user['is_admin'];
                $_SESSION['must_change_password'] = (bool) ($user['must_change_password'] ?? false);
                if ($_SESSION['must_change_password']) {
                    header('Location: ' . appPath('index.php?screen=settings&tab=password&required=1'));
                } else {
                    header('Location: ' . ($user['is_admin'] ? appPath('admin.php') : appPath('index.php')));
                }
                exit;
            }

            recordLoginFailure($db, $username);
            $error = t('login.invalid_credentials');
            }
        }
    }
}

$csrfToken = getCsrfToken();
?>
<!DOCTYPE html>
<html lang="<?= htmlspecialchars(getCurrentLanguage(), ENT_QUOTES, 'UTF-8') ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
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

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register(basePath + 'sw.js?v=<?= urlencode($assetVersion) ?>').catch(() => {});
    }
}());
</script>
<nav class="legal-footer" aria-label="Rechtliche Hinweise">
  <a href="<?= htmlspecialchars(appPath('legal/impressum.php'), ENT_QUOTES, 'UTF-8') ?>">Impressum</a>
  <span aria-hidden="true">·</span>
  <a href="<?= htmlspecialchars(appPath('legal/datenschutz.php'), ENT_QUOTES, 'UTF-8') ?>">Datenschutz</a>
</nav>
</body>
</html>
