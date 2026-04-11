<?php
declare(strict_types=1);

function getThemePreferenceDefaults(): array
{
    return [
        'theme_mode' => 'auto',
        'light_theme' => 'hafenblau',
        'dark_theme' => 'nachtwache',
    ];
}

function normalizeExtendedUserPreferences(array $preferences): array
{
    $base = normalizeUserPreferences($preferences);
    $defaults = getThemePreferenceDefaults();

    $normalized = [
        'mode' => $base['mode'] ?? 'liste',
        'tabs_hidden' => (bool) ($base['tabs_hidden'] ?? false),
        'category_swipe_enabled' => (bool) ($base['category_swipe_enabled'] ?? true),
        'last_category_id' => $base['last_category_id'] ?? null,
        'install_banner_dismissed' => (bool) ($base['install_banner_dismissed'] ?? false),
        'theme_mode' => $defaults['theme_mode'],
        'light_theme' => $defaults['light_theme'],
        'dark_theme' => $defaults['dark_theme'],
    ];

    if (isset($preferences['theme_mode']) && in_array($preferences['theme_mode'], ['light', 'dark', 'auto'], true)) {
        $normalized['theme_mode'] = $preferences['theme_mode'];
    }

    if (isset($preferences['light_theme']) && in_array($preferences['light_theme'], ['parchment', 'hafenblau'], true)) {
        $normalized['light_theme'] = $preferences['light_theme'];
    }

    if (isset($preferences['dark_theme']) && in_array($preferences['dark_theme'], ['nachtwache', 'pier'], true)) {
        $normalized['dark_theme'] = $preferences['dark_theme'];
    }

    return $normalized;
}

function getExtendedUserPreferences(PDO $db, int $userId): array
{
    $stmt = $db->prepare('SELECT preferences_json FROM users WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $userId]);
    $row = $stmt->fetch();

    if (!is_array($row)) {
        return normalizeExtendedUserPreferences([]);
    }

    $rawPreferences = $row['preferences_json'] ?? '{}';
    $decoded = json_decode(is_string($rawPreferences) ? $rawPreferences : '{}', true);

    return normalizeExtendedUserPreferences(is_array($decoded) ? $decoded : []);
}

function updateExtendedUserPreferences(PDO $db, int $userId, array $patch): array
{
    $stmt = $db->prepare('SELECT preferences_json FROM users WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $userId]);
    $row = $stmt->fetch();

    $rawPreferences = [];
    if (is_array($row)) {
        $decoded = json_decode((string) ($row['preferences_json'] ?? '{}'), true);
        if (is_array($decoded)) {
            $rawPreferences = $decoded;
        }
    }

    $preferences = normalizeExtendedUserPreferences([
        ...$rawPreferences,
        ...$patch,
    ]);

    $stmt = $db->prepare('UPDATE users SET preferences_json = :preferences_json WHERE id = :id');
    $stmt->execute([
        ':id' => $userId,
        ':preferences_json' => json_encode($preferences, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);

    return $preferences;
}

function getThemeColor(string $theme): string
{
    return match ($theme) {
        'hafenblau' => '#cfe0ec',
        'nachtwache' => '#162338',
        'pier' => '#0f1419',
        default => '#f5f0eb',
    };
}

function resolveEffectiveTheme(array $preferences, ?bool $prefersDark = null): string
{
    $normalized = normalizeExtendedUserPreferences($preferences);
    $themeMode = $normalized['theme_mode'] ?? 'auto';

    if ($themeMode === 'light') {
        return $normalized['light_theme'];
    }

    if ($themeMode === 'dark') {
        return $normalized['dark_theme'];
    }

    if ($prefersDark === true) {
        return $normalized['dark_theme'];
    }

    return $normalized['light_theme'];
}

function renderThemeBootScript(array $preferences): string
{
    $defaults = getThemePreferenceDefaults();
    $payload = [
        'theme_mode' => $preferences['theme_mode'] ?? $defaults['theme_mode'],
        'light_theme' => $preferences['light_theme'] ?? $defaults['light_theme'],
        'dark_theme' => $preferences['dark_theme'] ?? $defaults['dark_theme'],
        'theme_colors' => [
            'parchment' => getThemeColor('parchment'),
            'hafenblau' => getThemeColor('hafenblau'),
            'nachtwache' => getThemeColor('nachtwache'),
            'pier' => getThemeColor('pier'),
        ],
    ];

    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);

    return "<script>(function(){var p=" . $json . ";var m=p.theme_mode===\"dark\"?\"dark\":(p.theme_mode===\"light\"?\"light\":\"auto\");var d=m===\"dark\"||(m===\"auto\"&&window.matchMedia&&window.matchMedia(\"(prefers-color-scheme: dark)\").matches);var t=d?(p.dark_theme||\"nachtwache\"):(p.light_theme||\"hafenblau\");document.documentElement.dataset.theme=t;var meta=document.querySelector(\'meta[name=\"theme-color\"]\');if(meta&&p.theme_colors&&p.theme_colors[t])meta.setAttribute(\"content\",p.theme_colors[t]);window.__ANKERKLADDE_THEME__={mode:m,effectiveTheme:t};})();</script>";
}
