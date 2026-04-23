<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require __DIR__ . '/theme.php';

enforceCanonicalRequest();
sendHtmlPageSecurityHeaders(allowEsmSh: true); // TipTap is loaded from esm.sh
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
$assetVersion = require __DIR__ . '/version.php';

function icon(string $name): string {
    static $paths = [
        'menu'     => '<path d="M4 6h16M4 12h16M4 18h16"/>',
        'search'   => '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
        'settings' => '<path d="M3 7h18M3 17h18"/><circle cx="8" cy="7" r="2.5"/><circle cx="16" cy="17" r="2.5"/>',
        'theme-auto' => '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 3v18"/><path d="M12 21a9 9 0 0 0 0-18z" fill="currentColor" fill-opacity="0.1"/>',
        'theme-light' => '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"/>',
        'theme-dark' => '<path d="M12 3a6 6 0 1 0 9 9 7.5 7.5 0 1 1-9-9Z"/>',
        'eye'      => '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
        'pencil'   => '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
        'camera'   => '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
        'scan'     => '<path d="M4 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M20 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8 8v8M12 8v8M16 8v8"/>',
        'scan-info' => '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="11" cy="11" r="5"/><path d="m20 20-4-4"/>',
        'x'        => '<path d="M18 6 6 18M6 6l12 12"/>',
        'plus'     => '<path d="M5 12h14M12 5v14"/>',
        'link'     => '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
        'arrow-left' => '<path d="m12 19-7-7 7-7M19 12H5"/>',
        'panel-bottom' => '<path d="M3 14h18M3 18h18"/><path d="M7 14v4M12 14v4M17 14v4"/><path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4H3V6z"/>',
        'sparkles' => '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',
        'mic' => '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/><line x1="8" x2="16" y1="22" y2="22"/>',
    ];
    $p = $paths[$name] ?? '';
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' . $p . '</svg>';
}
?>
<?php
$effectiveTheme = resolveEffectiveTheme($userPreferences);
$themeColor = getThemeColor($effectiveTheme);
$brandMarkSrc = 'icon.php?size=96&theme=' . rawurlencode($effectiveTheme) . '&v=' . rawurlencode($assetVersion);
$productScannerEnabled = !array_key_exists('product_scanner_enabled', $userPreferences) || !empty($userPreferences['product_scanner_enabled']);
$shoppingListScannerEnabled = !array_key_exists('shopping_list_scanner_enabled', $userPreferences) || !empty($userPreferences['shopping_list_scanner_enabled']);
$magicButtonEnabled = !array_key_exists('magic_button_enabled', $userPreferences) || !empty($userPreferences['magic_button_enabled']);
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
    <meta name="user-id" content="<?= htmlspecialchars((string)$userId, ENT_QUOTES, 'UTF-8') ?>">
    <link rel="manifest" href="manifest.php?v=<?= urlencode($assetVersion) ?>">
    <link rel="icon" type="image/png" href="icon.php?size=96&v=<?= urlencode($assetVersion) ?>">
    <link rel="apple-touch-icon" href="icon.php?size=180&v=<?= urlencode($assetVersion) ?>">
    <link rel="stylesheet" href="theme-css.php">
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
        <div class="app-title-group clickable-brand" style="cursor: pointer;">
            <img src="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>" alt="" class="brand-mark brand-mark-app" aria-hidden="true">
            <div class="app-title-stack">
                <h1 class="app-title">Ankerkladde</h1>
                <div class="app-subtitle" id="titleListe">Listen</div>
            </div>
        </div>
        <div class="header-actions">
            <button type="button" id="tabsToggleBtn" class="header-icon-btn btn-tabs-toggle" aria-label="Kategorienleiste ein-/ausblenden"><?= icon('panel-bottom') ?></button>
            <a href="<?= htmlspecialchars(appPath('barcode.php'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn" aria-label="Produktinfos per Scan öffnen"<?= !$productScannerEnabled ? ' hidden' : '' ?>><?= icon('scan-info') ?></a>
            <button type="button" id="searchBtn" class="header-icon-btn btn-search" aria-label="Suchen"><?= icon('search') ?></button>
            <button type="button" id="magicBtn" class="header-icon-btn btn-magic" aria-label="KI-Assistent"<?= !$magicButtonEnabled ? ' hidden' : '' ?>><?= icon('sparkles') ?></button>
            <a href="<?= htmlspecialchars(appPath('index.php?view=settings'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn btn-settings" data-settings-tab="app" aria-label="Einstellungen"><?= icon('settings') ?></a>
            <button type="button" class="header-icon-btn btn-mode-toggle" data-nav="einkaufen" aria-label="Einkaufs-Modus starten"><?= icon('eye') ?></button>
        </div>
    </header>

    <div class="search-bar liste-only" id="searchBar" hidden>
        <input type="search" id="searchInput" class="search-input"
               placeholder="In allen Bereichen suchen…" aria-label="In allen Bereichen suchen"
               autocomplete="off" enterkeyhint="search" maxlength="120">
    </div>

    <div class="magic-bar" id="magicBar" hidden>
        <div class="magic-bar-inner">
            <button type="button" id="magicVoiceBtn" class="btn-magic-voice" aria-label="Spracheingabe"><?= icon('mic') ?></button>
            <input type="text" id="magicInput" class="magic-input"
                   placeholder="KI-Befehl (z.B. 'Zutaten für Lasagne')" aria-label="KI-Befehl"
                   autocomplete="off" enterkeyhint="go">
            <button type="button" id="magicSubmit" class="btn-magic-submit" aria-label="KI ausführen"><?= icon('sparkles') ?></button>
        </div>
        <button type="button" id="magicClose" class="btn-search-close" aria-label="Schließen"><?= icon('x') ?></button>
    </div>

    <header class="app-header shopping-only">
        <div class="app-title-group clickable-brand" style="cursor: pointer;">
            <img src="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>" alt="" class="brand-mark brand-mark-app" aria-hidden="true">
            <div class="app-title-stack">
                <h1 class="app-title">Ankerkladde</h1>
                <div class="app-subtitle" id="titleShopping">Einkaufen</div>
            </div>
        </div>
        <div class="header-actions">
            <span class="progress" id="progress" aria-live="polite">0 / 0</span>
            <button type="button" class="header-icon-btn btn-tabs-toggle" aria-label="Kategorienleiste ein-/ausblenden"><?= icon('panel-bottom') ?></button>
            <a href="<?= htmlspecialchars(appPath('barcode.php'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn" aria-label="Produktinfos per Scan öffnen"<?= !$productScannerEnabled ? ' hidden' : '' ?>><?= icon('scan-info') ?></a>
            <button type="button" id="scanShoppingBtn" class="header-icon-btn btn-scan shopping-only" aria-label="Barcode scannen"<?= !$shoppingListScannerEnabled ? ' hidden' : '' ?>><?= icon('scan') ?></button>
            <button type="button" class="header-icon-btn btn-magic" id="magicBtnShopping" aria-label="KI-Assistent"<?= !$magicButtonEnabled ? ' hidden' : '' ?>><?= icon('sparkles') ?></button>
            <a href="<?= htmlspecialchars(appPath('index.php?view=settings'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn btn-settings" data-settings-tab="app" aria-label="Einstellungen"><?= icon('settings') ?></a>
            <button type="button" class="header-icon-btn btn-mode-toggle" data-nav="liste" aria-label="Liste bearbeiten"><?= icon('pencil') ?></button>
        </div>
    </header>

    <section class="input-area liste-only" id="inputArea">
        <form id="itemForm" novalidate>
            <textarea id="itemInput" name="name"
                      placeholder="Artikel..." aria-label="Artikel" maxlength="120"
                      autocomplete="off" enterkeyhint="done" rows="3" required></textarea>
            <textarea id="linkDescriptionInput" name="content"
                      class="link-description-input" placeholder="Beschreibung optional" aria-label="Beschreibung"
                      autocomplete="off" enterkeyhint="done" rows="2" hidden></textarea>
            <div class="file-input-group" id="fileInputGroup" hidden>
                <div class="upload-mode-toggle" id="uploadModeToggle" hidden>
                    <button type="button" class="upload-mode-btn is-active" id="uploadModeFile" aria-pressed="true">Datei wählen</button>
                    <button type="button" class="upload-mode-btn" id="uploadModeUrl" aria-pressed="false">Von URL laden</button>
                </div>
                <div class="file-picker-area" id="filePickerArea">
                    <label for="fileInput" class="file-picker-button" id="filePickerButton">Datei wählen</label>
                    <input type="file" id="fileInput" name="attachment" hidden>
                    <button type="button" id="cameraBtn" class="file-picker-button btn-camera" hidden aria-label="Foto aufnehmen"><?= icon('camera') ?></button>
                    <input type="file" id="cameraInput" accept="image/*" capture="environment" hidden>
                    <span class="file-picker-name" id="filePickerName">Keine Datei ausgewählt</span>
                </div>
                <div class="url-import-area" id="urlImportArea" hidden>
                    <input type="url" id="urlImportInput" placeholder="https://example.com/datei.pdf"
                           inputmode="url" autocomplete="off" autocorrect="off"
                           class="url-import-input" aria-label="Datei-URL">
                </div>
                <span class="disk-free-display" id="diskFreeDisplay" hidden></span>
            </div>
            <input type="text" id="quantityInput" name="quantity"
                   placeholder="Menge" aria-label="Menge" maxlength="40" autocomplete="off" enterkeyhint="done">
            <button type="button" class="btn-add btn-scan-input" id="scanAddBtn" aria-label="Barcode scannen"<?= !$shoppingListScannerEnabled ? ' hidden' : '' ?>><?= icon('scan') ?></button>
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

    <?php if ($shoppingListScannerEnabled): ?>
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
                <input type="text" id="scannerManualInput" inputmode="numeric" autocomplete="off" placeholder="Barcode manuell eingeben" aria-label="Barcode manuell eingeben" maxlength="64">
                <button type="submit" class="btn-add" aria-label="Barcode übernehmen"><?= icon('check') ?></button>
            </form>
        </div>
    </div>
    <?php endif; ?>

    <div class="note-editor" id="noteEditor" hidden>
        <div class="note-editor-top">
            <button type="button" id="noteEditorBack" class="btn-note-back" aria-label="Zurück"><?= icon('arrow-left') ?></button>
            <input type="text" id="noteTitleInput" class="note-title-input"
                   placeholder="Titel..." aria-label="Notiz Titel" maxlength="120" autocomplete="off">
            <span class="note-save-status" id="noteSaveStatus" aria-live="polite"></span>
        </div>
        <div class="note-toolbar" id="noteToolbar" role="toolbar" aria-label="Formatierung">
            <button type="button" data-cmd="heading" data-level="1" title="Überschrift 1" aria-label="Überschrift 1">H1</button>
            <button type="button" data-cmd="heading" data-level="2" title="Überschrift 2" aria-label="Überschrift 2">H2</button>
            <button type="button" data-cmd="heading" data-level="3" title="Überschrift 3" aria-label="Überschrift 3">H3</button>
            <span class="toolbar-sep" aria-hidden="true"></span>
            <button type="button" data-cmd="bold" title="Fett" aria-label="Fett"><b aria-hidden="true">B</b></button>
            <button type="button" data-cmd="italic" title="Kursiv" aria-label="Kursiv"><i aria-hidden="true">I</i></button>
            <button type="button" data-cmd="strike" title="Durchgestrichen" aria-label="Durchgestrichen"><s aria-hidden="true">S</s></button>
            <span class="toolbar-sep" aria-hidden="true"></span>
            <button type="button" data-cmd="bulletList" title="Liste" aria-label="Liste">≡</button>
            <button type="button" data-cmd="orderedList" title="Nummerierte Liste" aria-label="Nummerierte Liste">1.</button>
            <span class="toolbar-sep" aria-hidden="true"></span>
            <button type="button" data-cmd="blockquote" title="Zitat" aria-label="Zitat">❝</button>
            <button type="button" data-cmd="codeBlock" title="Code" aria-label="Code-Block">&lt;/&gt;</button>
            <span class="toolbar-sep" aria-hidden="true"></span>
            <button type="button" data-cmd="link" title="Link" aria-label="Link einfügen"><?= icon('link') ?></button>
            <span class="toolbar-sep" aria-hidden="true"></span>
            <button type="button" data-cmd="undo" title="Rückgängig" aria-label="Rückgängig">↩</button>
            <button type="button" data-cmd="redo" title="Wiederholen" aria-label="Wiederholen">↪</button>
        </div>
        <div class="note-editor-body" id="noteEditorEl"></div>
    </div>

    <div class="todo-editor" id="todoEditor" hidden>
        <div class="todo-editor-top">
            <button type="button" id="todoEditorBack" class="btn-note-back" aria-label="Zurück"><?= icon('arrow-left') ?></button>
            <input type="text" id="todoTitleInput" class="note-title-input" placeholder="Aufgabe..." aria-label="Aufgabentitel" maxlength="120" autocomplete="off">
        </div>
        <div class="todo-editor-body" id="todoEditorBody">
            <div class="todo-editor-section">
                <label class="todo-editor-label" for="todoDateInput">Fälligkeitsdatum</label>
                <input type="date" id="todoDateInput" class="todo-editor-date-input">
            </div>
            <div class="todo-editor-section">
                <span class="todo-editor-label">Status</span>
                <div class="todo-status-selector" id="todoStatusSelector" role="group" aria-label="Status">
                    <button type="button" class="todo-status-btn" data-status="">Offen</button>
                    <button type="button" class="todo-status-btn" data-status="in_progress">In Arbeit</button>
                    <button type="button" class="todo-status-btn" data-status="waiting">Wartet</button>
                </div>
            </div>
            <div class="todo-editor-section todo-editor-section--note">
                <label class="todo-editor-label" for="todoNoteInput">Notiz</label>
                <textarea id="todoNoteInput" class="todo-note-input" placeholder="Notizen zur Aufgabe..." maxlength="8000"></textarea>
            </div>
        </div>
    </div>

