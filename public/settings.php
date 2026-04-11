<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require __DIR__ . '/theme.php';

enforceCanonicalRequest();
$userId = requireAuth();
$db = getDatabase();
$csrfToken = getCsrfToken();
$flash = null;
$flashType = 'ok';

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

            if ($currentPassword === '' || $newPassword === '' || $newPasswordConfirm === '') {
                $flash = 'Bitte alle Passwort-Felder ausfüllen.';
                $flashType = 'err';
            } elseif (($passwordError = validateSettingsPassword($newPassword)) !== null) {
                $flash = $passwordError;
                $flashType = 'err';
            } elseif ($newPassword !== $newPasswordConfirm) {
                $flash = 'Die neuen Passwörter stimmen nicht überein.';
                $flashType = 'err';
            } else {
                $stmt = $db->prepare('SELECT password_hash FROM users WHERE id = :id LIMIT 1');
                $stmt->execute([':id' => $userId]);
                $user = $stmt->fetch();

                if (!is_array($user) || !password_verify($currentPassword, (string) $user['password_hash'])) {
                    $flash = 'Aktuelles Passwort ist nicht korrekt.';
                    $flashType = 'err';
                } else {
                    $db->prepare('UPDATE users SET password_hash = :password_hash WHERE id = :id')
                        ->execute([
                            ':password_hash' => password_hash($newPassword, PASSWORD_BCRYPT),
                            ':id' => $userId,
                        ]);
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
            } else {
                $flash = 'Kategorie konnte nicht verschoben werden.';
                $flashType = 'err';
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
                    }
                }
            }
        } elseif ($action === 'save_theme') {
            $lightTheme = (string) ($_POST['light_theme'] ?? 'hafenblau');
            $darkTheme = (string) ($_POST['dark_theme'] ?? 'nachtwache');
            if (!in_array($lightTheme, ['parchment', 'hafenblau'], true)) {
                $lightTheme = 'hafenblau';
            }
            if (!in_array($darkTheme, ['nachtwache', 'pier'], true)) {
                $darkTheme = 'nachtwache';
            }
            updateExtendedUserPreferences($db, $userId, [
                'light_theme' => $lightTheme,
                'dark_theme' => $darkTheme,
            ]);
            $flash = 'Themes gespeichert.';
        } elseif ($action === 'save_app_preferences') {
            $preferences = updateExtendedUserPreferences($db, $userId, [
                'category_swipe_enabled' => isset($_POST['category_swipe_enabled']),
            ]);
            $flash = 'Anzeige-Einstellungen gespeichert.';
        } elseif ($action === 'regenerate_api_key') {
            setUserApiKey($db, $userId);
            $flash = 'API-Key neu erzeugt.';
        }
    }
}

