<?php
declare(strict_types=1);

function normalizeUsername(?string $value): string
{
    $value = trim((string) $value);
    $value = preg_replace('/[\x00-\x1F\x7F]+/u', '', $value) ?? '';

    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, 120);
    }

    return substr($value, 0, 120);
}

function getDefaultUserPreferences(): array
{
    return [
        'mode' => 'liste',
        'tabs_hidden' => false,
        'category_swipe_enabled' => true,
        'product_scanner_enabled' => true,
        'shopping_list_scanner_enabled' => true,
        'magic_button_enabled' => true,
        'last_category_id' => null,
        'install_banner_dismissed' => false,
        'theme' => 'parchment',
        'gemini_api_key' => '',
        'gemini_model' => 'gemini-2.5-flash',
    ];
}

function getAvailableGeminiModels(): array
{
    return [
        'gemini-2.5-flash' => 'Gemini 2.5 Flash',
        'gemini-3-flash-preview' => 'Gemini 3 Flash Preview',
    ];
}

function normalizeUserPreferences(array $preferences): array
{
    $defaults = getDefaultUserPreferences();
    $normalized = $defaults;

    if (isset($preferences['mode']) && in_array($preferences['mode'], ['liste', 'einkaufen'], true)) {
        $normalized['mode'] = $preferences['mode'];
    }

    if (array_key_exists('tabs_hidden', $preferences)) {
        $normalized['tabs_hidden'] = (bool) $preferences['tabs_hidden'];
    }

    if (array_key_exists('category_swipe_enabled', $preferences)) {
        $normalized['category_swipe_enabled'] = (bool) $preferences['category_swipe_enabled'];
    }

    if (array_key_exists('product_scanner_enabled', $preferences)) {
        $normalized['product_scanner_enabled'] = (bool) $preferences['product_scanner_enabled'];
    }

    if (array_key_exists('shopping_list_scanner_enabled', $preferences)) {
        $normalized['shopping_list_scanner_enabled'] = (bool) $preferences['shopping_list_scanner_enabled'];
    }

    if (array_key_exists('magic_button_enabled', $preferences)) {
        $normalized['magic_button_enabled'] = (bool) $preferences['magic_button_enabled'];
    }

    if (array_key_exists('install_banner_dismissed', $preferences)) {
        $normalized['install_banner_dismissed'] = (bool) $preferences['install_banner_dismissed'];
    }

    $lastCategoryId = filter_var($preferences['last_category_id'] ?? null, FILTER_VALIDATE_INT, [
        'options' => ['min_range' => 1],
    ]);
    $normalized['last_category_id'] = is_int($lastCategoryId) ? $lastCategoryId : null;

    $validThemes = ['parchment', 'hafenblau', 'nachtwache', 'pier'];
    if (isset($preferences['theme']) && in_array($preferences['theme'], $validThemes, true)) {
        $normalized['theme'] = $preferences['theme'];
    }

    if (isset($preferences['gemini_api_key'])) {
        $normalized['gemini_api_key'] = trim((string) $preferences['gemini_api_key']);
    }

    $validGeminiModels = array_keys(getAvailableGeminiModels());
    if (isset($preferences['gemini_model']) && in_array($preferences['gemini_model'], $validGeminiModels, true)) {
        $normalized['gemini_model'] = (string) $preferences['gemini_model'];
    }

    return $normalized;
}

function getUserPreferences(PDO $db, int $userId): array
{
    $stmt = $db->prepare('SELECT preferences_json FROM users WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $userId]);
    $row = $stmt->fetch();

    if (!is_array($row)) {
        return getDefaultUserPreferences();
    }

    $rawPreferences = $row['preferences_json'] ?? '{}';
    $decoded = json_decode(is_string($rawPreferences) ? $rawPreferences : '{}', true);

    return normalizeUserPreferences(is_array($decoded) ? $decoded : []);
}

function updateUserPreferences(PDO $db, int $userId, array $patch): array
{
    $preferences = normalizeUserPreferences([
        ...getUserPreferences($db, $userId),
        ...$patch,
    ]);

    $stmt = $db->prepare('UPDATE users SET preferences_json = :preferences_json WHERE id = :id');
    $stmt->execute([
        ':id' => $userId,
        ':preferences_json' => json_encode($preferences, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);

    return $preferences;
}

function getUserApiKey(PDO $db, int $userId): ?string
{
    $stmt = $db->prepare('SELECT api_key FROM users WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $userId]);
    $row = $stmt->fetch();
    return is_string($row['api_key'] ?? null) && $row['api_key'] !== '' ? $row['api_key'] : null;
}

function setUserApiKey(PDO $db, int $userId): string
{
    $apiKey = bin2hex(random_bytes(32));
    $stmt = $db->prepare('UPDATE users SET api_key = :api_key, api_key_created_at = CURRENT_TIMESTAMP WHERE id = :id');
    $stmt->execute([':api_key' => $apiKey, ':id' => $userId]);
    return $apiKey;
}

function deleteUserApiKey(PDO $db, int $userId): void
{
    $stmt = $db->prepare('UPDATE users SET api_key = NULL, api_key_created_at = NULL WHERE id = :id');
    $stmt->execute([':id' => $userId]);
}

function findUserByApiKey(PDO $db, string $apiKey): ?int
{
    $stmt = $db->prepare('SELECT id FROM users WHERE api_key = :api_key LIMIT 1');
    $stmt->execute([':api_key' => $apiKey]);
    $userId = $stmt->fetchColumn();

    return is_numeric($userId) ? (int) $userId : null;
}
