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

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $providedToken = $_POST['csrf_token'] ?? null;

    if (!hasValidCsrfToken(is_string($providedToken) ? $providedToken : null)) {
        $flash = 'Ungültiges Sicherheits-Token.';
        $flashType = 'err';
    } else {
        $hiddenSections = $_POST['hidden_sections'] ?? [];
        $preferences = updateUserPreferences($db, $userId, [
            'hidden_sections' => is_array($hiddenSections) ? $hiddenSections : [],
        ]);
        $flash = 'Einstellungen gespeichert.';
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
        <p class="settings-copy">Andere Anzeige-Einstellungen wie letzter Bereich, Modus oder Reihenfolge der Symbole werden jetzt automatisch serverseitig pro Benutzer gespeichert.</p>
        <a href="<?= htmlspecialchars(appPath('logout.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-link">Abmelden</a>
    </section>
</div>
</body>
</html>
