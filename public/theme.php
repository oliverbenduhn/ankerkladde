<?php
declare(strict_types=1);

require_once __DIR__ . '/theme-definitions.php';

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

    $themes = getAvailableThemes();
    $lightThemes = array_keys($themes['light'] ?? []);
    $darkThemes = array_keys($themes['dark'] ?? []);

    if (isset($preferences['light_theme']) && in_array($preferences['light_theme'], $lightThemes, true)) {
        $normalized['light_theme'] = $preferences['light_theme'];
    }

    if (isset($preferences['dark_theme']) && in_array($preferences['dark_theme'], $darkThemes, true)) {
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
    $themes = getAvailableThemes();

    $themeColors = [];
    foreach (['light', 'dark'] as $mode) {
        foreach ($themes[$mode] ?? [] as $key => $theme) {
            $themeColors[$key] = $theme['color'] ?? '#f5f0eb';
        }
    }

    $payload = [
        'theme_mode' => $preferences['theme_mode'] ?? $defaults['theme_mode'],
        'light_theme' => $preferences['light_theme'] ?? $defaults['light_theme'],
        'dark_theme' => $preferences['dark_theme'] ?? $defaults['dark_theme'],
        'theme_colors' => $themeColors,
    ];

    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);

    return <<<HTML
<script>(function(){var p={$json};var mq=window.matchMedia?window.matchMedia("(prefers-color-scheme: dark)"):null;function getTheme(){var m=p.theme_mode==="dark"?"dark":(p.theme_mode==="light"?"light":"auto");var d=m==="dark"||(m==="auto"&&mq&&mq.matches);return{mode:m,effectiveTheme:d?(p.dark_theme||"nachtwache"):(p.light_theme||"hafenblau")};}function applyTheme(){var s=getTheme();document.documentElement.dataset.theme=s.effectiveTheme;if(document.body){document.body.dataset.theme=s.effectiveTheme;}var meta=document.querySelector('meta[name="theme-color"]');if(meta&&p.theme_colors&&p.theme_colors[s.effectiveTheme])meta.setAttribute("content",p.theme_colors[s.effectiveTheme]);document.querySelectorAll(".brand-mark").forEach(function(img){if(!(img instanceof HTMLImageElement))return;var src=img.getAttribute("src")||"";if(src.indexOf("icon.php")===-1)return;try{var url=new URL(src,window.location.href);url.searchParams.set("theme",s.effectiveTheme);img.src=url.toString();}catch(e){}});window.__ANKERKLADDE_THEME__=s;}applyTheme();if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",applyTheme,{once:true});}if(mq){if(typeof mq.addEventListener==="function"){mq.addEventListener("change",applyTheme);}else if(typeof mq.addListener==="function"){mq.addListener(applyTheme);}}})();</script>
HTML;
}

function renderThemeTokensCSS(): string
{
    $themes = getAvailableThemes();
    $css = '';

    foreach (['light', 'dark'] as $mode) {
        foreach ($themes[$mode] ?? [] as $key => $theme) {
            $tokens = $theme['tokens'] ?? [];
            if (empty($tokens)) {
                continue;
            }

            $css .= "[data-theme=\"{$key}\"] {\n";
            foreach ($tokens as $prop => $value) {
                $css .= "    {$prop}: {$value};\n";
            }
            $css .= "}\n\n";
        }
    }

    return $css;
}
