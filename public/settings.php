<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require __DIR__ . '/theme.php';
require dirname(__DIR__) . '/src/SettingsController.php';
require dirname(__DIR__) . '/i18n.php';

enforceCanonicalRequest();
sendHtmlPageSecurityHeaders(allowSameOriginFraming: true);
$userId = requireAuth();
$db = getDatabase();
$csrfToken = getCsrfToken();
$flash = null;
$flashType = 'ok';

if (isset($_SESSION['settings_flash'])) {
    $flash = $_SESSION['settings_flash'];
    $flashType = $_SESSION['settings_flash_type'] ?? 'ok';
    unset($_SESSION['settings_flash'], $_SESSION['settings_flash_type']);
}

$aiKeyStatus = null;
$aiKeyStatusType = 'ok';
$geminiModels = getAvailableGeminiModels();
$passwordChangeRequired = isPasswordChangeRequired();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $controller = new SettingsController($db, $userId);
    $result = $controller->handlePostRequest($_POST, $passwordChangeRequired, $geminiModels);
    
    $flash = $result['flash'];
    $flashType = $result['flashType'];
    $aiKeyStatus = $result['aiKeyStatus'];
    $aiKeyStatusType = $result['aiKeyStatusType'];

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
    } else {
        $_SESSION['settings_flash'] = $flash;
        $_SESSION['settings_flash_type'] = $flashType;

        $redirectTab = $_GET['tab'] ?? ($passwordChangeRequired ? 'password' : 'app');
        $redirectEmbedded = isset($_GET['embed']) && $_GET['embed'] === '1';
        $redirectUrl = appPath('settings.php' . ($redirectEmbedded ? '?embed=1&tab=' . rawurlencode((string) $redirectTab) : ''));
        header('Location: ' . $redirectUrl);
        exit;
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

// Extract Service Worker version
$swVersion = '';
$swContent = file_get_contents(__DIR__ . '/sw.js');
if ($swContent && preg_match("/const\s+VERSION\s*=\s*['\"]([^'\"]+)['\"]/", $swContent, $matches)) {
    $swVersion = $matches[1];
}
?>
<!DOCTYPE html>
<html lang="<?= htmlspecialchars(getCurrentLanguage(), ENT_QUOTES, 'UTF-8') ?>">
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
    <title><?= t('settings.page_title') ?></title>
    <link rel="icon" type="image/png" href="<?= htmlspecialchars(appPath('icon.php?size=96&v=' . rawurlencode($assetVersion)), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="apple-touch-icon" href="<?= htmlspecialchars(appPath('icon.php?size=180&v=' . rawurlencode($assetVersion)), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('theme-css.php'), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('style.css?v=' . rawurlencode($assetVersion)), ENT_QUOTES, 'UTF-8') ?>">
</head>
<body class="settings-page<?= $isEmbedded ? ' settings-page-embedded' : '' ?>" data-theme="<?= htmlspecialchars($effectiveTheme, ENT_QUOTES, 'UTF-8') ?>">
<div class="settings-card<?= $isEmbedded ? ' settings-card-embedded' : '' ?>">
    <?php if (!$isEmbedded): ?>
    <div class="settings-header">
        <div class="settings-title-group">
            <img src="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>" alt="" class="brand-mark brand-mark-settings" aria-hidden="true">
            <h1><?= t('ui.settings') ?></h1>
        </div>
        <a href="<?= htmlspecialchars(appPath('index.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-back" aria-label="<?= t('settings.back_to_app') ?>">←</a>
    </div>
    <?php endif; ?>



    <?php if ($flash !== null): ?>
        <div class="settings-flash settings-flash-<?= htmlspecialchars($flashType, ENT_QUOTES, 'UTF-8') ?>" data-settings-flash="transient" role="alert">
            <?= htmlspecialchars($flash, ENT_QUOTES, 'UTF-8') ?>
        </div>
    <?php endif; ?>

    <?php if ($passwordChangeRequired): ?>
        <div class="settings-flash settings-flash-err" role="alert">
            <?= t('settings.password_change_required') ?>
        </div>
    <?php endif; ?>

    <?php
    $renameFrom = $_SESSION['i18n_rename_from'] ?? null;
    $renameTo = $_SESSION['i18n_rename_to'] ?? null;
    unset($_SESSION['i18n_rename_from'], $_SESSION['i18n_rename_to']);

    if ($renameFrom !== null && $renameTo !== null):
        $oldStrings = loadStrings($renameFrom);
        $newStrings = loadStrings($renameTo);
        $renameCategories = loadUserCategories($db, $userId);
        $renameSuggestions = [];

        $defaultKeys = array_filter(array_keys($oldStrings), fn($k) => str_starts_with($k, 'category.default.'));
        foreach ($renameCategories as $cat) {
            foreach ($defaultKeys as $key) {
                if ($cat['name'] === $oldStrings[$key] && isset($newStrings[$key]) && $newStrings[$key] !== $oldStrings[$key]) {
                    $renameSuggestions[] = [
                        'id' => $cat['id'],
                        'old_name' => $cat['name'],
                        'new_name' => $newStrings[$key],
                    ];
                    break;
                }
            }
        }

        if (!empty($renameSuggestions)):
    ?>
    <div class="rename-dialog card" style="margin: 1rem 0; padding: 1rem;">
        <h3><?= t('settings.rename_categories_title') ?></h3>
        <form method="post" action="<?= htmlspecialchars(appPath('settings.php' . ($isEmbedded ? '?embed=1&tab=app' : '')), ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="rename_categories">
            <?php foreach ($renameSuggestions as $suggestion): ?>
            <label style="display: flex; align-items: center; gap: 0.5rem; margin: 0.5rem 0;">
                <input type="checkbox" name="rename[<?= (int) $suggestion['id'] ?>]" value="<?= htmlspecialchars($suggestion['new_name'], ENT_QUOTES, 'UTF-8') ?>" checked>
                <span><?= htmlspecialchars($suggestion['old_name'], ENT_QUOTES, 'UTF-8') ?></span>
                <span>→</span>
                <span><strong><?= htmlspecialchars($suggestion['new_name'], ENT_QUOTES, 'UTF-8') ?></strong></span>
            </label>
            <?php endforeach; ?>
            <button type="submit" class="btn" style="margin-top: 0.5rem;"><?= t('settings.rename_categories_submit') ?></button>
        </form>
    </div>
    <?php
        endif;
    endif;
    ?>

    <details class="settings-section settings-accordion" data-settings-panel="language" open>
        <summary><?= t('settings.language') ?></summary>
        <div class="settings-block">
            <form method="post" action="<?= htmlspecialchars(appPath('settings.php' . ($isEmbedded ? '?embed=1&tab=app' : '')), ENT_QUOTES, 'UTF-8') ?>">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
                <input type="hidden" name="action" value="save_language">
                <label class="settings-field">
                    <select name="language" class="settings-select" onchange="this.form.submit()">
                        <?php foreach (getAvailableLanguages() as $langCode): ?>
                            <option value="<?= htmlspecialchars($langCode, ENT_QUOTES, 'UTF-8') ?>" <?= $langCode === getCurrentLanguage() ? 'selected' : '' ?>>
                                <?= t('language.' . $langCode) ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </label>
            </form>
        </div>
    </details>

    <details class="settings-section settings-accordion" data-settings-panel="appearance" open>
        <summary><?= t('settings.section.appearance') ?></summary>
        <form method="post" action="<?= htmlspecialchars($settingsAction, ENT_QUOTES, 'UTF-8') ?>" class="settings-form" data-auto-submit="change" data-theme-form="1">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="save_theme">
            <div class="settings-block">
                <p class="settings-copy"><?= t('settings.appearance_hint') ?></p>
                <div class="theme-mode-list">
                    <label>
                        <?php
                        $autoDotLight = htmlspecialchars(getThemeColor($preferences['light_theme'] ?? 'hafenblau'), ENT_QUOTES, 'UTF-8');
                        $autoDotDark  = htmlspecialchars(getThemeColor($preferences['dark_theme']  ?? 'nachtwache'), ENT_QUOTES, 'UTF-8');
                        ?>
                        <span class="theme-mode-dot theme-mode-dot-auto" style="background:conic-gradient(<?= $autoDotLight ?> 0deg 180deg,<?= $autoDotDark ?> 180deg 360deg)"></span>
                        <?= t('settings.theme.auto') ?>
                        <input type="radio" name="theme_mode" value="auto" <?= ($preferences['theme_mode'] ?? 'auto') === 'auto' ? 'checked' : '' ?>>
                    </label>
                    <label>
                        <span class="theme-mode-dot theme-mode-dot-light"></span>
                        <?= t('settings.theme.light') ?>
                        <input type="radio" name="theme_mode" value="light" <?= ($preferences['theme_mode'] ?? 'auto') === 'light' ? 'checked' : '' ?>>
                    </label>
                    <label>
                        <span class="theme-mode-dot theme-mode-dot-dark"></span>
                        <?= t('settings.theme.dark') ?>
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
                        <h3 class="theme-group-title"><?= t('settings.theme.light_title') ?></h3>
                        <p class="theme-group-hint"><?= t('settings.theme.light_hint') ?></p>
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
                        <h3 class="theme-group-title"><?= t('settings.theme.dark_title') ?></h3>
                        <p class="theme-group-hint"><?= t('settings.theme.dark_hint') ?></p>
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
        <summary><?= t('settings.section.features') ?></summary>
        <form method="post" action="<?= htmlspecialchars($settingsAction, ENT_QUOTES, 'UTF-8') ?>" class="settings-form" data-auto-submit="change">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="save_feature_preferences">
            <div class="settings-block">
                <p class="settings-copy"><?= t('settings.features_hint1') ?></p>
                <p class="settings-copy"><?= t('settings.features_hint2') ?></p>
                <div class="settings-options">
                    <label class="settings-option">
                        <input
                            type="checkbox"
                            name="product_scanner_enabled"
                            value="1"
                            <?= !array_key_exists('product_scanner_enabled', $preferences) || !empty($preferences['product_scanner_enabled']) ? 'checked' : '' ?>
                        >
                        <span><?= t('settings.feature.product_scanner') ?></span>
                    </label>
                    <label class="settings-option">
                        <input
                            type="checkbox"
                            name="shopping_list_scanner_enabled"
                            value="1"
                            <?= !array_key_exists('shopping_list_scanner_enabled', $preferences) || !empty($preferences['shopping_list_scanner_enabled']) ? 'checked' : '' ?>
                        >
                        <span><?= t('settings.feature.shopping_scanner') ?></span>
                    </label>
                    <label class="settings-option">
                        <input
                            type="checkbox"
                            name="magic_button_enabled"
                            value="1"
                            <?= !array_key_exists('magic_button_enabled', $preferences) || !empty($preferences['magic_button_enabled']) ? 'checked' : '' ?>
                        >
                        <span><?= t('settings.feature.magic_button') ?></span>
                    </label>
                </div>
            </div>
        </form>
        <form method="post" action="<?= htmlspecialchars($settingsAction, ENT_QUOTES, 'UTF-8') ?>" class="settings-form" data-auto-submit="change" data-local-preferences="1">
            <div class="settings-block">
                <p class="settings-copy"><?= t('settings.feature.device_only_hint') ?></p>
                <div class="settings-options">
                    <label class="settings-option">
                        <input
                            type="checkbox"
                            name="category_swipe_enabled"
                            value="1"
                            <?= !array_key_exists('category_swipe_enabled', $preferences) || !empty($preferences['category_swipe_enabled']) ? 'checked' : '' ?>
                        >
                        <span><?= t('settings.feature.category_swipe') ?></span>
                    </label>
                </div>
            </div>
        </form>
    </details>

    <details class="settings-section settings-accordion" data-settings-panel="categories" open>
        <summary><?= t('settings.section.categories') ?></summary>
        <div class="settings-block">
            <p class="settings-copy"><?= t('settings.categories_hint') ?></p>
            <div class="settings-options settings-category-list" data-category-list>
                <?php foreach ($categories as $category): ?>
                    <?php
                    $categoryIcon = normalizeCategoryIcon((string) $category['icon'], (string) $category['type']);
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
                                <span class="settings-drag-handle" aria-hidden="true" title="<?= t('settings.drag_hint') ?>">
                                    <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
                                        <circle cx="5" cy="4" r="2"/><circle cx="11" cy="4" r="2"/>
                                        <circle cx="5" cy="10" r="2"/><circle cx="11" cy="10" r="2"/>
                                        <circle cx="5" cy="16" r="2"/><circle cx="11" cy="16" r="2"/>
                                    </svg>
                                </span>
                                <span class="settings-category-preview-icon" aria-hidden="true">
                                    <img src="<?= htmlspecialchars(categoryIconAssetPath($categoryIcon), ENT_QUOTES, 'UTF-8') ?>" alt="" loading="lazy" decoding="async" class="category-icon-img">
                                </span>
                                <span class="settings-category-preview-name"><?= htmlspecialchars((string) $category['name'], ENT_QUOTES, 'UTF-8') ?></span>
                                <span class="settings-type-badge"><?= htmlspecialchars(categoryTypeLabel((string) $category['type']), ENT_QUOTES, 'UTF-8') ?></span>
                                <svg class="settings-summary-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <polyline points="4 6 8 10 12 6"/>
                                </svg>
                            </summary>
                            <div class="settings-category-body">
                                <div class="settings-row-main">
                                    <label class="settings-field settings-field-name">
                                        <span><?= t('settings.field.name') ?></span>
                                        <input
                                            type="text"
                                            name="category_name"
                                            value="<?= htmlspecialchars((string) $category['name'], ENT_QUOTES, 'UTF-8') ?>"
                                            maxlength="120"
                                            required
                                        >
                                    </label>
                                    <fieldset class="settings-field settings-field-icon settings-icon-field">
                                        <legend><?= t('settings.field.symbol') ?></legend>
                                        <div class="category-icon-grid">
                                            <?php foreach ($categoryIconOptions as $iconOption): ?>
                                                <label class="category-icon-choice" title="<?= htmlspecialchars(categoryIconLabel($iconOption), ENT_QUOTES, 'UTF-8') ?>">
                                                    <input
                                                        type="radio"
                                                        name="category_icon"
                                                        value="<?= htmlspecialchars($iconOption, ENT_QUOTES, 'UTF-8') ?>"
                                                        <?= $iconOption === $categoryIcon ? 'checked' : '' ?>
                                                    >
                                                    <span class="category-icon-choice-visual" aria-hidden="true">
                                                        <img src="<?= htmlspecialchars(categoryIconAssetPath($iconOption), ENT_QUOTES, 'UTF-8') ?>" alt="" loading="lazy" decoding="async" class="category-icon-img">
                                                    </span>
                                                    <span class="category-icon-choice-label"><?= htmlspecialchars(categoryIconLabel($iconOption), ENT_QUOTES, 'UTF-8') ?></span>
                                                </label>
                                            <?php endforeach; ?>
                                        </div>
                                    </fieldset>
                                </div>
                                <div class="settings-row-bottom">
                                    <label class="settings-toggle">
                                        <input
                                            type="checkbox"
                                            name="category_hidden"
                                            value="1"
                                            <?= (int) $category['is_hidden'] === 1 ? 'checked' : '' ?>
                                        >
                                        <span><?= t('settings.field.hide') ?></span>
                                    </label>
                                    <div class="settings-row-actions">
                                        <button type="submit" class="settings-save settings-row-save"><?= t('settings.action.save') ?></button>
                                        <button
                                            type="submit"
                                            name="action"
                                            value="delete_category"
                                            class="settings-delete-button"
                                            formnovalidate
                                            onclick="return confirm('<?= t('settings.confirm.delete_category') ?>')"
                                        ><?= t('settings.action.delete') ?></button>
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
        <summary><?= t('settings.section.new_category') ?></summary>
        <form method="post" action="<?= htmlspecialchars($settingsAction, ENT_QUOTES, 'UTF-8') ?>" class="settings-form">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="create_category">
            <div class="settings-block">
                <p class="settings-copy"><?= t('settings.new_category_hint') ?></p>
                <div class="settings-password-fields">
                    <fieldset class="settings-field settings-icon-field">
                        <legend><?= t('settings.field.symbol') ?></legend>
                        <div class="category-icon-grid category-icon-grid-new">
                            <label class="category-icon-choice category-icon-choice-auto" title="<?= t('settings.icon.auto_title') ?>">
                                <input type="radio" name="icon" value="" checked>
                                <span class="category-icon-choice-visual category-icon-choice-auto-visual" aria-hidden="true">A</span>
                                <span class="category-icon-choice-label"><?= t('settings.icon.auto_label') ?></span>
                            </label>
                            <?php foreach ($iconOptions as $iconOption): ?>
                                <label class="category-icon-choice" title="<?= htmlspecialchars(categoryIconLabel($iconOption), ENT_QUOTES, 'UTF-8') ?>">
                                    <input type="radio" name="icon" value="<?= htmlspecialchars($iconOption, ENT_QUOTES, 'UTF-8') ?>">
                                    <span class="category-icon-choice-visual" aria-hidden="true">
                                        <img src="<?= htmlspecialchars(categoryIconAssetPath($iconOption), ENT_QUOTES, 'UTF-8') ?>" alt="" loading="lazy" decoding="async" class="category-icon-img">
                                    </span>
                                    <span class="category-icon-choice-label"><?= htmlspecialchars(categoryIconLabel($iconOption), ENT_QUOTES, 'UTF-8') ?></span>
                                </label>
                            <?php endforeach; ?>
                        </div>
                    </fieldset>
                    <label class="settings-field">
                        <span><?= t('settings.field.name') ?></span>
                        <input type="text" name="name" maxlength="120" required>
                    </label>
                    <label class="settings-field">
                        <span><?= t('settings.field.type') ?></span>
                        <select name="type" required>
                            <?php foreach (CATEGORY_TYPES as $type): ?>
                                <option value="<?= htmlspecialchars($type, ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars(categoryTypeLabel($type), ENT_QUOTES, 'UTF-8') ?></option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                </div>
            </div>

            <div class="settings-actions">
                <button type="submit" class="settings-save"><?= t('settings.action.create_category') ?></button>
            </div>
        </form>
    </details>

    <?php if (!empty($preferences['magic_button_enabled'])): ?>
    <details class="settings-section settings-accordion" data-settings-panel="ai" open>
        <summary><?= t('settings.section.ai') ?></summary>
        <form method="post" action="<?= htmlspecialchars($settingsAction, ENT_QUOTES, 'UTF-8') ?>" class="settings-form">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="save_ai_preferences">
            <div class="settings-block">
                <p class="settings-copy"><?= t('settings.ai_hint') ?></p>
                <div class="settings-password-fields">
                    <label class="settings-field">
                        <span><?= t('settings.field.gemini_api_key') ?></span>
                        <input type="password" id="gemini_api_key_input" name="gemini_api_key" value="<?= htmlspecialchars((string) ($preferences['gemini_api_key'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" placeholder="AIzaSy...">
                    </label>
                    <label class="settings-field">
                        <span><?= t('settings.field.gemini_model') ?></span>
                        <select id="gemini_model_select" name="gemini_model">
                            <?php foreach ($geminiModels as $modelValue => $modelLabel): ?>
                                <option value="<?= htmlspecialchars($modelValue, ENT_QUOTES, 'UTF-8') ?>" <?= ($preferences['gemini_model'] ?? 'gemini-2.5-flash') === $modelValue ? 'selected' : '' ?>>
                                    <?= htmlspecialchars($modelLabel, ENT_QUOTES, 'UTF-8') ?>
                                </option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                    <button type="button" id="test-api-key" class="settings-link"><?= t('settings.action.test_connection') ?></button>
                </div>
                <div id="api-test-status" class="api-test-status" style="margin-top: 8px; font-size: 0.85rem; display: none;"></div>
                <?php if ($aiKeyStatus !== null): ?>
                    <p class="settings-inline-status settings-inline-status-<?= htmlspecialchars($aiKeyStatusType, ENT_QUOTES, 'UTF-8') ?>">
                        <?= htmlspecialchars($aiKeyStatus, ENT_QUOTES, 'UTF-8') ?>
                    </p>
                <?php endif; ?>
            </div>
            <div class="settings-actions">
                <button type="submit" class="settings-save"><?= t('settings.action.save_ai') ?></button>
            </div>
        </form>
    </details>
    <?php endif; ?>

    <details class="settings-section settings-accordion" data-settings-panel="extension">
        <summary><?= t('settings.section.extension') ?></summary>
        <div class="settings-block">
            <p class="settings-copy"><?= t('settings.extension_hint') ?></p>
            <div class="settings-password-fields">
                <label class="settings-field">
                    <span><?= t('settings.field.api_key') ?></span>
                    <input type="text" id="api-key-value" value="<?= htmlspecialchars($apiKey, ENT_QUOTES, 'UTF-8') ?>" readonly>
                </label>
            </div>
            <div class="settings-actions" style="gap: 0.75rem; flex-wrap: wrap;">
                <button type="button" class="settings-save" id="copy-api-key"><?= t('settings.action.copy') ?></button>
                <a href="<?= htmlspecialchars(appPath('extension-download.php') . '?firefox', ENT_QUOTES, 'UTF-8') ?>" class="settings-link settings-link-firefox"><?= t('settings.action.download_firefox') ?></a>
                <a href="<?= htmlspecialchars(appPath('extension-download.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-link settings-link-chrome"><?= t('settings.action.download_chrome') ?></a>
                <form method="post" action="<?= htmlspecialchars($settingsAction, ENT_QUOTES, 'UTF-8') ?>" class="settings-form" style="margin:0;">
                    <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
                    <input type="hidden" name="action" value="regenerate_api_key">
                    <button type="submit" class="settings-link" formnovalidate><?= t('settings.action.regenerate_key') ?></button>
                </form>
            </div>
            <p class="settings-copy"><?= t('settings.extension_download_hint') ?></p>
        </div>
    </details>

    <details class="settings-section settings-section-secondary settings-accordion" data-settings-panel="password"<?= $passwordChangeRequired ? ' open' : '' ?>>
        <summary><?= t('settings.section.password') ?></summary>
        <form method="post" action="<?= htmlspecialchars($settingsAction, ENT_QUOTES, 'UTF-8') ?>" class="settings-form">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="change_password">
            <div class="settings-block">
                <p class="settings-copy"><?= t('settings.password_hint') ?></p>
                <div class="settings-password-fields">
                    <?php if (!$passwordChangeRequired): ?>
                        <label class="settings-field">
                            <span><?= t('settings.field.current_password') ?></span>
                            <input type="password" name="current_password" autocomplete="current-password" required>
                        </label>
                    <?php endif; ?>
                    <label class="settings-field">
                        <span><?= t('settings.field.new_password') ?></span>
                        <input type="password" name="new_password" autocomplete="new-password" required>
                    </label>
                    <label class="settings-field">
                        <span><?= t('settings.field.new_password_confirm') ?></span>
                        <input type="password" name="new_password_confirm" autocomplete="new-password" required>
                    </label>
                </div>
            </div>

            <div class="settings-actions">
                <button type="submit" class="settings-save"><?= t('settings.section.password') ?></button>
            </div>
        </form>
    </details>

    <details class="settings-section settings-section-secondary settings-accordion" data-settings-panel="system">
        <summary><?= t('settings.section.system') ?></summary>
        <div class="settings-block">
            <p class="settings-copy"><?= t('settings.logged_in_as') ?> <strong><?= htmlspecialchars((string) ($currentUser['username'] ?? 'unbekannt'), ENT_QUOTES, 'UTF-8') ?></strong>.</p>
            <p class="settings-copy"><?= t('settings.info.app_version') ?> <?= htmlspecialchars($assetVersion, ENT_QUOTES, 'UTF-8') ?></p>
            <?php if ($swVersion): ?>
            <p class="settings-copy"><?= t('settings.info.sw_version') ?> <?= htmlspecialchars($swVersion, ENT_QUOTES, 'UTF-8') ?></p>
            <?php endif; ?>
            <p class="settings-copy"><?= t('settings.info.php_version') ?> <?= htmlspecialchars(PHP_VERSION, ENT_QUOTES, 'UTF-8') ?></p>
            <p class="settings-copy"><?= t('settings.info.sqlite_version') ?> <?= htmlspecialchars((string) $db->query('SELECT sqlite_version()')->fetchColumn(), ENT_QUOTES, 'UTF-8') ?></p>
            <a href="<?= htmlspecialchars(appPath('logout.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-link" target="_top"><?= t('settings.action.logout') ?></a>
        </div>
    </details>
</div>
<script id="settings-data" type="application/json">
<?= json_encode([
    'allThemeColors' => (static function (): array {
        $colors = [];
        foreach (getAvailableThemes() as $themeGroup) {
            foreach (array_keys($themeGroup ?? []) as $themeKey) {
                $colors[$themeKey] = getThemeColor((string) $themeKey);
            }
        }
        return $colors;
    })(),
    'themePreferences' => [
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
    ],
    'settingsStorageScope' => $currentTab,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>
</script>
<script type="module" src="js/settings.js?v=<?= urlencode($assetVersion) ?>"></script>
</body>
</html>
