<?php
declare(strict_types=1);

/**
 * Supported language codes. Add entries here when adding a new language.
 */
function getAvailableLanguages(): array
{
    return ['de', 'en'];
}

/**
 * Resolve the active language: user DB field → ENV default → 'de'.
 * Requires an active session (for user lookup) or returns the instance default.
 */
function getCurrentLanguage(): string
{
    // 1. User preference from DB (if logged in)
    $userId = getCurrentUserId();
    if ($userId !== null) {
        static $userLangCache = [];
        if (!isset($userLangCache[$userId])) {
            $db = getDatabase();
            $stmt = $db->prepare('SELECT language FROM users WHERE id = :id');
            $stmt->execute([':id' => $userId]);
            $userLangCache[$userId] = $stmt->fetchColumn() ?: null;
        }
        if ($userLangCache[$userId] !== null && in_array($userLangCache[$userId], getAvailableLanguages(), true)) {
            return $userLangCache[$userId];
        }
    }

    // 2. Instance default from ENV
    if (defined('ANKERKLADDE_DEFAULT_LANGUAGE') && in_array(ANKERKLADDE_DEFAULT_LANGUAGE, getAvailableLanguages(), true)) {
        return ANKERKLADDE_DEFAULT_LANGUAGE;
    }

    // 3. Hardcoded fallback
    return 'de';
}

/**
 * Get the language for an API-key-authenticated user (no session).
 */
function getLanguageForUser(int $userId): string
{
    $db = getDatabase();
    $stmt = $db->prepare('SELECT language FROM users WHERE id = :id');
    $stmt->execute([':id' => $userId]);
    $lang = $stmt->fetchColumn() ?: null;

    if ($lang !== null && in_array($lang, getAvailableLanguages(), true)) {
        return $lang;
    }

    if (defined('ANKERKLADDE_DEFAULT_LANGUAGE') && in_array(ANKERKLADDE_DEFAULT_LANGUAGE, getAvailableLanguages(), true)) {
        return ANKERKLADDE_DEFAULT_LANGUAGE;
    }

    return 'de';
}

/**
 * Load all translation strings for a given language with German fallback.
 */
function loadStrings(string $lang): array
{
    $fallbackFile = __DIR__ . '/lang/de.json';
    $fallback = json_decode(file_get_contents($fallbackFile), true) ?: [];

    if ($lang === 'de') {
        return $fallback;
    }

    $langFile = __DIR__ . '/lang/' . $lang . '.json';
    if (!is_file($langFile)) {
        return $fallback;
    }

    $strings = json_decode(file_get_contents($langFile), true) ?: [];
    return $strings + $fallback;
}

/**
 * Translate a key, with optional placeholder replacement.
 * Placeholders use {name} syntax.
 */
function t(string $key, array $params = []): string
{
    static $strings = null;
    if ($strings === null) {
        $strings = loadStrings(getCurrentLanguage());
    }

    $text = $strings[$key] ?? $key;
    foreach ($params as $k => $v) {
        $text = str_replace('{' . $k . '}', (string) $v, $text);
    }
    return $text;
}

/**
 * Return all loaded strings for the current language (for window.__i18n).
 */
function getAllStrings(): array
{
    static $strings = null;
    if ($strings === null) {
        $strings = loadStrings(getCurrentLanguage());
    }
    return $strings;
}