</div>

<script id="userPreferences" type="application/json"><?= json_encode($userPreferences, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>
<script src="<?= htmlspecialchars(appPath('vendor/zxing/browser-0.1.5.js?v=' . $assetVersion), ENT_QUOTES, 'UTF-8') ?>"></script>
<script type="module" src="js/main.js?v=<?= urlencode($assetVersion) ?>"></script>
<script>
(() => {
    const appEl = document.getElementById('app');
    const magicBtn = document.getElementById('magicBtn');
    const magicBar = document.getElementById('magicBar');
    const magicInput = document.getElementById('magicInput');
    const magicSubmit = document.getElementById('magicSubmit');
    const magicVoiceBtn = document.getElementById('magicVoiceBtn');
    const magicClose = document.getElementById('magicClose');
    const messageEl = document.getElementById('message');
    const searchBar = document.getElementById('searchBar');
    const searchInput = document.getElementById('searchInput');
    const aiUrl = <?= json_encode(appPath('ai.php'), JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>;
    const localPrefsStorageKey = 'ankerkladde_local_prefs';

    let recognition = null;

    if (!appEl || !magicBtn || !magicBar || !magicInput || !magicSubmit || !magicClose || !messageEl) {
        return;
    }

    const setMessage = (text, isError = false) => {
        messageEl.textContent = text;
        messageEl.classList.toggle('is-error', isError);
        messageEl.classList.add('is-visible');
        window.clearTimeout(window.__ankerkladdeMagicMessageTimer);
        window.__ankerkladdeMagicMessageTimer = window.setTimeout(() => {
            messageEl.classList.remove('is-visible');
        }, 2500);
    };

    const closeSearchIfOpen = () => {
        if (!searchBar) return;
        searchBar.hidden = true;
        appEl.classList.remove('is-searching');
        if (searchInput) searchInput.value = '';
    };

    const openMagic = () => {
        closeSearchIfOpen();
        magicBar.hidden = false;
        appEl.classList.add('is-magic-active');
        magicBtn.classList.add('is-active');
        magicInput.focus();
    };

    const closeMagic = () => {
        magicBar.hidden = true;
        appEl.classList.remove('is-magic-active');
        magicBtn.classList.remove('is-active');
        magicBar.classList.remove('is-loading');
        magicInput.value = '';
        if (recognition) {
            recognition.stop();
        }
    };

    const startVoiceRecognition = event => {
        event.preventDefault();
        event.stopImmediatePropagation();

        if (magicBar.hidden) {
            openMagic();
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setMessage('Spracherkennung wird von diesem Browser nicht unterstützt.', true);
            return;
        }

        if (recognition) {
            recognition.stop();
            return;
        }

        recognition = new SpeechRecognition();
        recognition.lang = 'de-DE';
        recognition.interimResults = true;

        recognition.onstart = () => {
            if (magicVoiceBtn) {
                magicVoiceBtn.classList.add('is-listening');
            }
            magicInput.placeholder = 'Höre zu...';
        };

        recognition.onresult = voiceEvent => {
            const transcript = Array.from(voiceEvent.results)
                .map(result => result[0])
                .map(result => result.transcript)
                .join('');
            magicInput.value = transcript;

            const lastResult = voiceEvent.results[voiceEvent.results.length - 1];
            if (lastResult?.isFinal) {
                recognition.stop();
                void submitMagic(new Event('submit'));
            }
        };

        recognition.onerror = voiceErrorEvent => {
            if (magicVoiceBtn) {
                magicVoiceBtn.classList.remove('is-listening');
            }
            magicInput.placeholder = "KI-Befehl (z.B. 'Zutaten für Lasagne')";
            if (voiceErrorEvent.error !== 'no-speech') {
                setMessage('Sprachfehler: ' + voiceErrorEvent.error, true);
            }
            recognition = null;
        };

        recognition.onend = () => {
            if (magicVoiceBtn) {
                magicVoiceBtn.classList.remove('is-listening');
            }
            magicInput.placeholder = "KI-Befehl (z.B. 'Zutaten für Lasagne')";
            recognition = null;
        };

        recognition.start();
    };

    const toggleMagic = event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (magicBar.hidden) {
            openMagic();
        } else {
            closeMagic();
        }
    };

    const submitMagic = async event => {
        event.preventDefault();
        event.stopImmediatePropagation();

        const input = magicInput.value.trim();
        if (!input) {
            setMessage('Bitte zuerst etwas eingeben.', true);
            magicInput.focus();
            return;
        }

        magicBar.classList.add('is-loading');
        setMessage('Magie wird gewirkt...');

        try {
            const response = await fetch(aiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input }),
            });
            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(payload.error || 'KI-Anfrage fehlgeschlagen');
            }

            setMessage(payload.toast_message || payload.message || 'Erledigt!');
            const targetCategoryId = Number(payload.target_category_id);
            if (Number.isInteger(targetCategoryId) && targetCategoryId > 0) {
                try {
                    const currentPrefs = JSON.parse(window.localStorage.getItem(localPrefsStorageKey) || '{}');
                    window.localStorage.setItem(localPrefsStorageKey, JSON.stringify({
                        ...currentPrefs,
                        last_category_id: targetCategoryId,
                    }));
                } catch {}
            }
            window.setTimeout(() => window.location.reload(), 350);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'KI-Anfrage fehlgeschlagen', true);
            magicBar.classList.remove('is-loading');
        }
    };

    magicBtn.addEventListener('click', toggleMagic, true);
    magicClose.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeMagic();
    }, true);
    magicVoiceBtn?.addEventListener('click', startVoiceRecognition, true);
    magicSubmit.addEventListener('click', submitMagic, true);
    magicInput.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
            void submitMagic(event);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeMagic();
        }
    }, true);
})();
</script>
<script type="module">
import { Editor } from 'https://esm.sh/@tiptap/core@2';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2';
import Link from 'https://esm.sh/@tiptap/extension-link@2';
import * as Y from 'https://esm.sh/yjs@13';
import { WebsocketProvider } from 'https://esm.sh/y-websocket@1.5';
import Collaboration from 'https://esm.sh/@tiptap/extension-collaboration@2';
import CollaborationCursor from 'https://esm.sh/@tiptap/extension-collaboration-cursor@2';

window.TipTap = { Editor, StarterKit, Link, Y, WebsocketProvider, Collaboration, CollaborationCursor };
window.dispatchEvent(new Event('tiptap-ready'));
</script>
</body>
</html>
