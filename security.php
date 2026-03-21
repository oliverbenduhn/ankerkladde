<?php
declare(strict_types=1);

function startAppSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    session_set_cookie_params([
        'httponly' => true,
        'path' => '/',
        'samesite' => 'Strict',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
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
