<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require __DIR__ . '/theme.php';

enforceCanonicalRequest();
sendHtmlPageSecurityHeaders(allowSameOriginFraming: true);
$userId = requireAuth();
$db = getDatabase();
$csrfToken = getCsrfToken();
$flash = null;
$flashType = 'ok';
$aiKeyStatus = null;
$aiKeyStatusType = 'ok';
$geminiModels = getAvailableGeminiModels();
$passwordChangeRequired = isPasswordChangeRequired();

function validateSettingsPassword(string $password): ?string
{
    if (strlen($password) < 8) {
        return 'Passwort muss mindestens 8 Zeichen lang sein.';
    }

    return null;
}

function normalizeSettingsName(string $value): string
{
    $value = trim($value);
    $value = preg_replace('/\s+/u', ' ', $value) ?? '';

    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, 120);
    }

    return substr($value, 0, 120);
}

function validateGeminiApiKey(string $apiKey, string $modelName): array
{
    if ($apiKey === '') {
        return [
            'type' => 'info',
            'message' => 'Noch kein Gemini API-Key hinterlegt.',
        ];
    }

    $url = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($modelName) . ':generateContent';
    $ch = curl_init($url);
    $payload = json_encode([
        'contents' => [[
            'parts' => [[
                'text' => 'Hi',
            ]],
        ]],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload === false ? '{}' : $payload,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'Content-Type: application/json',
            'x-goog-api-key: ' . $apiKey,
        ],
    ]);

    $response = curl_exec($ch);
    if ($response === false) {
        $error = curl_error($ch);
        curl_close($ch);

        return [
            'type' => 'warn',
            'message' => 'Key gespeichert, Validierung aktuell nicht möglich (' . $error . ').',
        ];
    }

    $httpCode = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    if ($httpCode >= 200 && $httpCode < 300) {
        return [
            'type' => 'ok',
            'message' => 'Gemini API-Key ist gültig für ' . $modelName . '.',
        ];
    }

    $decoded = json_decode($response, true);
    $apiMessage = '';
    if (is_array($decoded)) {
        $apiMessage = trim((string) ($decoded['error']['message'] ?? ''));
    }

    if ($httpCode === 400 || $httpCode === 401 || $httpCode === 403) {
        return [
            'type' => 'err',
            'message' => 'Gemini API-Key oder Modell ist ungültig.' . ($apiMessage !== '' ? ' ' . $apiMessage : ''),
        ];
    }

    return [
        'type' => 'warn',
        'message' => 'Key gespeichert, Google-Validierung antwortete mit HTTP ' . $httpCode . '.' . ($apiMessage !== '' ? ' ' . $apiMessage : ''),
    ];
}

function moveCategorySortOrder(PDO $db, int $userId, int $categoryId, string $direction): bool
{
    $category = loadUserCategory($db, $userId, $categoryId);
    if ($category === null) {
        return false;
    }

    $operator = $direction === 'up' ? '<' : '>';
    $order = $direction === 'up' ? 'DESC' : 'ASC';

    $stmt = $db->prepare(
        "SELECT id, sort_order
         FROM categories
         WHERE user_id = :user_id
           AND sort_order {$operator} :sort_order
         ORDER BY sort_order {$order}, id {$order}
         LIMIT 1"
    );
    $stmt->execute([
        ':user_id' => $userId,
        ':sort_order' => (int) $category['sort_order'],
    ]);
    $swapCategory = $stmt->fetch();

    if (!is_array($swapCategory)) {
        return false;
    }

    $db->beginTransaction();
    try {
        $updateStmt = $db->prepare(
            'UPDATE categories
             SET sort_order = :sort_order, updated_at = CURRENT_TIMESTAMP
             WHERE id = :id AND user_id = :user_id'
        );
        $updateStmt->execute([
            ':sort_order' => (int) $swapCategory['sort_order'],
            ':id' => (int) $category['id'],
            ':user_id' => $userId,
        ]);
        $updateStmt->execute([
            ':sort_order' => (int) $category['sort_order'],
            ':id' => (int) $swapCategory['id'],
            ':user_id' => $userId,
        ]);
        $db->commit();
        return true;
    } catch (Throwable $exception) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $exception;
    }
}

function notifyWebSocket(int $userId, string $action = 'settings_update'): void
{
    $wsHost = getenv('WS_HOST') ?: '127.0.0.1';
    $wsPort = getenv('WS_PORT') ?: '3000';
    $wsUrl = "http://{$wsHost}:{$wsPort}/notify";

    $payload = [
        'action' => $action,
        'user_id' => $userId,
    ];

    $ch = curl_init($wsUrl);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_TIMEOUT => 2,
        CURLOPT_CONNECTTIMEOUT => 1,
        CURLOPT_RETURNTRANSFER => true,
    ]);

    $result = curl_exec($ch);
    if ($result === false) {
        // Log WS notification failure, but don't crash settings page
        error_log('[WS] Settings notification failed: ' . curl_error($ch));
    }
    curl_close($ch);
}

function wantsJsonResponse(): bool
{
    $requestedWith = strtolower((string) ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? ''));
    if ($requestedWith === 'fetch') {
        return true;
    }

    $accept = strtolower((string) ($_SERVER['HTTP_ACCEPT'] ?? ''));
    return str_contains($accept, 'application/json');
}