$preferences = getExtendedUserPreferences($db, $userId);
$apiKey = getUserApiKey($db, $userId);
if ($apiKey === null) {
    $apiKey = setUserApiKey($db, $userId);
}
$categories = loadUserCategories($db, $userId);
$iconOptions = getCategoryIconOptions();
$currentTab = $_GET['tab'] ?? 'app';
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
<?php
$effectiveTheme = resolveEffectiveTheme($preferences);
$themeColor = getThemeColor($effectiveTheme);
$brandMarkSrc = appPath('icon.php?size=96&theme=' . rawurlencode($effectiveTheme) . '&v=2.0.0');
?>
    <meta name="theme-color" content="<?= htmlspecialchars($themeColor, ENT_QUOTES, 'UTF-8') ?>">
    <?= renderThemeBootScript($preferences) ?>
    <title>Einstellungen — Ankerkladde</title>
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('style.css?v=2.0.0'), ENT_QUOTES, 'UTF-8') ?>">
</head>
<body class="settings-page" data-theme="<?= htmlspecialchars($effectiveTheme, ENT_QUOTES, 'UTF-8') ?>">
<div class="settings-card">
    <div class="settings-header">
        <div class="settings-title-group">
            <img src="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>" alt="" class="brand-mark brand-mark-settings" aria-hidden="true">
            <h1>Einstellungen</h1>
        </div>
        <a href="<?= htmlspecialchars(appPath('index.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-back" aria-label="Zurück zur App">←</a>
    </div>

    <div class="settings-tabs">
        <a href="?tab=app" class="settings-tab <?= ($currentTab ?? 'app') === 'app' ? 'settings-tab-active' : '' ?>">App</a>
        <a href="?tab=extension" class="settings-tab <?= ($currentTab ?? 'app') === 'extension' ? 'settings-tab-active' : '' ?>">Erweiterung</a>
    </div>

    <?php if ($flash !== null): ?>
        <div class="settings-flash settings-flash-<?= htmlspecialchars($flashType, ENT_QUOTES, 'UTF-8') ?>">
            <?= htmlspecialchars($flash, ENT_QUOTES, 'UTF-8') ?>
        </div>
    <?php endif; ?>

    <?php if (($currentTab ?? 'app') === 'app'): ?>
    <section class="settings-section">
        <form method="post" action="<?= htmlspecialchars(appPath('settings.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-form">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="save_theme">
            <div class="settings-block">
                <h2>Erscheinungsbild</h2>
                <p class="settings-copy">In der App-Leiste schaltest du zwischen Hell, Dunkel und Auto um. Hier legst du fest, welche Themes dabei verwendet werden.</p>
                <div class="theme-grid">
                    <div>
                        <h3 class="theme-group-title">Light Theme</h3>
                        <div class="theme-list">
                            <label>
                                <span class="theme-dot" style="background:#1a6090;"></span>
                                Hafenblau
                                <input type="radio" name="light_theme" value="hafenblau" <?= $preferences['light_theme'] === 'hafenblau' ? 'checked' : '' ?>>
                            </label>
                            <label>
                                <span class="theme-dot" style="background:#c8b89a;"></span>
                                Parchment
                                <input type="radio" name="light_theme" value="parchment" <?= $preferences['light_theme'] === 'parchment' ? 'checked' : '' ?>>
                            </label>
                        </div>
                    </div>
                    <div>
                        <h3 class="theme-group-title">Dark Theme</h3>
                        <div class="theme-list">
                            <label>
                                <span class="theme-dot" style="background:#162338; border-color:rgba(255,255,255,0.15);"></span>
                                Nachtwache
                                <input type="radio" name="dark_theme" value="nachtwache" <?= $preferences['dark_theme'] === 'nachtwache' ? 'checked' : '' ?>>
                            </label>
                            <label>
                                <span class="theme-dot" style="background:#0f1419; border-color:rgba(255,255,255,0.15);"></span>
                                Pier bei Nacht
                                <input type="radio" name="dark_theme" value="pier" <?= $preferences['dark_theme'] === 'pier' ? 'checked' : '' ?>>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
            <div class="settings-actions">
                <button type="submit" class="settings-save">Themes speichern</button>
            </div>
        </form>
    </section>

    <section class="settings-section settings-section-secondary">
        <form method="post" action="<?= htmlspecialchars(appPath('settings.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-form">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="save_app_preferences">
            <div class="settings-block">
                <h2>Anzeige</h2>
                <div class="settings-options">
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

            <div class="settings-actions">
                <button type="submit" class="settings-save">Anzeige speichern</button>
            </div>
        </form>
    </section>

    <section class="settings-section">
        <div class="settings-block">
            <h2>Kategorien</h2>
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
                    <form method="post" action="<?= htmlspecialchars(appPath('settings.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-option settings-category-row">
                        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
                        <input type="hidden" name="action" value="save_category">
                        <input type="hidden" name="category_id" value="<?= (int) $category['id'] ?>">
                        <div class="settings-row-main">
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
                        </div>
                        <div class="settings-row-bottom">
                            <div class="settings-row-meta">
                                <span class="settings-type-badge"><?= htmlspecialchars(categoryTypeLabel((string) $category['type']), ENT_QUOTES, 'UTF-8') ?></span>
                                <label class="settings-toggle">
                                    <input
                                        type="checkbox"
                                        name="category_hidden"
                                        value="1"
                                        <?= (int) $category['is_hidden'] === 1 ? 'checked' : '' ?>
                                    >
                                    <span>Ausblenden</span>
                                </label>
                                <div class="settings-move-group" aria-label="Reihenfolge">
                                    <button
                                        type="submit"
                                        name="move_direction"
                                        value="up"
                                        formnovalidate
                                        class="settings-move-button"
                                        title="Nach oben"
                                    >↑</button>
                                    <button
                                        type="submit"
                                        name="move_direction"
                                        value="down"
                                        formnovalidate
                                        class="settings-move-button"
                                        title="Nach unten"
                                    >↓</button>
                                </div>
                            </div>
                            <div class="settings-row-actions">
                                <button type="submit" class="settings-save settings-row-save">Speichern</button>
                                <button
                                    type="submit"
                                    name="action"
                                    value="delete_category"
                                    class="settings-link settings-delete-button"
                                    formnovalidate
                                >Löschen</button>
                            </div>
                        </div>
                    </form>
                <?php endforeach; ?>
            </div>
        </div>
    </section>

    <section class="settings-section">
        <form method="post" action="<?= htmlspecialchars(appPath('settings.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-form">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="create_category">
            <div class="settings-block">
                <h2>Neue Kategorie</h2>
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
    </section>
    <?php endif; ?>

    <?php if (($currentTab ?? 'app') === 'extension'): ?>
    <section class="settings-section">
        <div class="settings-block">
            <h2>Browser-Extension</h2>
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
                <form method="post" action="<?= htmlspecialchars(appPath('settings.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-form" style="margin:0;">
                    <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
                    <input type="hidden" name="action" value="regenerate_api_key">
                    <button type="submit" class="settings-link" formnovalidate>Neu erzeugen</button>
                </form>
            </div>
            <p class="settings-copy">Wenn sich die Erweiterung spaeter aendert, hier einfach erneut herunterladen.</p>
        </div>
    </section>

    <section class="settings-section settings-section-secondary">
        <form method="post" action="<?= htmlspecialchars(appPath('settings.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-form">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="change_password">
            <div class="settings-block">
                <h2>Passwort ändern</h2>
                <p class="settings-copy">Dein neues Passwort muss mindestens 8 Zeichen lang sein.</p>
                <div class="settings-password-fields">
                    <label class="settings-field">
                        <span>Aktuelles Passwort</span>
                        <input type="password" name="current_password" autocomplete="current-password" required>
                    </label>
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
    </section>

    <section class="settings-section settings-section-secondary">
        <p class="settings-copy">Global gespeichert bleiben Modus, ausgeblendete Tabs, letzter aktiver Bereich und Installationshinweis. Zuletzt aktiv: <?= $preferences['last_category_id'] !== null ? (int) $preferences['last_category_id'] : 'keine' ?>.</p>
        <a href="<?= htmlspecialchars(appPath('logout.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-link">Abmelden</a>
    </section>
    <?php endif; ?>
