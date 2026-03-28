<?php
declare(strict_types=1);

const EINKAUF_CANONICAL_HOST = 'einkauf.benduhn.de';

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

    return filter_var(
        $remoteAddress,
        FILTER_VALIDATE_IP,
        FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
    ) === false;
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

function enforceCanonicalRequest(): void
{
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

    session_set_cookie_params([
        'httponly' => true,
        'path' => '/',
        'samesite' => 'Strict',
        'secure' => isRequestHttps(),
    ]);

    session_start();
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
