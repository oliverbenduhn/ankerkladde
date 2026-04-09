<?php
declare(strict_types=1);

require dirname(__DIR__) . '/security.php';

enforceCanonicalRequest();
requireAuth();
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

    <section class="settings-section">
        <p class="settings-copy">Hier kannst du dich aktuell abmelden.</p>
        <a href="<?= htmlspecialchars(appPath('logout.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-link">Abmelden</a>
    </section>
</div>
</body>
</html>
