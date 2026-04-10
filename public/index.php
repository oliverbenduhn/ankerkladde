<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';

enforceCanonicalRequest();
$userId = requireAuth();

$csrfToken = getCsrfToken();
$userPreferences = getUserPreferences(getDatabase(), $userId);
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
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#f5f0eb">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="apple-mobile-web-app-title" content="Zettel">
    <meta name="app-base-path" content="<?= htmlspecialchars($appBasePath, ENT_QUOTES, 'UTF-8') ?>">
    <meta name="csrf-token" content="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
    <link rel="manifest" href="manifest.php">
    <link rel="stylesheet" href="style.css">
    <title>Zettel</title>
</head>
<body>
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
        <button type="button" id="tabsToggleBtn" class="btn-tabs-toggle" aria-label="Symbolleiste ein-/ausblenden">☰</button>
        <h1 class="app-title" id="titleListe">Einkaufsliste</h1>
        <div class="header-actions">
            <button type="button" id="searchBtn" class="header-icon-btn btn-search" aria-label="Suchen">🔍</button>
            <a href="<?= htmlspecialchars(appPath('settings.php'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn btn-settings" aria-label="Einstellungen">⚙️</a>
            <button type="button" class="header-icon-btn btn-mode-toggle" data-nav="einkaufen" aria-label="Einkaufs-Modus starten">👁️</button>
        </div>
    </header>

    <div class="search-bar liste-only" id="searchBar" hidden>
        <input type="search" id="searchInput" class="search-input"
               placeholder="In allen Bereichen suchen…"
               autocomplete="off" enterkeyhint="search" maxlength="120">
        <button type="button" id="searchClose" class="btn-search-close" aria-label="Suche schließen">✕</button>
    </div>

    <header class="app-header shopping-only">
        <button type="button" class="btn-tabs-toggle" aria-label="Symbolleiste ein-/ausblenden">☰</button>
        <h1 class="app-title" id="titleShopping">Einkaufen</h1>
        <div class="header-actions">
            <span class="progress" id="progress" aria-live="polite">0 / 0</span>
            <a href="<?= htmlspecialchars(appPath('settings.php'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn btn-settings" aria-label="Einstellungen">⚙️</a>
            <button type="button" class="header-icon-btn btn-mode-toggle" data-nav="liste" aria-label="Liste bearbeiten">✏️</button>
        </div>
    </header>

    <section class="input-area liste-only" id="inputArea">
        <form id="itemForm" novalidate>
            <input type="text" id="itemInput" name="name"
                   placeholder="Artikel..." maxlength="120"
                   autocomplete="off" enterkeyhint="done" required>
            <div class="file-input-group" id="fileInputGroup" hidden>
                <label for="fileInput" class="file-picker-button" id="filePickerButton">Datei wählen</label>
                <input type="file" id="fileInput" name="attachment" hidden>
                <button type="button" id="cameraBtn" class="file-picker-button btn-camera" hidden aria-label="Foto aufnehmen">📷</button>
                <input type="file" id="cameraInput" accept="image/*" capture="environment" hidden>
                <span class="file-picker-name" id="filePickerName">Keine Datei ausgewählt</span>
                <span class="disk-free-display" id="diskFreeDisplay" hidden></span>
            </div>
            <input type="text" id="quantityInput" name="quantity"
                   placeholder="Menge" maxlength="40" autocomplete="off" enterkeyhint="done">
            <button type="submit" class="btn-add" aria-label="Artikel hinzufügen">+</button>
        </form>
        <p class="input-hint" id="inputHint" hidden></p>
        <div class="drop-zone" id="dropZone" hidden aria-hidden="true">
            <span class="drop-zone-label">Bild hierher ziehen oder aus Zwischenablage einfügen</span>
        </div>
    </section>

    <main class="list-area">
        <div class="list-swipe-stage" id="listSwipeStage">
            <ul id="list" aria-label="Einkaufsliste"></ul>
            <button type="button" class="btn-clear liste-only"
                    id="clearDoneBtn" disabled>Erledigte löschen</button>
        </div>
        <div class="list-swipe-preview" id="listSwipePreview" aria-hidden="true" hidden>
            <div class="list-swipe-preview-header" id="listSwipePreviewHeader"></div>
            <ul class="list-swipe-preview-list" id="listSwipePreviewList"></ul>
        </div>
    </main>

    <nav class="section-tabs" id="sectionTabs" aria-label="Bereich wählen"></nav>
    <div class="mehr-menu" id="mehrMenu" hidden></div>

    <div class="message" id="message" role="status" aria-live="polite"></div>

    <div class="upload-progress" id="uploadProgress" hidden>
        <div class="upload-progress-bar" id="uploadProgressBar"></div>
    </div>

    <div class="note-editor" id="noteEditor" hidden>
        <div class="note-editor-top">
            <button type="button" id="noteEditorBack" class="btn-note-back" aria-label="Zurück">←</button>
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
            <button type="button" data-cmd="link" title="Link">🔗</button>
            <span class="toolbar-sep"></span>
            <button type="button" data-cmd="undo" title="Rückgängig">↩</button>
            <button type="button" data-cmd="redo" title="Wiederholen">↪</button>
        </div>
        <div class="note-editor-body" id="noteEditorEl"></div>
    </div>

</div>

<script id="userPreferences" type="application/json"><?= json_encode($userPreferences, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>
<script src="app.js"></script>
<script type="module">
import { Editor } from 'https://esm.sh/@tiptap/core@2';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2';
import Link from 'https://esm.sh/@tiptap/extension-link@2';
window.TipTap = { Editor, StarterKit, Link };
window.dispatchEvent(new Event('tiptap-ready'));
</script>
</body>
</html>
