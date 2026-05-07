<?php
declare(strict_types=1);

require_once __DIR__ . '/../i18n.php';

function validateSettingsPassword(string $password): ?string
{
    if (strlen($password) < 8) {
        return t('settings.flash.password_too_short');
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

function categoryIconAssetPath(string $icon): string
{
    $icon = normalizeCategoryIcon($icon);

    return appPath('category-icon.php?icon=' . rawurlencode($icon));
}

function validateGeminiApiKey(string $apiKey, string $modelName): array
{
    if ($apiKey === '') {
        return [
            'type' => 'info',
            'message' => t('settings.flash.gemini_no_key'),
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

        return [
            'type' => 'warn',
            'message' => t('settings.flash.gemini_validation_unavailable', ['error' => $error]),
        ];
    }

    $httpCode = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);

    if ($httpCode >= 200 && $httpCode < 300) {
        return [
            'type' => 'ok',
            'message' => t('settings.flash.gemini_valid', ['model' => $modelName]),
        ];
    }

    $decoded = json_decode($response, true);
    if (!is_array($decoded) && $httpCode !== 200) {
        return [
            'type' => 'err',
            'message' => t('settings.flash.gemini_unexpected_response', ['code' => $httpCode]),
        ];
    }
    
    $apiMessage = '';
    if (is_array($decoded)) {
        $apiMessage = trim((string) ($decoded['error']['message'] ?? ''));
    }

    if ($httpCode === 400 || $httpCode === 401 || $httpCode === 403 || $httpCode === 404) {
        return [
            'type' => 'err',
            'message' => t('settings.flash.gemini_invalid_key') . ($apiMessage !== '' ? ' ' . $apiMessage : ''),
        ];
    }

    return [
        'type' => 'warn',
        'message' => t('settings.flash.gemini_http_response', ['code' => $httpCode]) . ($apiMessage !== '' ? ' ' . $apiMessage : ''),
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
        error_log('[WS] Settings notification failed: ' . curl_error($ch));
    }
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

class SettingsController
{
    private PDO $db;
    private int $userId;

    public function __construct(PDO $db, int $userId)
    {
        $this->db = $db;
        $this->userId = $userId;
    }

    public function handlePostRequest(array $postData, bool &$passwordChangeRequired, array $geminiModels): array
    {
        $flash = null;
        $flashType = 'ok';
        $aiKeyStatus = null;
        $aiKeyStatusType = 'ok';

        $providedToken = $postData['csrf_token'] ?? null;

        if (!hasValidCsrfToken(is_string($providedToken) ? $providedToken : null)) {
            $flash = t('error.invalid_csrf');
            $flashType = 'err';
            return ['flash' => $flash, 'flashType' => $flashType, 'aiKeyStatus' => $aiKeyStatus, 'aiKeyStatusType' => $aiKeyStatusType];
        }

        $moveDirection = (string) ($postData['move_direction'] ?? '');
        if ($moveDirection === 'up') {
            $action = 'move_category_up';
        } elseif ($moveDirection === 'down') {
            $action = 'move_category_down';
        } else {
            $action = (string) ($postData['action'] ?? 'categories');
        }

        switch ($action) {
            case 'change_password':
                $currentPassword = (string) ($postData['current_password'] ?? '');
                $newPassword = (string) ($postData['new_password'] ?? '');
                $newPasswordConfirm = (string) ($postData['new_password_confirm'] ?? '');

                if (($passwordChangeRequired ? false : $currentPassword === '') || $newPassword === '' || $newPasswordConfirm === '') {
                    $flash = t('settings.flash.password_fields_required');
                    $flashType = 'err';
                } elseif (($passwordError = validateSettingsPassword($newPassword)) !== null) {
                    $flash = $passwordError;
                    $flashType = 'err';
                } elseif ($newPassword !== $newPasswordConfirm) {
                    $flash = t('settings.flash.password_mismatch');
                    $flashType = 'err';
                } elseif ($passwordChangeRequired) {
                    $this->db->prepare('UPDATE users SET password_hash = :password_hash, must_change_password = 0 WHERE id = :id')
                        ->execute([
                            ':password_hash' => password_hash($newPassword, PASSWORD_BCRYPT),
                            ':id' => $this->userId,
                        ]);
                    $_SESSION['must_change_password'] = false;
                    $passwordChangeRequired = false;
                    $flash = t('settings.flash.password_changed');
                } else {
                    $stmt = $this->db->prepare('SELECT password_hash FROM users WHERE id = :id LIMIT 1');
                    $stmt->execute([':id' => $this->userId]);
                    $user = $stmt->fetch();

                    if (!is_array($user) || !password_verify($currentPassword, (string) $user['password_hash'])) {
                        $flash = t('settings.flash.password_wrong');
                        $flashType = 'err';
                    } else {
                        $this->db->prepare('UPDATE users SET password_hash = :password_hash, must_change_password = 0 WHERE id = :id')
                            ->execute([
                                ':password_hash' => password_hash($newPassword, PASSWORD_BCRYPT),
                                ':id' => $this->userId,
                            ]);
                        $_SESSION['must_change_password'] = false;
                        $passwordChangeRequired = false;
                        $flash = t('settings.flash.password_changed');
                    }
                }
                break;

            case 'create_category':
                $name = normalizeSettingsName((string) ($postData['name'] ?? ''));
                $type = trim((string) ($postData['type'] ?? ''));
                $icon = normalizeCategoryIcon((string) ($postData['icon'] ?? ''), $type);

                if ($name === '') {
                    $flash = t('error.category_name_required');
                    $flashType = 'err';
                } elseif (!in_array($type, CATEGORY_TYPES, true)) {
                    $flash = t('error.invalid_category_type');
                    $flashType = 'err';
                } else {
                    $stmt = $this->db->prepare(
                        'INSERT INTO categories (user_id, name, type, icon, sort_order, is_hidden)
                         VALUES (:user_id, :name, :type, :icon, :sort_order, 0)'
                    );
                    $stmt->execute([
                        ':user_id' => $this->userId,
                        ':name' => $name,
                        ':type' => $type,
                        ':icon' => $icon,
                        ':sort_order' => nextCategorySortOrder($this->db, $this->userId),
                    ]);
                    $categoryId = (int) $this->db->lastInsertId();
                    updateExtendedUserPreferences($this->db, $this->userId, ['last_category_id' => $categoryId]);
                    $flash = t('settings.flash.category_created');
                    notifyWebSocket($this->userId);
                }
                break;

            case 'save_category':
                $categoryId = filter_var($postData['category_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

                if (!is_int($categoryId)) {
                    $flash = t('error.category_not_found');
                    $flashType = 'err';
                } else {
                    $category = loadUserCategory($this->db, $this->userId, $categoryId);
                    if ($category === null) {
                        $flash = t('error.category_not_found');
                        $flashType = 'err';
                    } else {
                        $name = normalizeSettingsName((string) ($postData['category_name'] ?? $category['name']));
                        $icon = normalizeCategoryIcon((string) ($postData['category_icon'] ?? $category['icon']), (string) $category['type']);
                        $isHidden = isset($postData['category_hidden']) ? 1 : 0;

                        if ($name === '') {
                            $name = (string) $category['name'];
                        }

                        $this->db->prepare(
                            'UPDATE categories
                             SET name = :name, icon = :icon, is_hidden = :is_hidden, updated_at = CURRENT_TIMESTAMP
                             WHERE id = :id AND user_id = :user_id'
                        )->execute([
                            ':name' => $name,
                            ':icon' => $icon,
                            ':is_hidden' => $isHidden,
                            ':id' => $categoryId,
                            ':user_id' => $this->userId,
                        ]);

                        $flash = t('settings.flash.category_saved');
                        notifyWebSocket($this->userId);
                    }
                }
                break;

            case 'move_category_up':
            case 'move_category_down':
                $categoryId = filter_var($postData['category_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
                $direction = $action === 'move_category_up' ? 'up' : 'down';

                if (!is_int($categoryId)) {
                    $flash = t('settings.flash.category_move_failed');
                    $flashType = 'err';
                } elseif (moveCategorySortOrder($this->db, $this->userId, $categoryId, $direction)) {
                    $flash = t('settings.flash.order_updated');
                    notifyWebSocket($this->userId);
                } else {
                    $flash = t('settings.flash.category_move_failed');
                    $flashType = 'err';
                }
                break;

            case 'reorder_categories':
                $rawOrder = (string) ($postData['order'] ?? '');
                $orderIds = json_decode($rawOrder, true);

                if (!is_array($orderIds)) {
                    $flash = t('error.invalid_order');
                    $flashType = 'err';
                } else {
                    $validStmt = $this->db->prepare('SELECT id FROM categories WHERE user_id = :user_id');
                    $validStmt->execute([':user_id' => $this->userId]);
                    $validIds = array_map('intval', array_column($validStmt->fetchAll(), 'id'));

                    $filteredIds = [];
                    foreach ($orderIds as $rawId) {
                        $id = (int) $rawId;
                        if ($id > 0 && in_array($id, $validIds, true)) {
                            $filteredIds[] = $id;
                        }
                    }

                    $this->db->beginTransaction();
                    try {
                        $updateStmt = $this->db->prepare(
                            'UPDATE categories
                             SET sort_order = :sort_order, updated_at = CURRENT_TIMESTAMP
                             WHERE id = :id AND user_id = :user_id'
                        );
                        foreach ($filteredIds as $i => $id) {
                            $updateStmt->execute([':sort_order' => $i + 1, ':id' => $id, ':user_id' => $this->userId]);
                        }
                        $this->db->commit();
                        $flash = t('settings.flash.order_saved');
                        notifyWebSocket($this->userId);
                    } catch (Throwable $e) {
                        if ($this->db->inTransaction()) {
                            $this->db->rollBack();
                        }
                        $flash = t('settings.flash.order_save_failed');
                        $flashType = 'err';
                    }
                }
                break;

            case 'delete_category':
                $deleteCategoryId = filter_var($postData['category_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

                if (!is_int($deleteCategoryId)) {
                    $flash = t('error.category_not_found');
                    $flashType = 'err';
                } else {
                    $category = loadUserCategory($this->db, $this->userId, $deleteCategoryId);
                    if ($category === null) {
                        $flash = t('error.category_not_found');
                        $flashType = 'err';
                    } else {
                        $countStmt = $this->db->prepare('SELECT COUNT(*) FROM items WHERE user_id = :user_id AND category_id = :category_id');
                        $countStmt->execute([':user_id' => $this->userId, ':category_id' => $deleteCategoryId]);

                        if ((int) $countStmt->fetchColumn() > 0) {
                            $flash = t('error.category_not_empty');
                            $flashType = 'err';
                        } else {
                            $this->db->prepare('DELETE FROM categories WHERE id = :id AND user_id = :user_id')
                                ->execute([':id' => $deleteCategoryId, ':user_id' => $this->userId]);
                            $preferences = getExtendedUserPreferences($this->db, $this->userId);
                            if ((int) ($preferences['last_category_id'] ?? 0) === $deleteCategoryId) {
                                $fallback = loadUserCategories($this->db, $this->userId, false)[0]['id'] ?? null;
                                updateExtendedUserPreferences($this->db, $this->userId, ['last_category_id' => $fallback]);
                            }
                            $flash = t('settings.flash.category_deleted');
                            notifyWebSocket($this->userId);
                        }
                    }
                }
                break;

            case 'save_language':
                $newLang = $postData['language'] ?? '';
                if (!in_array($newLang, getAvailableLanguages(), true)) {
                    return ['flash' => t('error.invalid_params'), 'flashType' => 'err', 'aiKeyStatus' => null, 'aiKeyStatusType' => 'ok'];
                }
                $oldLang = getCurrentLanguage();
                $stmt = $this->db->prepare('UPDATE users SET language = :lang WHERE id = :id');
                $stmt->execute([':lang' => $newLang, ':id' => $this->userId]);

                if ($oldLang !== $newLang) {
                    $_SESSION['i18n_rename_from'] = $oldLang;
                    $_SESSION['i18n_rename_to'] = $newLang;
                }

                return ['flash' => t('settings.language_saved'), 'flashType' => 'ok', 'aiKeyStatus' => null, 'aiKeyStatusType' => 'ok'];

            case 'save_theme':
                $flash = t('settings.flash.theme_saved');
                break;

            case 'save_app_preferences':
                $preferences = updateExtendedUserPreferences($this->db, $this->userId, [
                    'category_swipe_enabled' => isset($postData['category_swipe_enabled']),
                ]);
                $flash = t('settings.flash.app_prefs_saved');
                notifyWebSocket($this->userId);
                break;

            case 'save_feature_preferences':
                $preferences = updateExtendedUserPreferences($this->db, $this->userId, [
                    'product_scanner_enabled' => isset($postData['product_scanner_enabled']),
                    'shopping_list_scanner_enabled' => isset($postData['shopping_list_scanner_enabled']),
                    'magic_button_enabled' => isset($postData['magic_button_enabled']),
                ]);
                $flash = t('settings.flash.feature_prefs_saved');
                notifyWebSocket($this->userId);
                break;

            case 'regenerate_api_key':
                setUserApiKey($this->db, $this->userId);
                $flash = t('settings.flash.api_key_regenerated');
                break;

            case 'save_ai_preferences':
                $geminiApiKey = trim((string) ($postData['gemini_api_key'] ?? ''));
                $geminiModel = (string) ($postData['gemini_model'] ?? 'gemini-2.5-flash');
                if (!array_key_exists($geminiModel, $geminiModels)) {
                    $geminiModel = 'gemini-2.5-flash';
                }
                updateExtendedUserPreferences($this->db, $this->userId, [
                    'gemini_api_key' => $geminiApiKey,
                    'gemini_model' => $geminiModel,
                ]);
                $validation = validateGeminiApiKey($geminiApiKey, $geminiModel);
                $aiKeyStatus = $validation['message'];
                $aiKeyStatusType = $validation['type'];
                $flash = $geminiApiKey === '' ? t('settings.flash.ai_prefs_saved') : t('settings.flash.ai_prefs_saved') . ' ' . $validation['message'];
                if ($aiKeyStatusType === 'err') {
                    $flashType = 'err';
                }
                notifyWebSocket($this->userId);
                break;
        }

        return [
            'flash' => $flash,
            'flashType' => $flashType,
            'aiKeyStatus' => $aiKeyStatus,
            'aiKeyStatusType' => $aiKeyStatusType,
        ];
    }
}
