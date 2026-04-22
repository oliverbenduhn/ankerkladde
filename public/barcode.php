<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require __DIR__ . '/theme.php';

enforceCanonicalRequest();
sendHtmlPageSecurityHeaders();
$userId = requireAuth();
$db = getDatabase();
$csrfToken = getCsrfToken();
$userPreferences = getExtendedUserPreferences($db, $userId);
$effectiveTheme = resolveEffectiveTheme($userPreferences);
$assetVersion = require __DIR__ . '/version.php';
$brandMarkSrc = appPath('icon.php?size=96&theme=' . rawurlencode($effectiveTheme) . '&v=' . rawurlencode($assetVersion));

function icon(string $name): string {
    static $paths = [
        'arrow-left' => '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
        'scan'     => '<path d="M4 7V5a1 1 0 0 1 1-1h2"/><path d="M20 7V5a1 1 0 0 0-1-1h-2"/><path d="M4 17v2a1 1 0 0 0 1 1h2"/><path d="M20 17v2a1 1 0 0 1-1 1h-2"/><path d="M7 12h10"/><path d="M8 9v6"/><path d="M11 9v6"/><path d="M14 9v6"/><path d="M16 9v6"/>',
    ];
    $p = $paths[$name] ?? '';
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' . $p . '</svg>';
}
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="csrf-token" content="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
    <meta name="app-base-path" content="<?= htmlspecialchars(appPath(), ENT_QUOTES, 'UTF-8') ?>">
    <?= renderThemeBootScript($userPreferences) ?>
    <link rel="icon" type="image/png" href="<?= htmlspecialchars(appPath('icons/favicon.png'), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="apple-touch-icon" href="<?= htmlspecialchars(appPath('icons/icon-180.png'), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('theme-css.php'), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('style.css?v=' . $assetVersion), ENT_QUOTES, 'UTF-8') ?>">
    <title>Ankerkladde - Produktscanner</title>
</head>
<body data-theme="<?= htmlspecialchars($effectiveTheme, ENT_QUOTES, 'UTF-8') ?>">
<div class="app barcode-page-app" id="barcodePage">
    <header class="app-header barcode-page-header">
        <a href="<?= htmlspecialchars(appPath('index.php'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn" aria-label="Zurück zur App"><?= icon('arrow-left') ?></a>
        <div class="app-title-group">
            <img src="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>" alt="" class="brand-mark brand-mark-app" aria-hidden="true">
            <div class="app-title-stack">
                <h1 class="app-title">Produktscanner</h1>
                <div class="app-subtitle">Lokale Open-Facts-Datenbank</div>
            </div>
        </div>
    </header>

    <main class="barcode-page-main">
        <section class="barcode-hero">
            <div class="scanner-sheet barcode-inline-scanner">
                <div class="scanner-header">
                    <div>
                        <h2 class="scanner-title">Barcode scannen</h2>
                        <p class="scanner-subtitle" id="barcodePageSubtitle">Kamera starten oder Barcode manuell eingeben.</p>
                    </div>
                    <button type="button" id="barcodePageCameraToggleBtn" class="header-icon-btn" aria-label="Kamera einschalten"><?= icon('scan') ?></button>
                </div>
                <div class="scanner-viewport">
                    <video id="barcodePageVideo" class="scanner-video" autoplay playsinline muted></video>
                    <div class="scanner-frame" aria-hidden="true"></div>
                </div>
                <div class="scanner-status" id="barcodePageStatus" aria-live="polite"></div>
                <form class="scanner-manual-form" id="barcodePageManualForm" novalidate>
                    <input type="text" id="barcodePageManualInput" inputmode="numeric" autocomplete="off" placeholder="Barcode manuell eingeben" aria-label="Barcode manuell eingeben" maxlength="64">
                    <button type="submit" class="btn-add" aria-label="Barcode laden"><?= icon('scan') ?></button>
                </form>
            </div>
        </section>

        <section class="barcode-result" id="barcodeResult">
            <div class="barcode-empty-state" id="barcodeEmptyState">
                Noch kein Barcode geladen. Nach dem Scan werden hier alle verfügbaren lokalen Produktdaten angezeigt.
            </div>
        </section>
    </main>
</div>
<script src="<?= htmlspecialchars(appPath('vendor/zxing/browser-0.1.5.js?v=' . $assetVersion), ENT_QUOTES, 'UTF-8') ?>"></script>
<script src="<?= htmlspecialchars(appPath('barcode-page.js?v=' . $assetVersion), ENT_QUOTES, 'UTF-8') ?>"></script>
</body>
</html>
