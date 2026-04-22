<?php
declare(strict_types=1);

$_envCanonicalHost = getenv('ANKERKLADDE_CANONICAL_HOST');
define('EINKAUF_CANONICAL_HOST', $_envCanonicalHost !== false ? (string)$_envCanonicalHost : 'ankerkladde.benduhn.de');
unset($_envCanonicalHost);

function getEnvBool(string $name): ?bool
{
    $value = getenv($name);

    if (!is_string($value) || trim($value) === '') {
        return null;
    }

    return match (strtolower(trim($value))) {
        '1', 'true', 'yes', 'on' => true,
        '0', 'false', 'no', 'off' => false,
        default => null,
    };
}

function getEnvInt(string $name): ?int
{
    $value = getenv($name);

    if (!is_string($value) || trim($value) === '') {
        return null;
    }

    $value = trim($value);
    if (!preg_match('/^-?\d+$/', $value)) {
        return null;
    }

    return (int) $value;
}

function getSessionLifetimeSeconds(): int
{
    $configuredDays = getEnvInt('ANKERKLADDE_SESSION_LIFETIME_DAYS');
    if ($configuredDays !== null) {
        return max(0, $configuredDays) * 24 * 60 * 60;
    }

    return 30 * 24 * 60 * 60;
}

function getSessionDirectory(): string
{
    return getDataDirectory() . '/sessions';
}

function getRequestHeaderValue(string $serverKey): ?string
{
    $value = $_SERVER[$serverKey] ?? null;

    if (!is_string($value) || trim($value) === '') {
        return null;
    }

    $parts = array_map('trim', explode(',', $value));
    $firstPart = $parts[0] ?? null;

    return is_string($firstPart) && $firstPart !== '' ? $firstPart : null;
}

function isTrustedProxyPeer(?string $remoteAddress): bool
{
    if (!is_string($remoteAddress) || trim($remoteAddress) === '') {
        return false;
    }

    $remoteAddress = trim($remoteAddress);

    if (filter_var($remoteAddress, FILTER_VALIDATE_IP) === false) {
        return false;
    }

    return $remoteAddress === '127.0.0.1' || $remoteAddress === '::1';
}

function shouldTrustProxyHeaders(): bool
{
    $configured = getEnvBool('EINKAUF_TRUST_PROXY_HEADERS');
    if ($configured !== null) {
        return $configured;
    }

    return isTrustedProxyPeer($_SERVER['REMOTE_ADDR'] ?? null);
}

function getRequestHost(): string
{
    $host = (shouldTrustProxyHeaders() ? getRequestHeaderValue('HTTP_X_FORWARDED_HOST') : null)
        ?? getRequestHeaderValue('HTTP_HOST')
        ?? getRequestHeaderValue('SERVER_NAME')
        ?? '';

    return strtolower(preg_replace('/:\d+$/', '', trim($host)) ?? '');
}

function isRequestHttps(): bool
{
    if (shouldTrustProxyHeaders()) {
        $forwardedProto = strtolower(getRequestHeaderValue('HTTP_X_FORWARDED_PROTO') ?? '');
        if ($forwardedProto === 'https') {
            return true;
        }
    }

    $https = strtolower((string) ($_SERVER['HTTPS'] ?? ''));
    if ($https !== '' && $https !== 'off') {
        return true;
    }

    $requestScheme = strtolower((string) ($_SERVER['REQUEST_SCHEME'] ?? ''));
    return $requestScheme === 'https';
}

function isLocalDevelopmentHost(string $host): bool
{
    return $host === ''
        || $host === 'localhost'
        || $host === '127.0.0.1'
        || $host === '[::1]'
        || str_ends_with($host, '.localhost');
}

function isCanonicalProductionHost(string $host): bool
{
    return $host === EINKAUF_CANONICAL_HOST;
}

function getCanonicalAppOrigin(): string
{
    $host = trim(EINKAUF_CANONICAL_HOST);

    if ($host === '') {
        $requestHost = getRequestHost();
        if ($requestHost !== '') {
            return (isRequestHttps() ? 'https://' : 'http://') . $requestHost;
        }

        return 'http://localhost';
    }

    return 'https://' . $host;
}

function enforceCanonicalRequest(): void
{
    if (EINKAUF_CANONICAL_HOST === '') {
        return;
    }

    $host = getRequestHost();

    if (isLocalDevelopmentHost($host)) {
        return;
    }

    if (isCanonicalProductionHost($host)) {
        return;
    }

    $requestUri = $_SERVER['REQUEST_URI'] ?? '/';
    if (!is_string($requestUri) || $requestUri === '') {
        $requestUri = '/';
    }

    header('Location: https://' . EINKAUF_CANONICAL_HOST . $requestUri, true, 308);
    exit;
}

function startAppSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    $sessionLifetime = getSessionLifetimeSeconds();
    if ($sessionLifetime > 0) {
        ini_set('session.gc_maxlifetime', (string) $sessionLifetime);
    }

    $sessionDir = getSessionDirectory();
    if (!is_dir($sessionDir) && !mkdir($sessionDir, 0775, true) && !is_dir($sessionDir)) {
        throw new RuntimeException('Session-Verzeichnis konnte nicht erstellt werden: ' . $sessionDir);
    }
    ini_set('session.save_path', $sessionDir);

    $cookiePath = getAppBasePath();
    if ($cookiePath === '') {
        $cookiePath = '/';
    } elseif (!str_ends_with($cookiePath, '/')) {
        $cookiePath .= '/';
    }

    session_set_cookie_params([
        'lifetime' => $sessionLifetime,
        'httponly' => true,
        'path' => $cookiePath,
        'samesite' => 'Lax',
        'secure' => isRequestHttps(),
    ]);

    session_start();
}

