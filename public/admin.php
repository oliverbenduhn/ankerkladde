<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require __DIR__ . '/theme.php';

enforceCanonicalRequest();
$currentUserId = requireAdmin();

$db = getDatabase();
$adminPreferences = getExtendedUserPreferences($db, $currentUserId);

$flash      = null;
$flashType  = 'ok';

function validateNewPassword(string $password): ?string
{
    if (strlen($password) < 8) {
        return 'Passwort muss mindestens 8 Zeichen lang sein.';
    }
    return null;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $providedToken = $_POST['csrf_token'] ?? null;

    if (!hasValidCsrfToken(is_string($providedToken) ? $providedToken : null)) {
        $flash     = 'Ungültiges Sicherheits-Token.';
        $flashType = 'err';
    } else {
        $postAction = (string) ($_POST['action'] ?? '');

        if ($postAction === 'create') {
            $newUsername = normalizeUsername((string) ($_POST['username'] ?? ''));
            $newPassword = (string) ($_POST['password'] ?? '');

            if ($newUsername === '') {
                $flash = 'Benutzername darf nicht leer sein.';
                $flashType = 'err';
            } elseif (($pwErr = validateNewPassword($newPassword)) !== null) {
                $flash = $pwErr;
                $flashType = 'err';
            } else {
                try {
                    $stmt = $db->prepare(
                        'INSERT INTO users (username, password_hash, is_admin)
                         VALUES (:username, :password_hash, 0)'
                    );
                    $stmt->execute([
                        ':username'      => $newUsername,
                        ':password_hash' => password_hash($newPassword, PASSWORD_BCRYPT),
                    ]);
                    $flash = "Nutzer '{$newUsername}' angelegt.";
                } catch (PDOException $e) {
                    if (str_contains($e->getMessage(), 'UNIQUE')) {
                        $flash = "Benutzername '{$newUsername}' ist bereits vergeben.";
                    } else {
                        $flash = 'Fehler beim Anlegen des Nutzers.';
                    }
                    $flashType = 'err';
                }
            }

        } elseif ($postAction === 'delete') {
            $targetId = filter_var($_POST['user_id'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 1],
            ]);

            if (!$targetId) {
                $flash = 'Ungültige Nutzer-ID.';
                $flashType = 'err';
            } else {
                // Prevent deleting admin accounts
                $targetStmt = $db->prepare('SELECT username, is_admin FROM users WHERE id = :id LIMIT 1');
                $targetStmt->execute([':id' => $targetId]);
                $targetUser = $targetStmt->fetch();

                if (!is_array($targetUser)) {
                    $flash = 'Nutzer nicht gefunden.';
                    $flashType = 'err';
                } elseif ((bool) $targetUser['is_admin']) {
                    $flash = 'Admin-Konten können nicht gelöscht werden.';
                    $flashType = 'err';
                } elseif ($targetId === $currentUserId) {
                    $flash = 'Du kannst dein eigenes Konto nicht löschen.';
                    $flashType = 'err';
                } else {
                    // Collect attachment file paths for physical deletion
                    $attStmt = $db->prepare(
                        'SELECT attachments.storage_section, attachments.stored_name
                         FROM attachments
                         INNER JOIN items ON items.id = attachments.item_id
                         WHERE items.user_id = :user_id'
                    );
                    $attStmt->execute([':user_id' => $targetId]);
                    $attachments = $attStmt->fetchAll();

                    $db->beginTransaction();
                    $db->prepare('DELETE FROM items WHERE user_id = :user_id')
                       ->execute([':user_id' => $targetId]);
                    $db->prepare('DELETE FROM users WHERE id = :id')
                       ->execute([':id' => $targetId]);
                    $db->commit();

                    foreach ($attachments as $att) {
                        try {
                            deleteAttachmentStorageFile($att);
                        } catch (Throwable) {
                            // best-effort file cleanup
                        }
                    }

                    $flash = "Nutzer '{$targetUser['username']}' gelöscht.";
                }
            }

        } elseif ($postAction === 'reset_password') {
            $targetId    = filter_var($_POST['user_id'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 1],
            ]);
            $newPassword = (string) ($_POST['new_password'] ?? '');

            if (!$targetId) {
                $flash = 'Ungültige Nutzer-ID.';
                $flashType = 'err';
            } elseif (($pwErr = validateNewPassword($newPassword)) !== null) {
                $flash = $pwErr;
                $flashType = 'err';
            } else {
                $targetStmt = $db->prepare(
                    'SELECT username, is_admin FROM users WHERE id = :id LIMIT 1'
                );
                $targetStmt->execute([':id' => $targetId]);
                $targetUser = $targetStmt->fetch();

                if (!is_array($targetUser)) {
                    $flash = 'Nutzer nicht gefunden.';
                    $flashType = 'err';
                } elseif ((bool) $targetUser['is_admin']) {
                    $flash = 'Admin-Passwort kann hier nicht geändert werden.';
                    $flashType = 'err';
                } elseif ($targetId === $currentUserId) {
                    $flash = 'Eigenes Passwort kann hier nicht zurückgesetzt werden.';
                    $flashType = 'err';
                } else {
                    $db->prepare(
                        'UPDATE users SET password_hash = :hash WHERE id = :id'
                    )->execute([
                        ':hash' => password_hash($newPassword, PASSWORD_BCRYPT),
                        ':id'   => $targetId,
                    ]);
                    $flash = "Passwort für '{$targetUser['username']}' zurückgesetzt.";
                }
            }
        }
    }
}

