<?php
declare(strict_types=1);

/**
 * Impressum fuer Ankerkladde.
 *
 * Eigene Seite ohne Login-Pflicht — Impressum muss nach § 5 TMG ohne
 * Zugangsbarriere erreichbar sein. Theme/PWA-Aussehen werden ueber das
 * gleiche Theme-System wie login.php hergestellt, sodass die Seite
 * konsistent aussieht und per Service Worker gecached werden kann.
 */

require dirname(__DIR__, 2) . '/db.php';
require dirname(__DIR__, 2) . '/security.php';
require __DIR__ . '/../theme.php';
require __DIR__ . '/../legalConfig.php';

enforceCanonicalRequest();
startAppSession();
$basePath = appPath();
$assetVersion = '2.0.4';
$legalAnbieter = getLegalAnbieter();
$themeColor = getThemeColor(resolveEffectiveTheme(getThemePreferenceDefaults()));
$brandMarkSrc = appPath('icon.php?size=192&theme=auto&v=' . rawurlencode($assetVersion));

?><!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="<?= htmlspecialchars($themeColor, ENT_QUOTES, 'UTF-8') ?>">
    <meta name="color-scheme" content="light dark">
    <title>Ankerkladde – Impressum</title>
    <link rel="manifest" href="<?= htmlspecialchars(appPath('manifest.php?v=' . $assetVersion), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('style.css?v=' . $assetVersion), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="icon" href="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>">
</head>
<body class="theme-default legal-page">
    <main class="legal-page-main">
        <p><a class="legal-back" href="<?= htmlspecialchars(appPath('login.php'), ENT_QUOTES, 'UTF-8') ?>">&larr; Zur Anmeldung</a></p>

        <h1>Impressum</h1>
        <p class="muted small">Angaben gemaess § 5 TMG</p>

        <address class="not-italic">
            <strong><?= htmlspecialchars($legalAnbieter['name'], ENT_QUOTES, 'UTF-8') ?></strong>
            <?php if ($legalAnbieter['rechtsform_name']): ?>
                <br><?= htmlspecialchars($legalAnbieter['rechtsform_name'], ENT_QUOTES, 'UTF-8') ?>
                <?php if ($legalAnbieter['rechtsform_hrb']): ?>
                    <br><?= htmlspecialchars($legalAnbieter['rechtsform_hrb'], ENT_QUOTES, 'UTF-8') ?>
                <?php endif; ?>
            <?php endif; ?>
            <?php foreach ($legalAnbieter['adresse'] as $line): ?>
                <br><?= htmlspecialchars($line, ENT_QUOTES, 'UTF-8') ?>
            <?php endforeach; ?>
        </address>

        <h2>Kontakt</h2>
        <p>
            E-Mail: <a href="mailto:<?= htmlspecialchars($legalAnbieter['email'], ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars($legalAnbieter['email'], ENT_QUOTES, 'UTF-8') ?></a>
            <?php if ($legalAnbieter['telefon']): ?>
                <br>Telefon: <?= htmlspecialchars($legalAnbieter['telefon'], ENT_QUOTES, 'UTF-8') ?>
            <?php endif; ?>
        </p>

        <h2>Dienstebeschreibung</h2>
        <p>
            <?= htmlspecialchars($legalAnbieter['app_name'], ENT_QUOTES, 'UTF-8') ?> ist eine mobile-first
            Web-Anwendung zur Verwaltung persoenlicher Listen, Notizen, Bilder, Dateien
            und Links. Die Anwendung speichert Daten lokal in einer SQLite-Datenbank und
            laeuft unter <code><?= htmlspecialchars($legalAnbieter['app_domain'], ENT_QUOTES, 'UTF-8') ?></code>.
        </p>

        <h2>Verantwortlich fuer den Inhalt nach § 18 Abs. 2 MStV</h2>
        <p><?= htmlspecialchars($legalAnbieter['name'], ENT_QUOTES, 'UTF-8') ?>, Anschrift wie oben.</p>
    </main>
</body>
</html>