</div>
<script>
(() => {
    const themePreferences = <?= json_encode([
        'theme_mode' => $preferences['theme_mode'] ?? 'auto',
        'light_theme' => $preferences['light_theme'] ?? 'hafenblau',
        'dark_theme' => $preferences['dark_theme'] ?? 'nachtwache',
        'theme_colors' => [
            'parchment' => getThemeColor('parchment'),
            'hafenblau' => getThemeColor('hafenblau'),
            'nachtwache' => getThemeColor('nachtwache'),
            'pier' => getThemeColor('pier'),
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>;
    const scrollKey = 'einkauf-settings-scroll-y';
    const copyButton = document.getElementById('copy-api-key');
    const apiKeyInput = document.getElementById('api-key-value');
    const saved = window.sessionStorage.getItem(scrollKey);
    const themeMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

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
    }

    applySettingsTheme();

    if (saved !== null) {
        window.sessionStorage.removeItem(scrollKey);
        window.requestAnimationFrame(() => {
            window.scrollTo({ top: Number(saved) || 0, behavior: 'auto' });
        });
    }

    document.querySelectorAll('form.settings-form, form.settings-category-row').forEach(form => {
        form.addEventListener('submit', () => {
            window.sessionStorage.setItem(scrollKey, String(window.scrollY || window.pageYOffset || 0));
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
})();
</script>
</body>
</html>