function sendJsonResponse(array $payload, int $statusCode = 200): never
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $providedToken = $_POST['csrf_token'] ?? null;

    if (!hasValidCsrfToken(is_string($providedToken) ? $providedToken : null)) {
        $flash = 'Ungültiges Sicherheits-Token.';
        $flashType = 'err';
    } else {
        $moveDirection = (string) ($_POST['move_direction'] ?? '');
        if ($moveDirection === 'up') {
            $action = 'move_category_up';
        } elseif ($moveDirection === 'down') {
            $action = 'move_category_down';
        } else {
            $action = (string) ($_POST['action'] ?? 'categories');
        }

        if ($action === 'change_password') {
            $currentPassword = (string) ($_POST['current_password'] ?? '');
            $newPassword = (string) ($_POST['new_password'] ?? '');
            $newPasswordConfirm = (string) ($_POST['new_password_confirm'] ?? '');

            if (($passwordChangeRequired ? false : $currentPassword === '') || $newPassword === '' || $newPasswordConfirm === '') {
                $flash = 'Bitte alle Passwort-Felder ausfüllen.';
                $flashType = 'err';
            } elseif (($passwordError = validateSettingsPassword($newPassword)) !== null) {
                $flash = $passwordError;
                $flashType = 'err';
            } elseif ($newPassword !== $newPasswordConfirm) {
                $flash = 'Die neuen Passwörter stimmen nicht überein.';
                $flashType = 'err';
            } elseif ($passwordChangeRequired) {
                $db->prepare('UPDATE users SET password_hash = :password_hash, must_change_password = 0 WHERE id = :id')
                    ->execute([
                        ':password_hash' => password_hash($newPassword, PASSWORD_BCRYPT),
                        ':id' => $userId,
                    ]);
                $_SESSION['must_change_password'] = false;
                $passwordChangeRequired = false;
                $flash = 'Passwort geändert.';
            } else {
                $stmt = $db->prepare('SELECT password_hash FROM users WHERE id = :id LIMIT 1');
                $stmt->execute([':id' => $userId]);
                $user = $stmt->fetch();

                if (!is_array($user) || !password_verify($currentPassword, (string) $user['password_hash'])) {
                    $flash = 'Aktuelles Passwort ist nicht korrekt.';
                    $flashType = 'err';
                } else {
                    $db->prepare('UPDATE users SET password_hash = :password_hash, must_change_password = 0 WHERE id = :id')
                        ->execute([
                            ':password_hash' => password_hash($newPassword, PASSWORD_BCRYPT),
                            ':id' => $userId,
                        ]);
                    $_SESSION['must_change_password'] = false;
                    $passwordChangeRequired = false;
                    $flash = 'Passwort geändert.';
                }
            }
        } elseif ($action === 'create_category') {
            $name = normalizeSettingsName((string) ($_POST['name'] ?? ''));
            $type = trim((string) ($_POST['type'] ?? ''));
            $icon = normalizeCategoryIcon((string) ($_POST['icon'] ?? ''), $type);

            if ($name === '') {
                $flash = 'Bitte einen Kategorienamen eingeben.';
                $flashType = 'err';
            } elseif (!in_array($type, CATEGORY_TYPES, true)) {
                $flash = 'Ungültiger Kategorietyp.';
                $flashType = 'err';
            } else {
                $stmt = $db->prepare(
                    'INSERT INTO categories (user_id, name, type, icon, sort_order, is_hidden)
                     VALUES (:user_id, :name, :type, :icon, :sort_order, 0)'
                );
                $stmt->execute([
                    ':user_id' => $userId,
                    ':name' => $name,
                    ':type' => $type,
                    ':icon' => $icon,
                    ':sort_order' => nextCategorySortOrder($db, $userId),
                ]);
                $categoryId = (int) $db->lastInsertId();
                updateExtendedUserPreferences($db, $userId, ['last_category_id' => $categoryId]);
                $flash = 'Kategorie erstellt.';
                notifyWebSocket($userId);
            }
        } elseif ($action === 'save_category') {
            $categoryId = filter_var($_POST['category_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

            if (!is_int($categoryId)) {
                $flash = 'Kategorie nicht gefunden.';
                $flashType = 'err';
            } else {
                $category = loadUserCategory($db, $userId, $categoryId);
                if ($category === null) {
                    $flash = 'Kategorie nicht gefunden.';
                    $flashType = 'err';
                } else {
                    $name = normalizeSettingsName((string) ($_POST['category_name'] ?? $category['name']));
                    $icon = normalizeCategoryIcon((string) ($_POST['category_icon'] ?? $category['icon']), (string) $category['type']);
                    $isHidden = isset($_POST['category_hidden']) ? 1 : 0;

                    if ($name === '') {
                        $name = (string) $category['name'];
                    }

                    $db->prepare(
                        'UPDATE categories
                         SET name = :name, icon = :icon, is_hidden = :is_hidden, updated_at = CURRENT_TIMESTAMP
                         WHERE id = :id AND user_id = :user_id'
                    )->execute([
                        ':name' => $name,
                        ':icon' => $icon,
                        ':is_hidden' => $isHidden,
                        ':id' => $categoryId,
                        ':user_id' => $userId,
                    ]);

                    $flash = 'Kategorie gespeichert.';
                    notifyWebSocket($userId);
                }
            }
        } elseif ($action === 'move_category_up' || $action === 'move_category_down') {
            $categoryId = filter_var($_POST['category_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $direction = $action === 'move_category_up' ? 'up' : 'down';

            if (!is_int($categoryId)) {
                $flash = 'Kategorie konnte nicht verschoben werden.';
                $flashType = 'err';
            } elseif (moveCategorySortOrder($db, $userId, $categoryId, $direction)) {
                $flash = 'Reihenfolge aktualisiert.';
                notifyWebSocket($userId);
            } else {
                $flash = 'Kategorie konnte nicht verschoben werden.';
                $flashType = 'err';
            }
        } elseif ($action === 'reorder_categories') {
            $rawOrder = (string) ($_POST['order'] ?? '');
            $orderIds = json_decode($rawOrder, true);

            if (!is_array($orderIds)) {
                $flash = 'Ungültige Reihenfolge.';
                $flashType = 'err';
            } else {
                $validStmt = $db->prepare('SELECT id FROM categories WHERE user_id = :user_id');
                $validStmt->execute([':user_id' => $userId]);
                $validIds = array_column($validStmt->fetchAll(), 'id');

                $filteredIds = [];
                foreach ($orderIds as $rawId) {
                    $id = (int) $rawId;
                    if ($id > 0 && in_array($id, $validIds, true)) {
                        $filteredIds[] = $id;
                    }
                }

                $db->beginTransaction();
                try {
                    $updateStmt = $db->prepare(
                        'UPDATE categories
                         SET sort_order = :sort_order, updated_at = CURRENT_TIMESTAMP
                         WHERE id = :id AND user_id = :user_id'
                    );
                    foreach ($filteredIds as $i => $id) {
                        $updateStmt->execute([':sort_order' => $i + 1, ':id' => $id, ':user_id' => $userId]);
                    }
                    $db->commit();
                    $flash = 'Reihenfolge gespeichert.';
                    notifyWebSocket($userId);
                } catch (Throwable $e) {
                    if ($db->inTransaction()) {
                        $db->rollBack();
                    }
                    $flash = 'Reihenfolge konnte nicht gespeichert werden.';
                    $flashType = 'err';
                }
            }
        } elseif ($action === 'delete_category') {
            $deleteCategoryId = filter_var($_POST['category_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

            if (!is_int($deleteCategoryId)) {
                $flash = 'Kategorie nicht gefunden.';
                $flashType = 'err';
            } else {
                $category = loadUserCategory($db, $userId, $deleteCategoryId);
                if ($category === null) {
                    $flash = 'Kategorie nicht gefunden.';
                    $flashType = 'err';
                } else {
                    $countStmt = $db->prepare('SELECT COUNT(*) FROM items WHERE user_id = :user_id AND category_id = :category_id');
                    $countStmt->execute([':user_id' => $userId, ':category_id' => $deleteCategoryId]);

                    if ((int) $countStmt->fetchColumn() > 0) {
                        $flash = 'Kategorie kann nur gelöscht werden, wenn sie leer ist.';
                        $flashType = 'err';
                    } else {
                        $db->prepare('DELETE FROM categories WHERE id = :id AND user_id = :user_id')
                            ->execute([':id' => $deleteCategoryId, ':user_id' => $userId]);
                        $preferences = getExtendedUserPreferences($db, $userId);
                        if ((int) ($preferences['last_category_id'] ?? 0) === $deleteCategoryId) {
                            $fallback = loadUserCategories($db, $userId, false)[0]['id'] ?? null;
                            updateExtendedUserPreferences($db, $userId, ['last_category_id' => $fallback]);
                        }
                        $flash = 'Kategorie gelöscht.';
                        notifyWebSocket($userId);
                    }
                }
            }
        } elseif ($action === 'save_theme') {
            $themeMode = (string) ($_POST['theme_mode'] ?? 'auto');
            $lightTheme = (string) ($_POST['light_theme'] ?? '');
            $darkTheme = (string) ($_POST['dark_theme'] ?? '');

            if (!in_array($themeMode, ['auto', 'light', 'dark'], true)) {
                $themeMode = 'auto';
            }

            $themes = getAvailableThemes();
            $validLightThemes = array_keys($themes['light'] ?? []);
            $validDarkThemes = array_keys($themes['dark'] ?? []);

            if (!in_array($lightTheme, $validLightThemes, true)) {
                $lightTheme = 'hafenblau';
            }
            if (!in_array($darkTheme, $validDarkThemes, true)) {
                $darkTheme = 'nachtwache';
            }

            updateExtendedUserPreferences($db, $userId, [
                'theme_mode' => $themeMode,
                'light_theme' => $lightTheme,
                'dark_theme' => $darkTheme,
            ]);

            // Re-read preferences so that the UI can reflect the new mode right away
            $preferences = getExtendedUserPreferences($db, $userId);
            $flash = 'Themes gespeichert.';
            notifyWebSocket($userId);
        } elseif ($action === 'save_app_preferences') {
            $preferences = updateExtendedUserPreferences($db, $userId, [
                'category_swipe_enabled' => isset($_POST['category_swipe_enabled']),
            ]);
            $flash = 'Anzeige-Einstellungen gespeichert.';
            notifyWebSocket($userId);
        } elseif ($action === 'save_feature_preferences') {
            $preferences = updateExtendedUserPreferences($db, $userId, [
                'product_scanner_enabled' => isset($_POST['product_scanner_enabled']),
                'shopping_list_scanner_enabled' => isset($_POST['shopping_list_scanner_enabled']),
                'magic_button_enabled' => isset($_POST['magic_button_enabled']),
                'category_swipe_enabled' => isset($_POST['category_swipe_enabled']),
            ]);
            $flash = 'Funktions-Einstellungen gespeichert.';
            notifyWebSocket($userId);
        } elseif ($action === 'regenerate_api_key') {
            setUserApiKey($db, $userId);
            $flash = 'API-Key neu erzeugt.';
        } elseif ($action === 'save_ai_preferences') {
            $geminiApiKey = trim((string) ($_POST['gemini_api_key'] ?? ''));
            $geminiModel = (string) ($_POST['gemini_model'] ?? 'gemini-2.5-flash');
            if (!array_key_exists($geminiModel, $geminiModels)) {
                $geminiModel = 'gemini-2.5-flash';
            }
            updateExtendedUserPreferences($db, $userId, [
                'gemini_api_key' => $geminiApiKey,
                'gemini_model' => $geminiModel,
            ]);
            $validation = validateGeminiApiKey($geminiApiKey, $geminiModel);
            $aiKeyStatus = $validation['message'];
            $aiKeyStatusType = $validation['type'];
            $flash = $geminiApiKey === '' ? 'KI-Einstellungen gespeichert.' : 'KI-Einstellungen gespeichert. ' . $validation['message'];
            if ($aiKeyStatusType === 'err') {
                $flashType = 'err';
            }
            notifyWebSocket($userId);
        }
    }

    if (wantsJsonResponse()) {
        $jsonPreferences = getExtendedUserPreferences($db, $userId);
        sendJsonResponse([
            'ok' => $flashType !== 'err',
            'flash' => $flash,
            'flash_type' => $flashType,
            'preferences' => [
                'theme_mode' => $jsonPreferences['theme_mode'] ?? 'auto',
                'light_theme' => $jsonPreferences['light_theme'] ?? 'hafenblau',
                'dark_theme' => $jsonPreferences['dark_theme'] ?? 'nachtwache',
                'product_scanner_enabled' => !array_key_exists('product_scanner_enabled', $jsonPreferences) || !empty($jsonPreferences['product_scanner_enabled']),
                'shopping_list_scanner_enabled' => !array_key_exists('shopping_list_scanner_enabled', $jsonPreferences) || !empty($jsonPreferences['shopping_list_scanner_enabled']),
                'magic_button_enabled' => !array_key_exists('magic_button_enabled', $jsonPreferences) || !empty($jsonPreferences['magic_button_enabled']),
                'category_swipe_enabled' => !array_key_exists('category_swipe_enabled', $jsonPreferences) || !empty($jsonPreferences['category_swipe_enabled']),
            ],
        ], $flashType === 'err' ? 400 : 200);
    }
}

$preferences = getExtendedUserPreferences($db, $userId);
$apiKey = getUserApiKey($db, $userId);
if ($apiKey === null) {
    $apiKey = setUserApiKey($db, $userId);
}
$stmt = $db->prepare('SELECT username FROM users WHERE id = :id LIMIT 1');
$stmt->execute([':id' => $userId]);
$currentUser = $stmt->fetch();
$categories = loadUserCategories($db, $userId);
$iconOptions = getCategoryIconOptions();
$currentTab = $_GET['tab'] ?? ($passwordChangeRequired ? 'password' : 'app');
$isEmbedded = isset($_GET['embed']) && $_GET['embed'] === '1';
$settingsAction = appPath('settings.php' . ($isEmbedded ? '?embed=1&tab=' . rawurlencode((string) $currentTab) : ''));
$assetVersion = require __DIR__ . '/version.php';
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
<?php
$effectiveTheme = resolveEffectiveTheme($preferences);
$themeColor = getThemeColor($effectiveTheme);
$brandMarkSrc = appPath('icon.php?size=96&theme=' . rawurlencode($effectiveTheme) . '&v=' . rawurlencode($assetVersion));
?>
    <meta name="theme-color" content="<?= htmlspecialchars($themeColor, ENT_QUOTES, 'UTF-8') ?>">
    <?= renderThemeBootScript($preferences) ?>
    <title>Einstellungen — Ankerkladde</title>
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('theme-css.php'), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('style.css?v=' . rawurlencode($assetVersion)), ENT_QUOTES, 'UTF-8') ?>">
</head>
<body class="settings-page<?= $isEmbedded ? ' settings-page-embedded' : '' ?>" data-theme="<?= htmlspecialchars($effectiveTheme, ENT_QUOTES, 'UTF-8') ?>">
<div class="settings-card<?= $isEmbedded ? ' settings-card-embedded' : '' ?>">
    <?php if (!$isEmbedded): ?>
    <div class="settings-header">
        <div class="settings-title-group">
            <img src="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>" alt="" class="brand-mark brand-mark-settings" aria-hidden="true">
            <h1>Einstellungen</h1>
        </div>
        <a href="<?= htmlspecialchars(appPath('index.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-back" aria-label="Zurück zur App">←</a>
    </div>
    <?php endif; ?>



    <?php if ($flash !== null): ?>
        <div class="settings-flash settings-flash-<?= htmlspecialchars($flashType, ENT_QUOTES, 'UTF-8') ?>" role="alert">
            <?= htmlspecialchars($flash, ENT_QUOTES, 'UTF-8') ?>
        </div>
    <?php endif; ?>

    <?php if ($passwordChangeRequired): ?>
        <div class="settings-flash settings-flash-err" role="alert">
            Beim ersten Login musst du dein Passwort ändern, bevor du die App weiter nutzen kannst.
        </div>
    <?php endif; ?>

    <details class="settings-section settings-accordion" data-settings-panel="appearance" open>
        <summary>Erscheinungsbild</summary>
        <form method="post" action="<?= htmlspecialchars($settingsAction, ENT_QUOTES, 'UTF-8') ?>" class="settings-form" data-auto-submit="change" data-theme-form="1">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="save_theme">
            <div class="settings-block">
                <p class="settings-copy">Änderungen werden sofort übernommen.</p>
                <div class="theme-mode-list">
                    <label>
                        <?php
                        $autoDotLight = htmlspecialchars(getThemeColor($preferences['light_theme'] ?? 'hafenblau'), ENT_QUOTES, 'UTF-8');
                        $autoDotDark  = htmlspecialchars(getThemeColor($preferences['dark_theme']  ?? 'nachtwache'), ENT_QUOTES, 'UTF-8');
                        ?>
                        <span class="theme-mode-dot theme-mode-dot-auto" style="background:conic-gradient(<?= $autoDotLight ?> 0deg 180deg,<?= $autoDotDark ?> 180deg 360deg)"></span>
                        Auto
                        <input type="radio" name="theme_mode" value="auto" <?= ($preferences['theme_mode'] ?? 'auto') === 'auto' ? 'checked' : '' ?>>
                    </label>
                    <label>
                        <span class="theme-mode-dot theme-mode-dot-light"></span>
                        Hell
                        <input type="radio" name="theme_mode" value="light" <?= ($preferences['theme_mode'] ?? 'auto') === 'light' ? 'checked' : '' ?>>
                    </label>
                    <label>
                        <span class="theme-mode-dot theme-mode-dot-dark"></span>
                        Dunkel
                        <input type="radio" name="theme_mode" value="dark" <?= ($preferences['theme_mode'] ?? 'auto') === 'dark' ? 'checked' : '' ?>>
                    </label>
                </div>
                <div class="theme-grid" style="margin-top: 16px;">
                    <?php
                    $themes = getAvailableThemes();
                    $validLightThemes = array_keys($themes['light'] ?? []);
                    $validDarkThemes = array_keys($themes['dark'] ?? []);
                    ?>
                    <div>
                        <h3 class="theme-group-title">Light Theme</h3>
                        <p class="theme-group-hint">Empfohlen: <strong>Hafenblau</strong> · Warm: <strong>Pergament</strong></p>
                        <div class="theme-cards">
                            <?php foreach ($validLightThemes as $key): ?>
                            <?php $theme = $themes['light'][$key] ?? null; if (!$theme) continue; ?>
                            <?php
                            $cardBg      = htmlspecialchars($theme['tokens']['--bg']      ?? $theme['color'] ?? '#fff', ENT_QUOTES, 'UTF-8');
                            $cardSurface = htmlspecialchars($theme['tokens']['--surface'] ?? $theme['color'] ?? '#fff', ENT_QUOTES, 'UTF-8');
                            $cardAccent  = htmlspecialchars($theme['tokens']['--accent']  ?? '#000', ENT_QUOTES, 'UTF-8');
                            ?>
                            <label class="theme-card-label">
                                <input type="radio" name="light_theme" value="<?= htmlspecialchars($key, ENT_QUOTES, 'UTF-8') ?>" <?= $preferences['light_theme'] === $key ? 'checked' : '' ?>>
                                <span class="theme-card">
                                    <span class="theme-card-preview">
                                        <span style="flex:5;background:<?= $cardBg ?>"></span>
                                        <span style="flex:3;background:<?= $cardSurface ?>"></span>
                                        <span style="flex:2;background:<?= $cardAccent ?>"></span>
                                    </span>
                                    <span class="theme-card-name"><?= htmlspecialchars($theme['name'] ?? $key, ENT_QUOTES, 'UTF-8') ?></span>
                                </span>
                            </label>
                            <?php endforeach; ?>
                        </div>
                    </div>
                    <div>
                        <h3 class="theme-group-title">Dark Theme</h3>
                        <p class="theme-group-hint">Empfohlen: <strong>Nachtwache</strong> · Editorial: <strong>Pier</strong></p>
                        <div class="theme-cards">
                            <?php foreach ($validDarkThemes as $key): ?>
                            <?php $theme = $themes['dark'][$key] ?? null; if (!$theme) continue; ?>
                            <?php
                            $cardBg      = htmlspecialchars($theme['tokens']['--bg']      ?? $theme['color'] ?? '#1a1a1a', ENT_QUOTES, 'UTF-8');
                            $cardSurface = htmlspecialchars($theme['tokens']['--surface'] ?? $theme['color'] ?? '#1a1a1a', ENT_QUOTES, 'UTF-8');
                            $cardAccent  = htmlspecialchars($theme['tokens']['--accent']  ?? '#fff', ENT_QUOTES, 'UTF-8');
                            ?>
                            <label class="theme-card-label">
                                <input type="radio" name="dark_theme" value="<?= htmlspecialchars($key, ENT_QUOTES, 'UTF-8') ?>" <?= $preferences['dark_theme'] === $key ? 'checked' : '' ?>>
                                <span class="theme-card">
                                    <span class="theme-card-preview">
                                        <span style="flex:5;background:<?= $cardBg ?>"></span>
                                        <span style="flex:3;background:<?= $cardSurface ?>"></span>
                                        <span style="flex:2;background:<?= $cardAccent ?>"></span>
                                    </span>
                                    <span class="theme-card-name"><?= htmlspecialchars($theme['name'] ?? $key, ENT_QUOTES, 'UTF-8') ?></span>
                                </span>
                            </label>
                            <?php endforeach; ?>
                        </div>
                    </div>
                </div>
            </div>
        </form>
    </details>

    <details class="settings-section settings-section-secondary settings-accordion" data-settings-panel="features">
        <summary>Funktionen</summary>
        <form method="post" action="<?= htmlspecialchars($settingsAction, ENT_QUOTES, 'UTF-8') ?>" class="settings-form" data-auto-submit="change">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="save_feature_preferences">
            <div class="settings-block">
                <p class="settings-copy">Ausgeschaltete Funktionen verschwinden in der App komplett aus der Oberfläche.</p>
                <p class="settings-copy">Änderungen werden sofort gespeichert.</p>
                <div class="settings-options">
                    <label class="settings-option">
                        <input
                            type="checkbox"
                            name="product_scanner_enabled"
                            value="1"
                            <?= !array_key_exists('product_scanner_enabled', $preferences) || !empty($preferences['product_scanner_enabled']) ? 'checked' : '' ?>
                        >
                        <span>Produktscanner anzeigen</span>
                    </label>
                    <label class="settings-option">
                        <input
                            type="checkbox"
                            name="shopping_list_scanner_enabled"
                            value="1"
                            <?= !array_key_exists('shopping_list_scanner_enabled', $preferences) || !empty($preferences['shopping_list_scanner_enabled']) ? 'checked' : '' ?>
                        >
                        <span>Scanfunktion für die Einkaufsliste anzeigen</span>
                    </label>
                    <label class="settings-option">
                        <input
                            type="checkbox"
                            name="magic_button_enabled"
                            value="1"
                            <?= !array_key_exists('magic_button_enabled', $preferences) || !empty($preferences['magic_button_enabled']) ? 'checked' : '' ?>
                        >
                        <span>Magic Button anzeigen</span>
                    </label>
                    <label class="settings-option">
                        <input
                            type="checkbox"
                            name="category_swipe_enabled"
                            value="1"
                            <?= !array_key_exists('category_swipe_enabled', $preferences) || !empty($preferences['category_swipe_enabled']) ? 'checked' : '' ?>
                        >
                        <span>Wischgeste für Kategorien aktivieren</span>
                    </label>
                </div>
            </div>
        </form>
    </details>

    <details class="settings-section settings-accordion" data-settings-panel="categories" open>
        <summary>Kategorien</summary>
        <div class="settings-block">
            <p class="settings-copy">Neue Kategorien werden direkt angelegt. Bestehende Kategorien speicherst du pro Zeile.</p>
            <div class="settings-options">
                <?php foreach ($categories as $category): ?>
                    <?php
                    $categoryIcon = (string) $category['icon'];
                    $categoryIconOptions = $iconOptions;
                    if ($categoryIcon !== '' && !in_array($categoryIcon, $categoryIconOptions, true)) {
                        array_unshift($categoryIconOptions, $categoryIcon);
                    }
                    ?>
                    <form method="post" action="<?= htmlspecialchars($settingsAction, ENT_QUOTES, 'UTF-8') ?>" class="settings-option settings-category-row" data-category-id="<?= (int) $category['id'] ?>">
                        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
                        <input type="hidden" name="action" value="save_category">
                        <input type="hidden" name="category_id" value="<?= (int) $category['id'] ?>">
                        <details class="settings-category-details">
                            <summary class="settings-category-summary">
                                <span class="settings-drag-handle" aria-hidden="true" title="Zum Verschieben ziehen">
                                    <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
                                        <circle cx="5" cy="4" r="2"/><circle cx="11" cy="4" r="2"/>
                                        <circle cx="5" cy="10" r="2"/><circle cx="11" cy="10" r="2"/>
                                        <circle cx="5" cy="16" r="2"/><circle cx="11" cy="16" r="2"/>
                                    </svg>
                                </span>
                                <span class="settings-category-preview-icon" aria-hidden="true"><?= htmlspecialchars($categoryIcon, ENT_QUOTES, 'UTF-8') ?></span>
                                <span class="settings-category-preview-name"><?= htmlspecialchars((string) $category['name'], ENT_QUOTES, 'UTF-8') ?></span>
                                <span class="settings-type-badge"><?= htmlspecialchars(categoryTypeLabel((string) $category['type']), ENT_QUOTES, 'UTF-8') ?></span>
                                <svg class="settings-summary-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <polyline points="4 6 8 10 12 6"/>
                                </svg>
                            </summary>
                            <div class="settings-category-body">
                                <div class="settings-row-main">
                                    <label class="settings-field settings-field-name">
                                        <span>Name</span>
                                        <input
                                            type="text"
                                            name="category_name"
                                            value="<?= htmlspecialchars((string) $category['name'], ENT_QUOTES, 'UTF-8') ?>"
                                            maxlength="120"
                                            required
                                        >
                                    </label>
                                    <label class="settings-field settings-field-icon">
                                        <span>Symbol</span>
                                        <select name="category_icon">
                                            <?php foreach ($categoryIconOptions as $iconOption): ?>
                                                <option
                                                    value="<?= htmlspecialchars($iconOption, ENT_QUOTES, 'UTF-8') ?>"
                                                    <?= $iconOption === $categoryIcon ? 'selected' : '' ?>
                                                ><?= htmlspecialchars($iconOption, ENT_QUOTES, 'UTF-8') ?></option>
                                            <?php endforeach; ?>
                                        </select>
                                    </label>
                                </div>
                                <div class="settings-row-bottom">
                                    <label class="settings-toggle">
                                        <input
                                            type="checkbox"
                                            name="category_hidden"
                                            value="1"
                                            <?= (int) $category['is_hidden'] === 1 ? 'checked' : '' ?>
                                        >
                                        <span>Ausblenden</span>
                                    </label>
                                    <div class="settings-row-actions">
                                        <button type="submit" class="settings-save settings-row-save">Speichern</button>
                                        <button
                                            type="submit"
                                            name="action"
                                            value="delete_category"
                                            class="settings-delete-button"
                                            formnovalidate
                                            onclick="return confirm('Kategorie wirklich löschen?')"
                                        >Löschen</button>
                                    </div>
                                </div>
                            </div>
                        </details>
                    </form>
                <?php endforeach; ?>
            </div>
        </div>
    </details>

    <details class="settings-section settings-accordion" data-settings-panel="new-category">
        <summary>Neue Kategorie</summary>
        <form method="post" action="<?= htmlspecialchars($settingsAction, ENT_QUOTES, 'UTF-8') ?>" class="settings-form">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="create_category">
            <div class="settings-block">
                <p class="settings-copy">Name frei wählen, Strukturtyp bleibt fest im Produkt definiert.</p>
                <div class="settings-password-fields">
                    <label class="settings-field">
                        <span>Symbol</span>
                        <select name="icon">
                            <option value="">Automatisch nach Typ</option>
                            <?php foreach ($iconOptions as $iconOption): ?>
                                <option value="<?= htmlspecialchars($iconOption, ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars($iconOption, ENT_QUOTES, 'UTF-8') ?></option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                    <label class="settings-field">
                        <span>Name</span>
                        <input type="text" name="name" maxlength="120" required>
                    </label>
                    <label class="settings-field">
                        <span>Typ</span>
                        <select name="type" required>
                            <?php foreach (CATEGORY_TYPES as $type): ?>
                                <option value="<?= htmlspecialchars($type, ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars(categoryTypeLabel($type), ENT_QUOTES, 'UTF-8') ?></option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                </div>
            </div>

            <div class="settings-actions">
                <button type="submit" class="settings-save">Kategorie anlegen</button>
            </div>
        </form>
    </details>

    <?php if (!empty($preferences['magic_button_enabled'])): ?>
    <details class="settings-section settings-accordion" data-settings-panel="ai" open>
        <summary>KI-Assistent (Magic Bar)</summary>
        <form method="post" action="<?= htmlspecialchars($settingsAction, ENT_QUOTES, 'UTF-8') ?>" class="settings-form">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="save_ai_preferences">
            <div class="settings-block">
                <p class="settings-copy">Hinterlege hier deinen <strong>Google Gemini API-Key</strong>, um die Magic Bar zu nutzen. Kostenlose Keys gibt es im <a href="https://aistudio.google.com/" target="_blank" rel="noopener">Google AI Studio</a>.</p>
                <div class="settings-password-fields">
                    <label class="settings-field">
                        <span>Gemini API-Key</span>
                        <input type="password" id="gemini_api_key_input" name="gemini_api_key" value="<?= htmlspecialchars((string) ($preferences['gemini_api_key'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" placeholder="AIzaSy...">
                    </label>
                    <label class="settings-field">
                        <span>Gemini-Modell</span>
                        <select id="gemini_model_select" name="gemini_model">
                            <?php foreach ($geminiModels as $modelValue => $modelLabel): ?>
                                <option value="<?= htmlspecialchars($modelValue, ENT_QUOTES, 'UTF-8') ?>" <?= ($preferences['gemini_model'] ?? 'gemini-2.5-flash') === $modelValue ? 'selected' : '' ?>>
                                    <?= htmlspecialchars($modelLabel, ENT_QUOTES, 'UTF-8') ?>
                                </option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                    <button type="button" id="test-api-key" class="settings-link">Verbindung testen</button>
                </div>
                <div id="api-test-status" class="api-test-status" style="margin-top: 8px; font-size: 0.85rem; display: none;"></div>
                <?php if ($aiKeyStatus !== null): ?>
                    <p class="settings-inline-status settings-inline-status-<?= htmlspecialchars($aiKeyStatusType, ENT_QUOTES, 'UTF-8') ?>">
                        <?= htmlspecialchars($aiKeyStatus, ENT_QUOTES, 'UTF-8') ?>
                    </p>
                <?php endif; ?>
            </div>
            <div class="settings-actions">
                <button type="submit" class="settings-save">KI-Einstellungen speichern</button>
            </div>
        </form>
    </details>
    <?php endif; ?>

    <details class="settings-section settings-accordion" data-settings-panel="extension">
        <summary>Browser-Extension</summary>
        <div class="settings-block">
            <p class="settings-copy">Diesen API-Key in die Extension kopieren. Er verbindet die Erweiterung direkt mit deinem Account.</p>
            <div class="settings-password-fields">
                <label class="settings-field">
                    <span>API-Key</span>
                    <input type="text" id="api-key-value" value="<?= htmlspecialchars($apiKey, ENT_QUOTES, 'UTF-8') ?>" readonly>
                </label>
            </div>
            <div class="settings-actions" style="gap: 0.75rem; flex-wrap: wrap;">
                <button type="button" class="settings-save" id="copy-api-key">Kopieren</button>
                <a href="<?= htmlspecialchars(appPath('extension-download.php') . '?firefox', ENT_QUOTES, 'UTF-8') ?>" class="settings-link settings-link-firefox">Firefox-Erweiterung laden</a>
                <a href="<?= htmlspecialchars(appPath('extension-download.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-link settings-link-chrome">Chrome/Edge-Erweiterung laden</a>
                <form method="post" action="<?= htmlspecialchars($settingsAction, ENT_QUOTES, 'UTF-8') ?>" class="settings-form" style="margin:0;">
                    <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
                    <input type="hidden" name="action" value="regenerate_api_key">
                    <button type="submit" class="settings-link" formnovalidate>Neu erzeugen</button>
                </form>
            </div>
            <p class="settings-copy">Wenn sich die Erweiterung spaeter aendert, hier einfach erneut herunterladen.</p>
        </div>
    </details>

    <details class="settings-section settings-section-secondary settings-accordion" data-settings-panel="password"<?= $passwordChangeRequired ? ' open' : '' ?>>
        <summary>Passwort ändern</summary>
        <form method="post" action="<?= htmlspecialchars($settingsAction, ENT_QUOTES, 'UTF-8') ?>" class="settings-form">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="change_password">
            <div class="settings-block">
                <p class="settings-copy">Dein neues Passwort muss mindestens 8 Zeichen lang sein.</p>
                <div class="settings-password-fields">
                    <?php if (!$passwordChangeRequired): ?>
                        <label class="settings-field">
                            <span>Aktuelles Passwort</span>
                            <input type="password" name="current_password" autocomplete="current-password" required>
                        </label>
                    <?php endif; ?>
                    <label class="settings-field">
                        <span>Neues Passwort</span>
                        <input type="password" name="new_password" autocomplete="new-password" required>
                    </label>
                    <label class="settings-field">
                        <span>Neues Passwort wiederholen</span>
                        <input type="password" name="new_password_confirm" autocomplete="new-password" required>
                    </label>
                </div>
            </div>

            <div class="settings-actions">
                <button type="submit" class="settings-save">Passwort ändern</button>
            </div>
        </form>
    </details>

    <details class="settings-section settings-section-secondary settings-accordion" data-settings-panel="system">
        <summary>System & Abmelden</summary>
        <div class="settings-block">
            <p class="settings-copy">Angemeldet als <strong><?= htmlspecialchars((string) ($currentUser['username'] ?? 'unbekannt'), ENT_QUOTES, 'UTF-8') ?></strong>.</p>
            <p class="settings-copy">Version: <?= htmlspecialchars($assetVersion, ENT_QUOTES, 'UTF-8') ?></p>
            <a href="<?= htmlspecialchars(appPath('logout.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-link">Abmelden</a>
        </div>
    </details>
</div>
<script>
(() => {
    const allThemeColors = <?= json_encode((static function (): array {
        $colors = [];
        foreach (getAvailableThemes() as $themeGroup) {
            foreach (array_keys($themeGroup ?? []) as $themeKey) {
                $colors[$themeKey] = getThemeColor((string) $themeKey);
            }
        }

        return $colors;
    })(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>;
    const themePreferences = <?= json_encode([
        'theme_mode' => $preferences['theme_mode'] ?? 'auto',
        'light_theme' => $preferences['light_theme'] ?? 'hafenblau',
        'dark_theme' => $preferences['dark_theme'] ?? 'nachtwache',
        'theme_colors' => (static function (): array {
            $colors = [];
            foreach (getAvailableThemes() as $themeGroup) {
                foreach (array_keys($themeGroup ?? []) as $themeKey) {
                    $colors[$themeKey] = getThemeColor((string) $themeKey);
                }
            }

            return $colors;
        })(),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>;
    const scrollKey = 'einkauf-settings-scroll-y:<?= htmlspecialchars($currentTab, ENT_QUOTES, 'UTF-8') ?>';
    const panelsKey = 'einkauf-settings-open-panels:<?= htmlspecialchars($currentTab, ENT_QUOTES, 'UTF-8') ?>';
    const copyButton = document.getElementById('copy-api-key');
    const apiKeyInput = document.getElementById('api-key-value');
    const testApiKeyBtn = document.getElementById('test-api-key');
    const geminiKeyInput = document.getElementById('gemini_api_key_input');
    const geminiModelSelect = document.getElementById('gemini_model_select');
    const apiTestStatus = document.getElementById('api-test-status');
    const settingsPanels = Array.from(document.querySelectorAll('details[data-settings-panel]'));

    const saved = window.sessionStorage.getItem(scrollKey);
    const themeMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function readOpenPanels() {
        try {
            const raw = window.localStorage.getItem(panelsKey);
            if (raw === null) {
                return null;
            }

            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : null;
        } catch (error) {
            return null;
        }
    }

    function saveOpenPanels() {
        try {
            const openPanels = settingsPanels
                .filter(panel => panel.open)
                .map(panel => panel.dataset.settingsPanel)
                .filter(Boolean);
            window.localStorage.setItem(panelsKey, JSON.stringify(openPanels));
        } catch (error) {}
    }

    function getEffectiveTheme() {
        const mode = themePreferences.theme_mode === 'dark'
            ? 'dark'
            : (themePreferences.theme_mode === 'light' ? 'light' : 'auto');
        const prefersDark = Boolean(themeMediaQuery?.matches);

        if (mode === 'dark') {
            return themePreferences.dark_theme || 'nachtwache';
        }

        if (mode === 'light') {
            return themePreferences.light_theme || 'hafenblau';
        }

        return prefersDark
            ? (themePreferences.dark_theme || 'nachtwache')
            : (themePreferences.light_theme || 'hafenblau');
    }

    function updateAutoModeDot() {
        const dot = document.querySelector('.theme-mode-dot-auto');
        if (!dot) return;
        const lightColor = allThemeColors[themePreferences.light_theme] || '#cfe0ec';
        const darkColor  = allThemeColors[themePreferences.dark_theme]  || '#162338';
        dot.style.background = `conic-gradient(${lightColor} 0deg 180deg, ${darkColor} 180deg 360deg)`;
    }

    function applySettingsTheme() {
        const theme = getEffectiveTheme();
        document.documentElement.dataset.theme = theme;
        if (document.body) {
            document.body.dataset.theme = theme;
        }

        const themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (themeColorMeta && themePreferences.theme_colors?.[theme]) {
            themeColorMeta.setAttribute('content', themePreferences.theme_colors[theme]);
        }

        document.querySelectorAll('img.brand-mark').forEach(image => {
            try {
                const url = new URL(image.src, window.location.href);
                url.searchParams.set('theme', theme);
                image.src = url.toString();
            } catch (error) {}
        });

        updateAutoModeDot();
    }

    function renderFlash(message, type = 'ok') {
        if (!message) return;

        const currentFlash = document.querySelector('.settings-flash');
        if (currentFlash) {
            currentFlash.remove();
        }

        const flash = document.createElement('div');
        flash.className = `settings-flash settings-flash-${type === 'err' ? 'err' : 'ok'}`;
        flash.setAttribute('role', 'alert');
        flash.textContent = message;
        document.body.appendChild(flash);
    }

    function postPreferencesUpdate(preferences) {
        if (!preferences || typeof preferences !== 'object' || !window.parent || window.parent === window) {
            return;
        }

        window.parent.postMessage({
            type: 'ankerkladde-settings-preferences-update',
            preferences,
        }, window.location.origin);
    }

    applySettingsTheme();

    const savedPanels = readOpenPanels();
    if (savedPanels !== null) {
        const openPanels = new Set(savedPanels);
        settingsPanels.forEach(panel => {
            panel.open = openPanels.has(panel.dataset.settingsPanel || '');
        });
    }

    settingsPanels.forEach(panel => {
        panel.addEventListener('toggle', () => {
            saveOpenPanels();
        });
    });

    if (saved !== null) {
        window.sessionStorage.removeItem(scrollKey);
        window.requestAnimationFrame(() => {
            window.scrollTo({ top: Number(saved) || 0, behavior: 'auto' });
        });
    }

    const openCategoryKey = 'einkauf-settings-open-category:' + scrollKey;

    document.querySelectorAll('form.settings-category-row').forEach(form => {
        form.addEventListener('submit', () => {
            window.sessionStorage.setItem(scrollKey, String(window.scrollY || window.pageYOffset || 0));
            const details = form.querySelector('.settings-category-details');
            if (details instanceof HTMLDetailsElement && details.open) {
                window.sessionStorage.setItem(openCategoryKey, form.dataset.categoryId || '');
            }
        });
    });

    document.querySelectorAll('form.settings-form').forEach(form => {
        form.addEventListener('submit', () => {
            window.sessionStorage.setItem(scrollKey, String(window.scrollY || window.pageYOffset || 0));
        });
    });

    const savedCategoryId = window.sessionStorage.getItem(openCategoryKey);
    if (savedCategoryId) {
        window.sessionStorage.removeItem(openCategoryKey);
        const targetForm = document.querySelector('form[data-category-id="' + savedCategoryId + '"]');
        const targetDetails = targetForm && targetForm.querySelector('.settings-category-details');
        if (targetDetails instanceof HTMLDetailsElement) {
            targetDetails.open = true;
        }
    }

    const autoSaveControllers = new WeakMap();

    document.querySelectorAll('form[data-auto-submit=\"change\"]').forEach(form => {
        form.addEventListener('change', event => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
                return;
            }

            const actionUrl = form.getAttribute('action') || window.location.href;

            if (form.dataset.themeForm === '1') {
                const formData = new FormData(form);
                themePreferences.theme_mode = String(formData.get('theme_mode') || themePreferences.theme_mode || 'auto');
                themePreferences.light_theme = String(formData.get('light_theme') || themePreferences.light_theme || 'hafenblau');
                themePreferences.dark_theme = String(formData.get('dark_theme') || themePreferences.dark_theme || 'nachtwache');
                applySettingsTheme();
            }

            const previousController = autoSaveControllers.get(form);
            previousController?.abort();

            const controller = new AbortController();
            autoSaveControllers.set(form, controller);

            fetch(actionUrl, {
                method: 'POST',
                body: new FormData(form),
                headers: {
                    'Accept': 'application/json',
                    'X-Requested-With': 'fetch',
                },
                signal: controller.signal,
            })
                .then(async response => {
                    const payload = await response.json().catch(() => null);
                    if (!response.ok || !payload || payload.ok === false) {
                        const message = payload?.flash || 'Einstellung konnte nicht gespeichert werden.';
                        throw new Error(message);
                    }

                    if (payload.preferences && typeof payload.preferences === 'object') {
                        themePreferences.theme_mode = payload.preferences.theme_mode || themePreferences.theme_mode;
                        themePreferences.light_theme = payload.preferences.light_theme || themePreferences.light_theme;
                        themePreferences.dark_theme = payload.preferences.dark_theme || themePreferences.dark_theme;
                        themePreferences.theme_colors = allThemeColors;
                        applySettingsTheme();
                        postPreferencesUpdate(payload.preferences);
                    }

                    renderFlash(payload.flash || 'Gespeichert.', payload.flash_type || 'ok');
                })
                .catch(error => {
                    if (error.name === 'AbortError') {
                        return;
                    }
                    renderFlash(error instanceof Error ? error.message : 'Einstellung konnte nicht gespeichert werden.', 'err');
                })
                .finally(() => {
                    if (autoSaveControllers.get(form) === controller) {
                        autoSaveControllers.delete(form);
                    }
                });
        });
    });

    if (copyButton && apiKeyInput) {
        copyButton.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(apiKeyInput.value);
                copyButton.textContent = 'Kopiert';
                window.setTimeout(() => {
                    copyButton.textContent = 'Kopieren';
                }, 1500);
            } catch (error) {
                copyButton.textContent = 'Nicht kopierbar';
            }
        });
    }

    if (testApiKeyBtn && geminiKeyInput && geminiModelSelect) {
        testApiKeyBtn.addEventListener('click', async () => {
            const key = geminiKeyInput.value.trim();
            const model = geminiModelSelect.value;
            if (!key) {
                apiTestStatus.textContent = 'Bitte zuerst einen Key eingeben.';
                apiTestStatus.style.color = 'var(--error)';
                apiTestStatus.style.display = 'block';
                return;
            }

            testApiKeyBtn.disabled = true;
            apiTestStatus.textContent = 'Teste Verbindung...';
            apiTestStatus.style.color = '';
            apiTestStatus.style.display = 'block';

            try {
                const response = await fetch('ai.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ input: 'Hi', test_only: true, gemini_api_key: key, gemini_model: model })
                });

                const result = await response.json();
                if (response.ok) {
                    apiTestStatus.textContent = '✅ Verbindung erfolgreich mit ' + model + '!';
                    apiTestStatus.style.color = 'green';
                } else {
                    apiTestStatus.textContent = '❌ Fehler: ' + (result.error || 'Ungültiger Key');
                    apiTestStatus.style.color = 'var(--error)';
                }
            } catch (error) {
                apiTestStatus.textContent = '❌ Netzwerkfehler beim Testen.';
                apiTestStatus.style.color = 'var(--error)';
            } finally {
                testApiKeyBtn.disabled = false;
            }
        });
    }

    window.addEventListener('message', event => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type !== 'ankerkladde-theme-update') return;

        const nextPreferences = event.data?.preferences;
        if (!nextPreferences || typeof nextPreferences !== 'object') return;

        themePreferences.theme_mode = nextPreferences.theme_mode || themePreferences.theme_mode;
        themePreferences.light_theme = nextPreferences.light_theme || themePreferences.light_theme;
        themePreferences.dark_theme = nextPreferences.dark_theme || themePreferences.dark_theme;
        applySettingsTheme();
    });

    if (themeMediaQuery) {
        const onThemeChange = () => {
            if (themePreferences.theme_mode === 'auto') {
                applySettingsTheme();
            }
        };

        if (typeof themeMediaQuery.addEventListener === 'function') {
            themeMediaQuery.addEventListener('change', onThemeChange);
        } else if (typeof themeMediaQuery.addListener === 'function') {
            themeMediaQuery.addListener(onThemeChange);
        }
    }

    (function initCategoryDragReorder() {
        const categoryList = document.querySelector('.settings-options');
        if (!categoryList) return;

        let dragEl = null;
        let pointerStartY = 0;
        let dragMoved = false;

        categoryList.addEventListener('pointerdown', (e) => {
            const handle = e.target.closest('.settings-drag-handle');
            if (!handle) return;
            const row = handle.closest('.settings-category-row');
            if (!row) return;

            e.preventDefault();
            dragEl = row;
            dragMoved = false;
            pointerStartY = e.clientY;
            dragEl.classList.add('settings-category-dragging');
            handle.setPointerCapture(e.pointerId);
        });

        categoryList.addEventListener('pointermove', (e) => {
            if (!dragEl) return;

            const dy = Math.abs(e.clientY - pointerStartY);
            if (dy > 4) dragMoved = true;
            if (!dragMoved) return;

            const rows = Array.from(categoryList.querySelectorAll('.settings-category-row'));
            const y = e.clientY;

            for (let i = 0; i < rows.length; i++) {
                const item = rows[i];
                if (item === dragEl) continue;
                const rect = item.getBoundingClientRect();
                if (y < rect.top + rect.height / 2) {
                    categoryList.insertBefore(dragEl, item);
                    return;
                }
            }
            const last = rows[rows.length - 1];
            if (last && last !== dragEl) {
                categoryList.appendChild(dragEl);
            }
        });

        categoryList.addEventListener('pointerup', async () => {
            if (!dragEl) return;
            dragEl.classList.remove('settings-category-dragging');
            const wasDragged = dragMoved;
            dragEl = null;
            dragMoved = false;

            if (!wasDragged) return;

            const order = Array.from(categoryList.querySelectorAll('.settings-category-row'))
                .map(row => parseInt(row.dataset.categoryId || '', 10))
                .filter(id => id > 0);

            if (!order.length) return;

            const csrfToken = (categoryList.querySelector('input[name="csrf_token"]') || document.querySelector('input[name="csrf_token"]'))?.value || '';
            try {
                await fetch(window.location.href, {
                    method: 'POST',
                    headers: { 'Accept': 'application/json', 'X-Requested-With': 'fetch' },
                    body: new URLSearchParams({ action: 'reorder_categories', csrf_token: csrfToken, order: JSON.stringify(order) }),
                });
            } catch (_) {}
        });

        categoryList.addEventListener('pointercancel', () => {
            if (dragEl) {
                dragEl.classList.remove('settings-category-dragging');
                dragEl = null;
                dragMoved = false;
            }
        });
    })();
})();
</script>
</body>
</html>
