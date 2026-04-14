<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require __DIR__ . '/theme.php';

enforceCanonicalRequest();
$userId = requireAuth();

$db = getDatabase();
$csrfToken = getCsrfToken();
$userPreferences = getExtendedUserPreferences($db, $userId);
$scriptName = $_SERVER['SCRIPT_NAME'] ?? '/index.php';
if (!is_string($scriptName) || $scriptName === '') {
    $scriptName = '/index.php';
}

$appBasePath = dirname(str_replace('\\', '/', $scriptName));
if ($appBasePath === '' || $appBasePath === '.') {
    $appBasePath = '/';
} else {
    $appBasePath = rtrim($appBasePath, '/') . '/';
}
$assetVersion = '2.0.19';

function icon(string $name): string {
    static $paths = [
        'menu'     => '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>',
        'search'   => '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
        'settings' => '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
        'theme-auto' => '<path d="M4 12a8 8 0 0 1 8-8v8Z"/><path d="M20 12a8 8 0 0 1-8 8v-8Z"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M2 12h2"/><path d="M20 12h2"/>',
        'theme-light' => '<path d="M12 3v2"/><path d="M12 19v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66-1.41-1.41"/><path d="M3 12h2"/><path d="M19 12h2"/><path d="m4.93 19.07 1.41-1.41"/><path d="m17.66 6.34-1.41 1.41"/><circle cx="12" cy="12" r="4"/>',
        'theme-dark' => '<path d="M12 3a6 6 0 1 0 9 9 7.5 7.5 0 1 1-9-9Z"/>',
        'eye'      => '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
        'pencil'   => '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
        'camera'   => '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
        'scan'     => '<path d="M4 7V5a1 1 0 0 1 1-1h2"/><path d="M20 7V5a1 1 0 0 0-1-1h-2"/><path d="M4 17v2a1 1 0 0 0 1 1h2"/><path d="M20 17v2a1 1 0 0 1-1 1h-2"/><path d="M7 12h10"/><path d="M8 9v6"/><path d="M11 9v6"/><path d="M14 9v6"/><path d="M16 9v6"/>',
        'scan-info' => '<path d="M4 7V5a1 1 0 0 1 1-1h2"/><path d="M20 7V5a1 1 0 0 0-1-1h-2"/><path d="M4 17v2a1 1 0 0 0 1 1h2"/><path d="M20 17v2a1 1 0 0 1-1 1h-2"/><path d="M7 12h6"/><path d="M8 9v6"/><path d="M11 9v6"/><circle cx="18" cy="12" r="3"/><path d="M18 10.8h.01"/><path d="M18 12.2v1.4"/>',
        'x'        => '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
        'plus'     => '<path d="M5 12h14"/><path d="M12 5v14"/>',
        'link'     => '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
        'arrow-left' => '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    ];
    $p = $paths[$name] ?? '';
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' . $p . '</svg>';
}
?>
<?php
$effectiveTheme = resolveEffectiveTheme($userPreferences);
$themeColor = getThemeColor($effectiveTheme);
$brandMarkSrc = 'icon.php?size=96&theme=' . rawurlencode($effectiveTheme) . '&v=' . rawurlencode($assetVersion);
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="<?= htmlspecialchars($themeColor, ENT_QUOTES, 'UTF-8') ?>">
    <?= renderThemeBootScript($userPreferences) ?>
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="apple-mobile-web-app-title" content="Ankerkladde">
    <meta name="app-base-path" content="<?= htmlspecialchars($appBasePath, ENT_QUOTES, 'UTF-8') ?>">
    <meta name="csrf-token" content="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
    <link rel="manifest" href="manifest.php?v=<?= urlencode($assetVersion) ?>">
    <link rel="stylesheet" href="style.css?v=<?= urlencode($assetVersion) ?>">
    <title>Ankerkladde</title>
</head>
<body data-theme="<?= htmlspecialchars($effectiveTheme, ENT_QUOTES, 'UTF-8') ?>">
<div class="app" id="app" data-mode="einkaufen">

    <div class="install-banner" id="installBanner" hidden>
        <span class="install-text">App installieren?</span>
        <button type="button" id="installBtn" class="btn-install">Installieren</button>
        <button type="button" id="installDismiss" class="btn-install-dismiss" aria-label="Schließen">✕</button>
    </div>

    <div class="status-banner" id="networkStatus" hidden aria-live="polite"></div>

    <div class="update-banner" id="updateBanner" hidden>
        <span class="update-text">Neue Version verfügbar.</span>
        <button type="button" id="updateReloadBtn" class="btn-update-reload">Neu laden</button>
    </div>

    <header class="app-header liste-only">
        <button type="button" id="tabsToggleBtn" class="btn-tabs-toggle" aria-label="Symbolleiste ein-/ausblenden"><?= icon('menu') ?></button>
        <div class="app-title-group">
            <img src="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>" alt="" class="brand-mark brand-mark-app" aria-hidden="true">
            <div class="app-title-stack">
                <h1 class="app-title">Ankerkladde</h1>
                <div class="app-subtitle" id="titleListe">Listen</div>
                <div class="app-version" aria-label="Version <?= htmlspecialchars($assetVersion, ENT_QUOTES, 'UTF-8') ?>">v<?= htmlspecialchars($assetVersion, ENT_QUOTES, 'UTF-8') ?></div>
            </div>
        </div>
        <div class="header-actions">
            <a href="<?= htmlspecialchars(appPath('barcode.php'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn" aria-label="Produktinfos per Scan öffnen"><?= icon('scan-info') ?></a>
            <button type="button" id="searchBtn" class="header-icon-btn btn-search" aria-label="Suchen"><?= icon('search') ?></button>
            <a href="<?= htmlspecialchars(appPath('index.php?view=settings&tab=app'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn btn-settings" data-settings-tab="app" aria-label="Einstellungen"><?= icon('settings') ?></a>
            <button type="button" class="header-icon-btn btn-theme-mode" aria-label="Farbschema umschalten" title="Farbschema umschalten"><?= icon('theme-auto') ?></button>
            <button type="button" class="header-icon-btn btn-mode-toggle" data-nav="einkaufen" aria-label="Einkaufs-Modus starten"><?= icon('eye') ?></button>
        </div>
    </header>

    <div class="search-bar liste-only" id="searchBar" hidden>
        <input type="search" id="searchInput" class="search-input"
               placeholder="In allen Bereichen suchen…"
               autocomplete="off" enterkeyhint="search" maxlength="120">
        <button type="button" id="searchClose" class="btn-search-close" aria-label="Suche schließen"><?= icon('x') ?></button>
    </div>

    <header class="app-header shopping-only">
        <button type="button" class="btn-tabs-toggle" aria-label="Symbolleiste ein-/ausblenden"><?= icon('menu') ?></button>
        <div class="app-title-group">
            <img src="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>" alt="" class="brand-mark brand-mark-app" aria-hidden="true">
            <div class="app-title-stack">
                <h1 class="app-title">Ankerkladde</h1>
                <div class="app-subtitle" id="titleShopping">Einkaufen</div>
                <div class="app-version" aria-label="Version <?= htmlspecialchars($assetVersion, ENT_QUOTES, 'UTF-8') ?>">v<?= htmlspecialchars($assetVersion, ENT_QUOTES, 'UTF-8') ?></div>
            </div>
        </div>
        <div class="header-actions">
            <span class="progress" id="progress" aria-live="polite">0 / 0</span>
            <a href="<?= htmlspecialchars(appPath('barcode.php'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn" aria-label="Produktinfos per Scan öffnen"><?= icon('scan-info') ?></a>
            <button type="button" id="scanShoppingBtn" class="header-icon-btn btn-scan shopping-only" aria-label="Barcode scannen"><?= icon('scan') ?></button>
            <a href="<?= htmlspecialchars(appPath('index.php?view=settings&tab=app'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn btn-settings" data-settings-tab="app" aria-label="Einstellungen"><?= icon('settings') ?></a>
            <button type="button" class="header-icon-btn btn-theme-mode" aria-label="Farbschema umschalten" title="Farbschema umschalten"><?= icon('theme-auto') ?></button>
            <button type="button" class="header-icon-btn btn-mode-toggle" data-nav="liste" aria-label="Liste bearbeiten"><?= icon('pencil') ?></button>
        </div>
    </header>

    <section class="input-area liste-only" id="inputArea">
        <form id="itemForm" novalidate>
            <textarea id="itemInput" name="name"
                      placeholder="Artikel..." maxlength="120"
                      autocomplete="off" enterkeyhint="done" rows="3" required></textarea>
            <textarea id="linkDescriptionInput" name="content"
                      class="link-description-input" placeholder="Beschreibung optional"
                      autocomplete="off" enterkeyhint="done" rows="2" hidden></textarea>
            <div class="file-input-group" id="fileInputGroup" hidden>
                <label for="fileInput" class="file-picker-button" id="filePickerButton">Datei wählen</label>
                <input type="file" id="fileInput" name="attachment" hidden>
                <button type="button" id="cameraBtn" class="file-picker-button btn-camera" hidden aria-label="Foto aufnehmen"><?= icon('camera') ?></button>
                <input type="file" id="cameraInput" accept="image/*" capture="environment" hidden>
                <span class="file-picker-name" id="filePickerName">Keine Datei ausgewählt</span>
                <span class="disk-free-display" id="diskFreeDisplay" hidden></span>
            </div>
            <input type="text" id="quantityInput" name="quantity"
                   placeholder="Menge" maxlength="40" autocomplete="off" enterkeyhint="done">
            <button type="button" class="btn-add btn-scan-input" id="scanAddBtn" aria-label="Barcode scannen"><?= icon('scan') ?></button>
            <button type="submit" class="btn-add" aria-label="Artikel hinzufügen"><?= icon('plus') ?></button>
        </form>
        <p class="input-hint" id="inputHint" hidden></p>
        <div class="drop-zone" id="dropZone" hidden aria-hidden="true">
            <span class="drop-zone-label">Bild hierher ziehen oder aus Zwischenablage einfügen</span>
        </div>
    </section>

    <main class="list-area">
        <div class="list-swipe-stage" id="listSwipeStage">
            <ul id="list" aria-label="Ankerkladde"></ul>
            <button type="button" class="btn-clear liste-only"
                    id="clearDoneBtn" disabled>Erledigte löschen</button>
        </div>
        <div class="list-swipe-preview" id="listSwipePreview" aria-hidden="true" hidden>
            <div class="list-swipe-preview-header" id="listSwipePreviewHeader"></div>
            <ul class="list-swipe-preview-list" id="listSwipePreviewList"></ul>
        </div>
        <section class="settings-embed" id="settingsEmbed" hidden aria-label="Einstellungen">
            <iframe
                id="settingsFrame"
                class="settings-embed-frame"
                title="Einstellungen"
                loading="lazy"
                referrerpolicy="same-origin"
            ></iframe>
        </section>
    </main>

    <nav class="section-tabs" id="sectionTabs" aria-label="Bereich wählen"></nav>
    <div class="mehr-menu" id="mehrMenu" hidden></div>

    <div class="message" id="message" role="status" aria-live="polite"></div>

    <div class="upload-progress" id="uploadProgress" hidden>
        <div class="upload-progress-bar" id="uploadProgressBar"></div>
    </div>

    <div class="scanner-overlay" id="scannerOverlay" hidden>
        <div class="scanner-sheet" role="dialog" aria-modal="true" aria-labelledby="scannerTitle">
            <div class="scanner-header">
                <div>
                    <h2 class="scanner-title" id="scannerTitle">Barcode scannen</h2>
                    <p class="scanner-subtitle" id="scannerSubtitle">Kamera wird vorbereitet…</p>
                </div>
                <button type="button" id="scannerCloseBtn" class="header-icon-btn" aria-label="Scanner schließen"><?= icon('x') ?></button>
            </div>
            <div class="scanner-viewport">
                <video id="scannerVideo" class="scanner-video" autoplay playsinline muted></video>
                <div class="scanner-frame" aria-hidden="true"></div>
            </div>
            <div class="scanner-status" id="scannerStatus" aria-live="polite"></div>
            <form class="scanner-manual-form" id="scannerManualForm" novalidate>
                <input type="text" id="scannerManualInput" inputmode="numeric" autocomplete="off" placeholder="Barcode manuell eingeben" maxlength="64">
                <button type="submit" class="btn-add" aria-label="Barcode übernehmen"><?= icon('check') ?></button>
            </form>
        </div>
    </div>

    <div class="note-editor" id="noteEditor" hidden>
        <div class="note-editor-top">
            <button type="button" id="noteEditorBack" class="btn-note-back" aria-label="Zurück"><?= icon('arrow-left') ?></button>
            <input type="text" id="noteTitleInput" class="note-title-input"
                   placeholder="Titel..." maxlength="120" autocomplete="off">
            <span class="note-save-status" id="noteSaveStatus" aria-live="polite"></span>
        </div>
        <div class="note-toolbar" id="noteToolbar" role="toolbar" aria-label="Formatierung">
            <button type="button" data-cmd="heading" data-level="1" title="Überschrift 1">H1</button>
            <button type="button" data-cmd="heading" data-level="2" title="Überschrift 2">H2</button>
            <button type="button" data-cmd="heading" data-level="3" title="Überschrift 3">H3</button>
            <span class="toolbar-sep"></span>
            <button type="button" data-cmd="bold" title="Fett"><b>B</b></button>
            <button type="button" data-cmd="italic" title="Kursiv"><i>I</i></button>
            <button type="button" data-cmd="strike" title="Durchgestrichen"><s>S</s></button>
            <span class="toolbar-sep"></span>
            <button type="button" data-cmd="bulletList" title="Liste">≡</button>
            <button type="button" data-cmd="orderedList" title="Nummerierte Liste">1.</button>
            <span class="toolbar-sep"></span>
            <button type="button" data-cmd="blockquote" title="Zitat">❝</button>
            <button type="button" data-cmd="codeBlock" title="Code">&lt;/&gt;</button>
            <span class="toolbar-sep"></span>
            <button type="button" data-cmd="link" title="Link"><?= icon('link') ?></button>
            <span class="toolbar-sep"></span>
            <button type="button" data-cmd="undo" title="Rückgängig">↩</button>
            <button type="button" data-cmd="redo" title="Wiederholen">↪</button>
        </div>
        <div class="note-editor-body" id="noteEditorEl"></div>
    </div>

</div>

<script id="userPreferences" type="application/json"><?= json_encode($userPreferences, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>
<script src="https://unpkg.com/@zxing/browser@0.1.5"></script>
<script type="module" src="js/main.js?v=<?= urlencode($assetVersion) ?>"></script>
<script type="module">
import { Editor } from 'https://esm.sh/@tiptap/core@2';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2';
import Link from 'https://esm.sh/@tiptap/extension-link@2';
window.TipTap = { Editor, StarterKit, Link };
window.dispatchEvent(new Event('tiptap-ready'));
</script>
</body>
</html>