$csrfToken = getCsrfToken();

// Load all non-admin users
$users = $db->query(
    "SELECT id, username, created_at FROM users WHERE is_admin = 0 ORDER BY created_at ASC"
)->fetchAll();
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
<?php
$effectiveTheme = resolveEffectiveTheme($adminPreferences);
$themeColor = getThemeColor($effectiveTheme);
$brandMarkSrc = appPath('icon.php?size=96&theme=' . rawurlencode($effectiveTheme) . '&v=2.0.1');
?>
    <meta name="theme-color" content="<?= htmlspecialchars($themeColor, ENT_QUOTES, 'UTF-8') ?>">
    <?= renderThemeBootScript($adminPreferences) ?>
    <title>Nutzerverwaltung — Ankerkladde</title>
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('style.css?v=2.0.1'), ENT_QUOTES, 'UTF-8') ?>">
</head>
<body data-theme="<?= htmlspecialchars($effectiveTheme, ENT_QUOTES, 'UTF-8') ?>">
<div class="admin-page">

    <div class="admin-header">
        <div class="admin-title-group">
            <img src="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>" alt="" class="brand-mark brand-mark-admin" aria-hidden="true">
            <h1>Nutzerverwaltung</h1>
        </div>
        <a href="<?= htmlspecialchars(appPath('logout.php'), ENT_QUOTES, 'UTF-8') ?>" class="admin-logout">Abmelden</a>
    </div>

    <?php if ($flash !== null): ?>
        <div class="admin-flash admin-flash-<?= htmlspecialchars($flashType, ENT_QUOTES, 'UTF-8') ?>">
            <?= htmlspecialchars($flash, ENT_QUOTES, 'UTF-8') ?>
        </div>
    <?php endif; ?>

    <div class="admin-section">
        <h2>Nutzer anlegen</h2>
        <form method="post" action="<?= htmlspecialchars(appPath('admin.php'), ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="create">
            <div class="admin-form-row">
                <input type="text" name="username" placeholder="Benutzername" required autocomplete="off">
                <input type="password" name="password" placeholder="Passwort (min. 8 Zeichen)" required>
                <button type="submit" class="admin-btn">Anlegen</button>
            </div>
        </form>
    </div>

    <div class="admin-section">
        <h2>Nutzer</h2>
        <?php if ($users === []): ?>
            <p class="admin-notice">Noch keine regulären Nutzer vorhanden.</p>
        <?php else: ?>
            <ul class="admin-user-list">
            <?php foreach ($users as $user): ?>
                <li class="admin-user-item">
                    <span class="admin-user-name"><?= htmlspecialchars((string) $user['username'], ENT_QUOTES, 'UTF-8') ?></span>
                    <span class="admin-user-date"><?= htmlspecialchars(substr((string) $user['created_at'], 0, 10), ENT_QUOTES, 'UTF-8') ?></span>

                    <form method="post" action="<?= htmlspecialchars(appPath('admin.php'), ENT_QUOTES, 'UTF-8') ?>" class="admin-inline-form">
                        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
                        <input type="hidden" name="action" value="reset_password">
                        <input type="hidden" name="user_id" value="<?= (int) $user['id'] ?>">
                        <input type="password" name="new_password" placeholder="Neues Passwort" required>
                        <button type="submit" class="admin-btn-sm">Setzen</button>
                    </form>

                    <form method="post" action="<?= htmlspecialchars(appPath('admin.php'), ENT_QUOTES, 'UTF-8') ?>" class="admin-inline-form"
                          onsubmit="return confirm(<?= htmlspecialchars(json_encode('Nutzer ' . $user['username'] . ' wirklich löschen?'), ENT_QUOTES, 'UTF-8') ?>)">
                        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
                        <input type="hidden" name="action" value="delete">
                        <input type="hidden" name="user_id" value="<?= (int) $user['id'] ?>">
                        <button type="submit" class="admin-btn-sm admin-btn-sm-danger">Löschen</button>
                    </form>
                </li>
            <?php endforeach; ?>
            </ul>
        <?php endif; ?>
    </div>

</div>
</body>
</html>
