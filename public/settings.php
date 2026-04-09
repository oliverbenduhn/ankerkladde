<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';

enforceCanonicalRequest();
$userId = requireAuth();
$db = getDatabase();
$csrfToken = getCsrfToken();
$sections = [
    'shopping' => 'Einkauf',
    'meds' => 'Medizin',
    'todo_private' => 'Privat',
    'todo_work' => 'Arbeit',
    'notes' => 'Notizen',
    'images' => 'Bilder',
    'files' => 'Dateien',
    'links' => 'Links',
];
$flash = null;
$flashType = 'ok';

function validateSettingsPassword(string $password): ?string
{
    if (strlen($password) < 8) {
        return 'Passwort muss mindestens 8 Zeichen lang sein.';
    }

    return null;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $providedToken = $_POST['csrf_token'] ?? null;

    if (!hasValidCsrfToken(is_string($providedToken) ? $providedToken : null)) {
        $flash = 'Ungültiges Sicherheits-Token.';
        $flashType = 'err';
    } else {
        $action = (string) ($_POST['action'] ?? 'preferences');

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
        } else {
            $hiddenSections = $_POST['hidden_sections'] ?? [];
            $preferences = updateUserPreferences($db, $userId, [
                'hidden_sections' => is_array($hiddenSections) ? $hiddenSections : [],
            ]);
            $flash = 'Einstellungen gespeichert.';
        }
    }
}

$preferences ??= getUserPreferences($db, $userId);
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#f5f0eb">
    <title>Einstellungen — Zettel</title>
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('style.css'), ENT_QUOTES, 'UTF-8') ?>">
</head>
<body class="settings-page">
<div class="settings-card">
    <div class="settings-header">
        <h1>Einstellungen</h1>
        <a href="<?= htmlspecialchars(appPath('index.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-back" aria-label="Zurück zur App">←</a>
    </div>

    <?php if ($flash !== null): ?>
        <div class="settings-flash settings-flash-<?= htmlspecialchars($flashType, ENT_QUOTES, 'UTF-8') ?>">
            <?= htmlspecialchars($flash, ENT_QUOTES, 'UTF-8') ?>
        </div>
    <?php endif; ?>

    <section class="settings-section">
        <form method="post" action="<?= htmlspecialchars(appPath('settings.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-form">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <div class="settings-block">
                <h2>Sichtbare Bereiche</h2>
                <p class="settings-copy">Blende Symbole in der oberen Leiste ein oder aus. Mindestens ein Bereich bleibt immer sichtbar.</p>
                <div class="settings-options">
                    <?php foreach ($sections as $sectionKey => $sectionLabel): ?>
                        <label class="settings-option">
                            <input
                                type="checkbox"
                                name="hidden_sections[]"
                                value="<?= htmlspecialchars($sectionKey, ENT_QUOTES, 'UTF-8') ?>"
                                <?= in_array($sectionKey, $preferences['hidden_sections'], true) ? 'checked' : '' ?>
                            >
                            <span><?= htmlspecialchars($sectionLabel, ENT_QUOTES, 'UTF-8') ?> ausblenden</span>
                        </label>
                    <?php endforeach; ?>
                </div>
            </div>

            <div class="settings-actions">
                <button type="submit" class="settings-save">Speichern</button>
            </div>
        </form>
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
        <p class="settings-copy">Andere Anzeige-Einstellungen wie letzter Bereich, Modus oder Reihenfolge der Symbole werden jetzt automatisch serverseitig pro Benutzer gespeichert.</p>
        <a href="<?= htmlspecialchars(appPath('logout.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-link">Abmelden</a>
    </section>
</div>
</body>
</html>
