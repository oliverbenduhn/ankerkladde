<?php
declare(strict_types=1);

ini_set('default_charset', 'UTF-8');

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
    if (!preg_match('/^[a-z0-9-]+$/', $name)) {
        return '';
    }

    global $assetVersion;
    $href = appPath('icons/ui-sprite.svg?v=' . rawurlencode((string) $assetVersion)) . '#icon-' . $name;

    return '<svg class="icon icon-filled" viewBox="0 0 24 24" aria-hidden="true"><use href="' . htmlspecialchars($href, ENT_QUOTES, 'UTF-8') . '"></use></svg>';
}
?>
<?php
$effectiveTheme = resolveEffectiveTheme($userPreferences);
$themeColor = getThemeColor($effectiveTheme);
$brandMarkSrc = 'icon.php?size=96&theme=' . rawurlencode($effectiveTheme) . '&v=' . rawurlencode($assetVersion);
$productScannerEnabled = !array_key_exists('product_scanner_enabled', $userPreferences) || !empty($userPreferences['product_scanner_enabled']);
$shoppingListScannerEnabled = !array_key_exists('shopping_list_scanner_enabled', $userPreferences) || !empty($userPreferences['shopping_list_scanner_enabled']);
$magicButtonEnabled = !array_key_exists('magic_button_enabled', $userPreferences) || !empty($userPreferences['magic_button_enabled']);
$initialMode = ($userPreferences['mode'] ?? 'liste') === 'einkaufen' ? 'einkaufen' : 'liste';
$validDesktopLayouts = ['liste', 'grid', 'kanban'];
$rawDesktopLayout = $userPreferences['desktop_layout'] ?? 'liste';
$initialDesktopLayout = in_array($rawDesktopLayout, $validDesktopLayouts, true) ? $rawDesktopLayout : 'liste';
$clientWebSocketUrl = getenv('ANKERKLADDE_WS_CLIENT_URL');
$clientWebSocketUrl = is_string($clientWebSocketUrl) ? trim($clientWebSocketUrl) : '';
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
    <?php if ($clientWebSocketUrl !== ''): ?>
    <meta name="websocket-url" content="<?= htmlspecialchars($clientWebSocketUrl, ENT_QUOTES, 'UTF-8') ?>">
    <?php endif; ?>
    <link rel="manifest" href="manifest.php?v=<?= urlencode($assetVersion) ?>">
    <link rel="icon" type="image/png" href="icon.php?size=96&v=<?= urlencode($assetVersion) ?>">
    <link rel="apple-touch-icon" href="icon.php?size=180&v=<?= urlencode($assetVersion) ?>">
    <link rel="stylesheet" href="theme-css.php">
    <link rel="stylesheet" href="style.css?v=<?= urlencode($assetVersion) ?>">
    <title>Ankerkladde</title>
</head>
<body data-theme="<?= htmlspecialchars($effectiveTheme, ENT_QUOTES, 'UTF-8') ?>">
<div class="app" id="app" data-mode="<?= htmlspecialchars($initialMode, ENT_QUOTES, 'UTF-8') ?>" data-desktop-layout="<?= htmlspecialchars($initialDesktopLayout, ENT_QUOTES, 'UTF-8') ?>">

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
        <div class="app-title-group clickable-brand">
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
            <div class="desktop-layout-switcher" id="desktopLayoutSwitcher" aria-label="Desktop-Ansicht">
                <button type="button" class="header-icon-btn btn-desktop-layout" data-layout="liste" aria-label="Listenansicht" aria-pressed="<?= $initialDesktopLayout === 'liste' ? 'true' : 'false' ?>"><?= icon('menu') ?></button>
                <button type="button" class="header-icon-btn btn-desktop-layout" data-layout="grid" aria-label="Kästchenansicht" aria-pressed="<?= $initialDesktopLayout === 'grid' ? 'true' : 'false' ?>"><?= icon('layout-grid') ?></button>
                <button type="button" class="header-icon-btn btn-desktop-layout" data-layout="kanban" aria-label="Kanban-Ansicht" aria-pressed="<?= $initialDesktopLayout === 'kanban' ? 'true' : 'false' ?>"><?= icon('layout-kanban') ?></button>
            </div>
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
        <div class="app-title-group clickable-brand">
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
<script type="module" src="js/tiptap-init.js?v=<?= urlencode($assetVersion) ?>"></script>
</body>
</html>
