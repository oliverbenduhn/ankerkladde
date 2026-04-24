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
        'arrow-left' => '<g fill="none"><path d="M10.733 19.79a.75.75 0 0 0 1.034-1.086L5.516 12.75H20.25a.75.75 0 0 0 0-1.5H5.516l6.251-5.955a.75.75 0 0 0-1.034-1.086l-7.42 7.067a.995.995 0 0 0-.3.58a.754.754 0 0 0 .001.289a.995.995 0 0 0 .3.579l7.419 7.067z" fill="currentColor" /></g>',
        'scan' => '<g fill="none"><path d="M3 6.25A3.25 3.25 0 0 1 6.25 3h2a.75.75 0 0 1 0 1.5h-2A1.75 1.75 0 0 0 4.5 6.25v2a.75.75 0 0 1-1.5 0v-2zm12-2.5a.75.75 0 0 1 .75-.75h2A3.25 3.25 0 0 1 21 6.25v2a.75.75 0 0 1-1.5 0v-2a1.75 1.75 0 0 0-1.75-1.75h-2a.75.75 0 0 1-.75-.75zM3.75 15a.75.75 0 0 1 .75.75v2c0 .966.784 1.75 1.75 1.75h2a.75.75 0 0 1 0 1.5h-2A3.25 3.25 0 0 1 3 17.75v-2a.75.75 0 0 1 .75-.75zm16.5 0a.75.75 0 0 1 .75.75v2A3.25 3.25 0 0 1 17.75 21h-2a.75.75 0 0 1 0-1.5h2a1.75 1.75 0 0 0 1.75-1.75v-2a.75.75 0 0 1 .75-.75zM12 13a1 1 0 1 0 0-2a1 1 0 0 0 0 2zm-1.152-6c-.473 0-.906.263-1.118.678L9.242 9h-.575C7.747 9 7 9.596 7 10.5v3.864C7 15.267 7.746 16 8.667 16h6.666c.92 0 1.667-.733 1.667-1.636V10.5c0-.904-.746-1.5-1.667-1.5h-.575l-.488-1.322A1.253 1.253 0 0 0 13.152 7h-2.304zM12 14a2 2 0 1 1 0-4a2 2 0 0 1 0 4z" fill="currentColor" /></g>',
    ];
    $p = $paths[$name] ?? '';
    return '<svg class="icon icon-filled" viewBox="0 0 24 24" aria-hidden="true">' . $p . '</svg>';
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
    <link rel="icon" type="image/png" href="<?= htmlspecialchars(appPath('icon.php?size=96&v=' . rawurlencode($assetVersion)), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="apple-touch-icon" href="<?= htmlspecialchars(appPath('icon.php?size=180&v=' . rawurlencode($assetVersion)), ENT_QUOTES, 'UTF-8') ?>">
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