function getAppBasePath(): string
{
    $scriptName = $_SERVER['SCRIPT_NAME'] ?? '';
    $basePath = rtrim(dirname(str_replace('\\', '/', is_string($scriptName) ? $scriptName : '')), '/');

    return $basePath === '' || $basePath === '.' ? '' : $basePath;
}

function appPath(string $path = ''): string
{
    $normalizedPath = ltrim($path, '/');
    $basePath = getAppBasePath();

    if ($normalizedPath === '') {
        return $basePath === '' ? '/' : $basePath . '/';
    }

    return ($basePath === '' ? '' : $basePath) . '/' . $normalizedPath;
}

function getCsrfToken(): string
{
    startAppSession();

    if (!isset($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }

    return $_SESSION['csrf_token'];
}

function hasValidCsrfToken(?string $providedToken): bool
{
    startAppSession();

    $sessionToken = $_SESSION['csrf_token'] ?? null;

    return is_string($sessionToken)
        && is_string($providedToken)
        && hash_equals($sessionToken, $providedToken);
}

function getCurrentUserId(): ?int
{
    // Does not start the session — callers must ensure the session is active.
    if (session_status() !== PHP_SESSION_ACTIVE) {
        return null;
    }

    $id = $_SESSION['user_id'] ?? null;
    return is_int($id) ? $id : null;
}

function isPasswordChangeRequired(): bool
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        return false;
    }

    return ($_SESSION['must_change_password'] ?? false) === true;
}

function enforcePasswordChangeRedirect(): void
{
    if (!isPasswordChangeRequired()) {
        return;
    }

    $scriptName = basename((string) ($_SERVER['SCRIPT_NAME'] ?? ''));
    $allowedScripts = ['settings.php', 'logout.php', 'login.php'];

    if (in_array($scriptName, $allowedScripts, true)) {
        return;
    }

    http_response_code(302);
    header('Location: ' . appPath('settings.php?tab=password&required=1'));
    exit;
}

function requireAuth(): int
{
    startAppSession();
    $userId = getCurrentUserId();

    if ($userId === null) {
        http_response_code(302);
        header('Location: ' . appPath('login.php'));
        exit;
    }

    enforcePasswordChangeRedirect();

    return $userId;
}

function requireAdmin(): int
{
    $userId = requireAuth();

    if (($_SESSION['is_admin'] ?? false) !== true) {
        http_response_code(403);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Kein Zugriff.';
        exit;
    }

    return $userId;
}

function requireApiAuth(): int
{
    startAppSession();
    $userId = getCurrentUserId();

    if ($userId === null) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Nicht authentifiziert. Bitte anmelden.'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if (isPasswordChangeRequired()) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Passwortwechsel erforderlich. Bitte zuerst in den Einstellungen ein neues Passwort setzen.'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    return $userId;
}

function requireApiAuthWithKey(PDO $db): int
{
    startAppSession();

    $userId = getCurrentUserId();
    if ($userId !== null) {
        if (isPasswordChangeRequired()) {
            http_response_code(403);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['error' => 'Passwortwechsel erforderlich. Bitte zuerst in den Einstellungen ein neues Passwort setzen.'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $_SERVER['ANKERKLADDE_API_AUTH_KIND'] = 'session';
        return $userId;
    }

    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['HTTP_X_API_KEY'] ?? null;
    if (!is_string($authHeader) || trim($authHeader) === '') {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Nicht authentifiziert. Bitte API-Key verwenden.'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $apiKey = preg_replace('/^Bearer\s+/i', '', trim($authHeader)) ?? '';
    if ($apiKey === '') {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Ungültiger API-Key.'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $userId = findUserByApiKey($db, $apiKey);
    if ($userId === null) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Ungültiger API-Key.'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $_SERVER['ANKERKLADDE_API_AUTH_KIND'] = 'key';

    return $userId;
}

function isApiKeyAuthRequest(): bool
{
    return (string) ($_SERVER['ANKERKLADDE_API_AUTH_KIND'] ?? '') === 'key';
}

/**
 * Sends Content-Security-Policy and X-Frame-Options headers for HTML pages.
 *
 * Call this before any output is sent on every PHP page that returns HTML.
 *
 * $allowEsmSh — set to true only for pages that load TipTap from esm.sh
 * (currently index.php). All other pages use a tighter policy.
 *
 * $allowSameOriginFraming — set to true only for pages intentionally embedded
 * by the app shell on the same origin (currently settings.php).
 */
function sendHtmlPageSecurityHeaders(bool $allowEsmSh = false, bool $allowSameOriginFraming = false): void
{
    // Prevent cross-origin embedding while allowing explicit same-origin app embeds.
    header('X-Frame-Options: ' . ($allowSameOriginFraming ? 'SAMEORIGIN' : 'DENY'));

    $scriptSrc = "'self' 'unsafe-inline'";
    $connectSrc = "'self'";

    if ($allowEsmSh) {
        // TipTap and its transitive ESM dependencies are loaded from esm.sh
        $scriptSrc  .= ' https://esm.sh';
        $connectSrc .= ' https://esm.sh';
    }

    $csp = implode('; ', [
        "default-src 'self'",
        "script-src $scriptSrc",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "connect-src $connectSrc",
        "worker-src 'self'",
        $allowSameOriginFraming ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
    ]);

    header("Content-Security-Policy: $csp");
}
