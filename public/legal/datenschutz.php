<?php
declare(strict_types=1);

/**
 * Datenschutzerklaerung fuer Ankerkladde.
 *
 * Eigene Seite ohne Login-Pflicht — die Erreichbarkeit der
 * Datenschutzerklaerung darf nach DSGVO/TTDSG nicht von einem Login
 * abhaengen.
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
    <title>Ankerkladde – Datenschutzerklaerung</title>
    <link rel="manifest" href="<?= htmlspecialchars(appPath('manifest.php?v=' . $assetVersion), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('style.css?v=' . $assetVersion), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="icon" href="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>">
</head>
<body class="theme-default legal-page">
    <main class="legal-page-main">
        <p><a class="legal-back" href="<?= htmlspecialchars(appPath('login.php'), ENT_QUOTES, 'UTF-8') ?>">&larr; Zur Anmeldung</a></p>

        <h1>Datenschutzerklaerung</h1>

        <h2>1. Verantwortlicher</h2>
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
            <br>E-Mail: <a href="mailto:<?= htmlspecialchars($legalAnbieter['email'], ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars($legalAnbieter['email'], ENT_QUOTES, 'UTF-8') ?></a>
        </address>

        <h2>2. Art und Zweck der Datenverarbeitung</h2>
        <p>
            Ankerkladde ist eine selbst gehostete, login-geschuetzte Web-Anwendung fuer
            die Verwaltung persoenlicher Listen, Notizen, Bilder, Dateien und Links.
            Nutzerkonten, Eintraeger und Uploads werden in einer SQLite-Datenbank auf
            dem Server gespeichert (<code>user_id</code>-getrennt) und sind nur der
            jeweils angemeldeten Person sowie Administrator:innen zugaenglich.
        </p>

        <h2>3. Authentifizierung</h2>
        <p>
            Der Zugriff erfolgt ueber klassische Session-basierte Authentifizierung mit
            Passwort-Hash. Beim Login wird ein Session-Cookie gesetzt, das technisch der
            Aufrechterhaltung der Anmeldung dient und nach Logout bzw. Ablauf der
            Sitzung ungueltig wird.
        </p>

        <h2>4. Drittparteien &amp; externe Inhalte</h2>
        <p>
            Die Notiz-Bearbeitung laedt den JavaScript-Editor TipTap dynamisch vom
            Drittanbieter-CDN <code>esm.sh</code> und ggf. zusaetzlich Ressourcen von
            <code>unpkg.com</code>. Beim Aufruf dieser Ressourcen werden technisch
            bedingt Ihre IP-Adresse und der User-Agent an den jeweiligen Anbieter
            uebermittelt. Diese externen Aufrufe sind nicht zwingend erforderlich; die
            App funktioniert auch ohne diese Ressourcen in eingeschraenktem Umfang.
        </p>
        <p>
            Es werden <strong>keine externen Tracking-Dienste</strong> (kein Google
            Analytics, kein Plausible, kein Sentry, kein Matomo o. ae.) eingesetzt,
            keine Werbenetzwerke, keine third-party-Cookies.
        </p>

        <h2>5. Server-Logs und Fehlerbehandlung</h2>
        <p>
            Beim Betrieb des Servers fallen temporaer Protokolldaten an (z. B.
            IP-Adresse, Zeitpunkt, aufgerufene Route), die ausschliesslich der
            Fehlersuche und Betriebssicherheit dienen und nicht an Dritte
            weitergegeben werden.
        </p>

        <h2>6. Speicherdauer</h2>
        <p>
            Nutzungsdaten (Eintraege, Uploads, Notizen) bleiben gespeichert, bis sie
            von der jeweiligen Nutzerin/dem jeweiligen Nutzer oder einer:einem
            Administrator:in geloescht werden. Accounts koennen ueber die
            Profil-Einstellungen selbst geloescht werden.
        </p>

        <h2>7. Rechte der betroffenen Personen</h2>
        <p>
            Es besteht das Recht auf Auskunft, Berichtigung, Loeschung,
            Einschraenkung der Verarbeitung, Datenuebertragbarkeit sowie
            Widerspruch gegen die Verarbeitung nach Art. 15–21 DSGVO. Anfragen
            richten Sie bitte an die in Abschnitt 1 genannte Kontaktadresse.
        </p>

        <h2>8. Beschwerderecht</h2>
        <p>
            Betroffene Personen haben das Recht, sich bei einer
            Datenschutzaufsichtsbehoerde zu beschweren. Zustraendig ist die
            Landesbeauftragte des Landes, in dem der Verantwortliche seinen Sitz
            hat (hier: Niedersachsen).
        </p>
    </main>
</body>
</html>
