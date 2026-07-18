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
    $href = appPath('ui-sprite.php?v=' . rawurlencode((string) $assetVersion)) . '#icon-' . $name;

    $safeHref = htmlspecialchars($href, ENT_QUOTES, 'UTF-8');

    return '<svg class="icon icon-filled" viewBox="0 0 24 24" aria-hidden="true" xmlns:xlink="http://www.w3.org/1999/xlink"><use href="' . $safeHref . '" xlink:href="' . $safeHref . '"></use></svg>';
}
?>
<?php
$effectiveTheme = resolveEffectiveTheme($userPreferences);
$themeColor = getThemeColor($effectiveTheme);
$brandMarkSrc = 'icon.php?size=96&theme=' . rawurlencode($effectiveTheme) . '&v=' . rawurlencode($assetVersion);
$productScannerEnabled = !array_key_exists('product_scanner_enabled', $userPreferences) || !empty($userPreferences['product_scanner_enabled']);
$shoppingListScannerEnabled = !array_key_exists('shopping_list_scanner_enabled', $userPreferences) || !empty($userPreferences['shopping_list_scanner_enabled']);
$magicButtonEnabled = !array_key_exists('magic_button_enabled', $userPreferences) || !empty($userPreferences['magic_button_enabled']);
$initialMode = ($userPreferences['mode'] ?? 'edit') === 'view' ? 'view' : 'edit';
// Migration: handle old mode values
if (($userPreferences['mode'] ?? '') === 'einkaufen') $initialMode = 'view';
if (($userPreferences['mode'] ?? '') === 'liste') $initialMode = 'edit';
$validLayouts = ['list', 'grid', 'kanban'];
$rawLayout = $userPreferences['layout'] ?? $userPreferences['desktop_layout'] ?? 'list';
if ($rawLayout === 'liste') $rawLayout = 'list';
$initialLayout = in_array($rawLayout, $validLayouts, true) ? $rawLayout : 'list';
$clientWebSocketUrl = getenv('ANKERKLADDE_WS_CLIENT_URL');
$clientWebSocketUrl = is_string($clientWebSocketUrl) ? trim($clientWebSocketUrl) : '';
?>
<!DOCTYPE html>
<html lang="<?= htmlspecialchars(getCurrentLanguage(), ENT_QUOTES, 'UTF-8') ?>">
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
    <meta name="app-language" content="<?= htmlspecialchars(getCurrentLanguage(), ENT_QUOTES, 'UTF-8') ?>">
    <script>window.__i18n = <?= json_encode(getAllStrings(), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG) ?>;window.__lang = <?= json_encode(getCurrentLanguage()) ?>;</script>
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
<div class="app" id="app" data-mode="<?= htmlspecialchars($initialMode, ENT_QUOTES, 'UTF-8') ?>" data-layout="<?= htmlspecialchars($initialLayout, ENT_QUOTES, 'UTF-8') ?>">

    <div class="install-banner" id="installBanner" hidden>
        <span class="install-text"><?= t('ui.install_prompt') ?></span>
        <button type="button" id="installBtn" class="btn-install"><?= t('ui.install') ?></button>
        <button type="button" id="installDismiss" class="btn-install-dismiss" aria-label="<?= t('ui.close') ?>">✕</button>
    </div>

    <div class="status-banner" id="networkStatus" hidden aria-live="polite"></div>

    <div class="update-banner" id="updateBanner" hidden>
        <span class="update-text"><?= t('ui.update_available') ?></span>
        <button type="button" id="updateReloadBtn" class="btn-update-reload"><?= t('ui.reload') ?></button>
    </div>

    <header class="app-header" id="appHeader">
        <div class="app-title-group clickable-brand">
            <img src="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>" alt="" class="brand-mark brand-mark-app" aria-hidden="true">
            <div class="app-title-stack">
                <h1 class="app-title">Ankerkladde</h1>
                <div class="app-subtitle" id="categoryTitle"></div>
            </div>
            <button type="button" id="modeChip" class="mode-chip" aria-label="<?= t('ui.toggle_mode') ?>">
                <span class="mode-chip-label" id="modeChipLabel"></span>
            </button>
        </div>
        <div class="header-actions">
            <button type="button" id="conflictAlertBtn" class="header-icon-btn btn-conflict-alert" aria-label="<?= t('ui.show_conflicts') ?>" hidden><?= icon('alert-triangle') ?></button>
            <span class="progress view-only" id="progress" aria-live="polite">0 / 0</span>
            <button type="button" id="layoutToggleBtn" class="header-icon-btn btn-layout-toggle" aria-label="<?= t('ui.toggle_layout') ?>"><?= icon('menu') ?></button>
            <button type="button" id="tabsToggleBtn" class="header-icon-btn btn-tabs-toggle" aria-label="<?= t('ui.toggle_tabs') ?>"><?= icon('panel-bottom') ?></button>
            <a href="<?= htmlspecialchars(appPath('barcode.php'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn btn-product-scanner" aria-label="<?= t('ui.scan_product') ?>"<?= !$productScannerEnabled ? ' hidden' : '' ?>><?= icon('scan-info') ?></a>
            <button type="button" id="scanShoppingBtn" class="header-icon-btn btn-scan" aria-label="<?= t('ui.scan_barcode') ?>"<?= !$shoppingListScannerEnabled ? ' hidden' : '' ?>><?= icon('scan') ?></button>
            <button type="button" id="searchBtn" class="header-icon-btn btn-search" aria-label="<?= t('ui.search') ?>"><?= icon('search') ?></button>
            <button type="button" id="journalBtn" class="header-icon-btn btn-journal" aria-label="<?= t('ui.open_journal') ?>"><?= icon('calendar') ?></button>
            <button type="button" id="magicBtn" class="header-icon-btn btn-magic" aria-label="<?= t('ui.ai_assistant') ?>"<?= !$magicButtonEnabled ? ' hidden' : '' ?>><?= icon('sparkles') ?></button>
            <a href="<?= htmlspecialchars(appPath('index.php?view=settings'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn btn-settings" data-settings-tab="app" aria-label="<?= t('ui.settings') ?>"><?= icon('settings') ?></a>
        </div>
    </header>

    <div class="search-bar" id="searchBar" hidden>
        <input type="search" id="searchInput" class="search-input"
               placeholder="<?= t('ui.search_all') ?>" aria-label="<?= t('ui.search_all') ?>"
               autocomplete="off" enterkeyhint="search" maxlength="120">
    </div>

    <div class="magic-bar" id="magicBar" hidden>
        <div class="magic-bar-inner">
            <button type="button" id="magicVoiceBtn" class="btn-magic-voice" aria-label="<?= t('ui.voice_input') ?>"><?= icon('mic') ?></button>
            <input type="text" id="magicInput" class="magic-input"
                   placeholder="<?= t('ui.magic_placeholder') ?>" aria-label="<?= t('ui.magic_placeholder') ?>"
                   autocomplete="off" enterkeyhint="go">
            <button type="button" id="magicSubmit" class="btn-magic-submit" aria-label="<?= t('ui.magic_submit') ?>"><?= icon('sparkles') ?></button>
        </div>
        <button type="button" id="magicClose" class="btn-search-close" aria-label="<?= t('ui.close') ?>"><?= icon('x') ?></button>
    </div>

    <section class="input-area edit-only" id="inputArea">
        <form id="itemForm" novalidate>
            <textarea id="itemInput" name="name"
                      placeholder="<?= t('item.input_placeholder') ?>" aria-label="<?= t('item.input_placeholder') ?>" maxlength="120"
                      autocomplete="off" enterkeyhint="done" rows="3" required></textarea>
            <textarea id="linkDescriptionInput" name="content"
                      class="link-description-input" placeholder="<?= t('item.link_description') ?>" aria-label="<?= t('item.link_description') ?>"
                      autocomplete="off" enterkeyhint="done" rows="2" hidden></textarea>
            <div class="file-input-group" id="fileInputGroup" hidden>
                <div class="upload-mode-toggle" id="uploadModeToggle" hidden>
                    <button type="button" class="upload-mode-btn is-active" id="uploadModeFile" aria-pressed="true"><?= t('item.upload_file') ?></button>
                    <button type="button" class="upload-mode-btn" id="uploadModeUrl" aria-pressed="false"><?= t('item.upload_url') ?></button>
                </div>
                <div class="file-picker-area" id="filePickerArea">
                    <label for="fileInput" class="file-picker-button" id="filePickerButton"><?= t('item.choose_file') ?></label>
                    <input type="file" id="fileInput" name="attachment" hidden>
                    <button type="button" id="cameraBtn" class="file-picker-button btn-camera" hidden aria-label="<?= t('item.take_photo') ?>"><?= icon('camera') ?></button>
                    <input type="file" id="cameraInput" accept="image/*" capture="environment" hidden>
                    <span class="file-picker-name" id="filePickerName"><?= t('item.no_file_selected') ?></span>
                </div>
                <div class="url-import-area" id="urlImportArea" hidden>
                    <input type="url" id="urlImportInput" placeholder="<?= t('item.url_placeholder') ?>"
                           inputmode="url" autocomplete="off" autocorrect="off"
                           class="url-import-input" aria-label="<?= t('item.url_label') ?>">
                </div>
                <span class="disk-free-display" id="diskFreeDisplay" hidden></span>
            </div>
            <input type="text" id="quantityInput" name="quantity"
                   placeholder="<?= t('item.quantity') ?>" aria-label="<?= t('item.quantity') ?>" maxlength="40" autocomplete="off" enterkeyhint="done">
            <button type="button" class="btn-add btn-scan-input" id="scanAddBtn" aria-label="<?= t('ui.scan_barcode') ?>"<?= !$shoppingListScannerEnabled ? ' hidden' : '' ?>><?= icon('scan') ?></button>
            <button type="submit" class="btn-add" id="itemSubmitBtn" aria-label="<?= t('item.add') ?>"><?= icon('plus') ?></button>
        </form>
        <div class="quick-add-feedback" id="quickAddFeedback" role="alert" hidden>
            <span id="quickAddFeedbackText"></span>
            <button type="button" id="quickAddAiBtn" hidden>Mit AI klären</button>
        </div>
        <p class="input-hint" id="inputHint" hidden></p>
        <div class="drop-zone" id="dropZone" hidden aria-hidden="true">
            <span class="drop-zone-label"><?= t('item.drop_image') ?></span>
        </div>
    </section>

    <main class="list-area">
        <div class="list-swipe-stage" id="listSwipeStage">
            <ul id="list" aria-label="<?= t('item.list_label') ?>"></ul>
            <button type="button" class="btn-clear edit-only"
                    id="clearDoneBtn" disabled><?= t('item.clear_done') ?></button>
        </div>
        <div class="list-swipe-preview" id="listSwipePreview" aria-hidden="true" hidden>
            <div class="list-swipe-preview-header" id="listSwipePreviewHeader"></div>
            <ul class="list-swipe-preview-list" id="listSwipePreviewList"></ul>
        </div>
        <section class="journal-view parchment-view" id="journalView" aria-labelledby="journalDateHeading" hidden>
            <div class="journal-navigation">
                <button type="button" id="journalDatePickerBtn" class="journal-nav-icon-btn" aria-label="<?= t('journal.choose_date') ?>"><?= icon('calendar') ?></button>
                <div class="journal-segments" role="group" aria-label="<?= t('journal.navigation') ?>">
                    <button type="button" id="journalPreviousBtn" class="journal-nav-btn" aria-pressed="false"><?= t('journal.previous') ?></button>
                    <button type="button" id="journalTodayBtn" class="journal-nav-btn" aria-pressed="false"><?= t('journal.today') ?></button>
                    <button type="button" id="journalNextBtn" class="journal-nav-btn" aria-pressed="false"><?= t('journal.next') ?></button>
                </div>
                <a href="<?= htmlspecialchars(appPath('index.php?view=settings'), ENT_QUOTES, 'UTF-8') ?>" class="journal-nav-icon-btn btn-settings" data-settings-tab="app" aria-label="<?= t('ui.settings') ?>"><?= icon('settings') ?></a>
                <label class="journal-date-picker-label" for="journalDatePicker"><?= t('journal.choose_date') ?></label>
                <input type="date" id="journalDatePicker" class="journal-date-picker" aria-label="<?= t('journal.choose_date') ?>">
            </div>
            <h2 id="journalDateHeading" class="journal-date-heading"></h2>
            <section class="parchment-card journal-agenda-card" aria-labelledby="journalAgendaTitle">
                <header class="journal-card-header">
                    <h3 id="journalAgendaTitle" class="journal-card-title"><?= t('journal.agenda') ?></h3>
                    <button type="button" id="agendaAddBtn" class="journal-card-icon-btn" aria-label="<?= t('item.add') ?>"><?= icon('plus') ?></button>
                </header>
                <div class="journal-agenda-columns">
                    <section class="journal-agenda-column" aria-labelledby="journalAnytimeTitle">
                        <h4 id="journalAnytimeTitle"><?= t('journal.without_time') ?></h4>
                        <ul id="journalAnytimeList"></ul>
                    </section>
                    <section class="journal-agenda-column" aria-labelledby="journalScheduledTitle">
                        <h4 id="journalScheduledTitle"><?= t('today.section.scheduled') ?></h4>
                        <ul id="journalScheduledList"></ul>
                    </section>
                </div>
            </section>
            <section class="parchment-card journal-note-card" aria-labelledby="journalNoteTitle">
                <header class="journal-card-header">
                    <h3 id="journalNoteTitle" class="journal-card-title"><?= t('journal.note_title') ?></h3>
                    <div class="journal-card-actions">
                        <span class="note-save-status journal-save-status" id="journalSaveStatus" aria-live="polite"></span>
                        <button type="button" id="journalSketchOpenBtn" class="journal-card-icon-btn" aria-label="<?= t('journal.sketch.add') ?>"><?= icon('pencil') ?></button>
                        <button type="button" id="journalFormatBtn" class="journal-format-btn" aria-controls="journalToolbar" aria-expanded="false"><?= t('journal.format') ?></button>
                    </div>
                </header>
                <div class="note-toolbar journal-toolbar" id="journalToolbar" role="toolbar" aria-label="<?= t('editor.formatting') ?>" hidden>
                    <button type="button" data-cmd="heading" data-level="1" title="<?= t('editor.toolbar.h1') ?>" aria-label="<?= t('editor.toolbar.h1') ?>">H1</button>
                    <button type="button" data-cmd="heading" data-level="2" title="<?= t('editor.toolbar.h2') ?>" aria-label="<?= t('editor.toolbar.h2') ?>">H2</button>
                    <button type="button" data-cmd="bold" title="<?= t('editor.toolbar.bold') ?>" aria-label="<?= t('editor.toolbar.bold') ?>"><b aria-hidden="true">B</b></button>
                    <button type="button" data-cmd="italic" title="<?= t('editor.toolbar.italic') ?>" aria-label="<?= t('editor.toolbar.italic') ?>"><i aria-hidden="true">I</i></button>
                    <button type="button" data-cmd="strike" title="<?= t('editor.toolbar.strike') ?>" aria-label="<?= t('editor.toolbar.strike') ?>"><s aria-hidden="true">S</s></button>
                    <button type="button" data-cmd="bulletList" title="<?= t('editor.toolbar.bullet_list') ?>" aria-label="<?= t('editor.toolbar.bullet_list') ?>">≡</button>
                    <button type="button" data-cmd="orderedList" title="<?= t('editor.toolbar.ordered_list') ?>" aria-label="<?= t('editor.toolbar.ordered_list') ?>">1.</button>
                    <button type="button" data-cmd="blockquote" title="<?= t('editor.toolbar.blockquote') ?>" aria-label="<?= t('editor.toolbar.blockquote') ?>">❝</button>
                    <button type="button" data-cmd="codeBlock" title="<?= t('editor.toolbar.code') ?>" aria-label="<?= t('editor.toolbar.code') ?>">&lt;/&gt;</button>
                    <button type="button" data-cmd="link" title="<?= t('editor.toolbar.link') ?>" aria-label="<?= t('editor.toolbar.link') ?>"><?= icon('link') ?></button>
                    <button type="button" data-cmd="undo" title="<?= t('editor.toolbar.undo') ?>" aria-label="<?= t('editor.toolbar.undo') ?>">↩</button>
                    <button type="button" data-cmd="redo" title="<?= t('editor.toolbar.redo') ?>" aria-label="<?= t('editor.toolbar.redo') ?>">↪</button>
                </div>
                <div class="journal-editor-body note-editor-body" id="journalEditorBody"></div>
            </section>
            <section class="parchment-card journal-sketch-card" id="journalSketchCard" aria-labelledby="journalSketchTitle" hidden>
                <header class="journal-card-header journal-sketch-summary">
                    <h3 id="journalSketchTitle" class="journal-card-title"><?= t('journal.sketch.title') ?></h3>
                    <span class="journal-sketch-status" id="journalSketchStatus" aria-live="polite"></span>
                </header>
                <div class="journal-sketch-body">
                    <button type="button" id="journalSketchPreviewBtn" class="journal-sketch-open-btn"><?= t('journal.sketch.open') ?></button>
                </div>
            </section>
        </section>
        <section class="settings-embed" id="settingsEmbed" hidden aria-label="<?= t('ui.settings') ?>">
            <iframe
                id="settingsFrame"
                class="settings-embed-frame"
                title="<?= t('ui.settings') ?>"
                loading="lazy"
                referrerpolicy="same-origin"
            ></iframe>
        </section>
    </main>

    <nav class="section-tabs" id="sectionTabs" aria-label="<?= t('ui.select_category') ?>"></nav>

    <div class="message" id="message" role="status" aria-live="polite"></div>

    <div class="upload-progress" id="uploadProgress" hidden>
        <div class="upload-progress-bar" id="uploadProgressBar"></div>
    </div>

    <div class="conflict-overlay" id="conflictOverlay" hidden>
        <div class="conflict-sheet" role="dialog" aria-modal="true" aria-labelledby="conflictTitle">
            <div class="conflict-header">
                <div>
                    <h2 class="conflict-title" id="conflictTitle"><?= t('conflict.title') ?></h2>
                    <p class="conflict-subtitle"><?= t('conflict.subtitle') ?></p>
                </div>
                <button type="button" id="conflictCloseBtn" class="header-icon-btn" aria-label="<?= t('ui.close') ?>"><?= icon('x') ?></button>
            </div>
            <div class="conflict-list-container" id="conflictListContainer"></div>
            <div class="conflict-actions" id="conflictGlobalActions" hidden>
                <button type="button" id="conflictClearAllBtn" class="btn-clear" style="width:100%; border-radius: var(--radius);"><?= t('conflict.discard_all') ?></button>
            </div>
        </div>
    </div>

    <?php if ($shoppingListScannerEnabled): ?>
    <div class="scanner-overlay" id="scannerOverlay" hidden>
        <div class="scanner-sheet" role="dialog" aria-modal="true" aria-labelledby="scannerTitle">
            <div class="scanner-header">
                <div>
                    <h2 class="scanner-title" id="scannerTitle"><?= t('scanner.title') ?></h2>
                    <p class="scanner-subtitle" id="scannerSubtitle"><?= t('scanner.preparing') ?></p>
                </div>
                <button type="button" id="scannerCloseBtn" class="header-icon-btn" aria-label="<?= t('scanner.close') ?>"><?= icon('x') ?></button>
            </div>
            <div class="scanner-viewport">
                <video id="scannerVideo" class="scanner-video" autoplay playsinline muted></video>
                <div class="scanner-frame" aria-hidden="true"></div>
            </div>
            <div class="scanner-status" id="scannerStatus" aria-live="polite"></div>
            <form class="scanner-manual-form" id="scannerManualForm" novalidate>
                <input type="text" id="scannerManualInput" inputmode="numeric" autocomplete="off" placeholder="<?= t('scanner.manual_input') ?>" aria-label="<?= t('scanner.manual_input') ?>" maxlength="64">
                <button type="submit" class="btn-add" aria-label="<?= t('scanner.submit') ?>"><?= icon('check') ?></button>
            </form>
        </div>
    </div>
    <?php endif; ?>

    <div class="note-editor" id="noteEditor" hidden>
        <div class="note-editor-top">
            <button type="button" id="noteEditorBack" class="btn-note-back" aria-label="<?= t('editor.back') ?>"><?= icon('arrow-left') ?></button>
            <input type="text" id="noteTitleInput" class="note-title-input"
                   placeholder="<?= t('editor.title_placeholder') ?>" aria-label="<?= t('editor.title_placeholder') ?>" maxlength="120" autocomplete="off">
            <span class="note-save-status" id="noteSaveStatus" aria-live="polite"></span>
        </div>
        <div class="note-toolbar" id="noteToolbar" role="toolbar" aria-label="<?= t('editor.formatting') ?>">
            <button type="button" data-cmd="heading" data-level="1" title="<?= t('editor.toolbar.h1') ?>" aria-label="<?= t('editor.toolbar.h1') ?>">H1</button>
            <button type="button" data-cmd="heading" data-level="2" title="<?= t('editor.toolbar.h2') ?>" aria-label="<?= t('editor.toolbar.h2') ?>">H2</button>
            <button type="button" data-cmd="heading" data-level="3" title="<?= t('editor.toolbar.h3') ?>" aria-label="<?= t('editor.toolbar.h3') ?>">H3</button>
            <span class="toolbar-sep" aria-hidden="true"></span>
            <button type="button" data-cmd="bold" title="<?= t('editor.toolbar.bold') ?>" aria-label="<?= t('editor.toolbar.bold') ?>"><b aria-hidden="true">B</b></button>
            <button type="button" data-cmd="italic" title="<?= t('editor.toolbar.italic') ?>" aria-label="<?= t('editor.toolbar.italic') ?>"><i aria-hidden="true">I</i></button>
            <button type="button" data-cmd="strike" title="<?= t('editor.toolbar.strike') ?>" aria-label="<?= t('editor.toolbar.strike') ?>"><s aria-hidden="true">S</s></button>
            <span class="toolbar-sep" aria-hidden="true"></span>
            <button type="button" data-cmd="bulletList" title="<?= t('editor.toolbar.bullet_list') ?>" aria-label="<?= t('editor.toolbar.bullet_list') ?>">≡</button>
            <button type="button" data-cmd="orderedList" title="<?= t('editor.toolbar.ordered_list') ?>" aria-label="<?= t('editor.toolbar.ordered_list') ?>">1.</button>
            <span class="toolbar-sep" aria-hidden="true"></span>
            <button type="button" data-cmd="blockquote" title="<?= t('editor.toolbar.blockquote') ?>" aria-label="<?= t('editor.toolbar.blockquote') ?>">❝</button>
            <button type="button" data-cmd="codeBlock" title="<?= t('editor.toolbar.code') ?>" aria-label="<?= t('editor.toolbar.code') ?>">&lt;/&gt;</button>
            <span class="toolbar-sep" aria-hidden="true"></span>
            <button type="button" data-cmd="link" title="<?= t('editor.toolbar.link') ?>" aria-label="<?= t('editor.toolbar.link') ?>"><?= icon('link') ?></button>
            <span class="toolbar-sep" aria-hidden="true"></span>
            <button type="button" data-cmd="undo" title="<?= t('editor.toolbar.undo') ?>" aria-label="<?= t('editor.toolbar.undo') ?>">↩</button>
            <button type="button" data-cmd="redo" title="<?= t('editor.toolbar.redo') ?>" aria-label="<?= t('editor.toolbar.redo') ?>">↪</button>
        </div>
        <div class="note-editor-body" id="noteEditorEl"></div>
    </div>

    <div class="todo-editor" id="todoEditor" hidden>
        <div class="todo-editor-top">
            <button type="button" id="todoEditorBack" class="btn-note-back" aria-label="<?= t('todo.back') ?>"><?= icon('arrow-left') ?></button>
            <input type="text" id="todoTitleInput" class="note-title-input" placeholder="<?= t('todo.title_placeholder') ?>" aria-label="<?= t('todo.title_placeholder') ?>" maxlength="120" autocomplete="off">
        </div>
        <div class="todo-editor-body" id="todoEditorBody">
            <div class="todo-editor-section">
                <div class="todo-due-fields">
                    <label class="todo-due-field" for="todoDateInput">
                        <span class="todo-editor-label"><?= t('todo.due_date') ?></span>
                        <input type="date" id="todoDateInput" class="todo-editor-date-input">
                    </label>
                    <label class="todo-due-field" for="todoTimeInput">
                        <span class="todo-editor-label"><?= t('todo.due_time') ?></span>
                        <input type="time" id="todoTimeInput" class="todo-editor-date-input" step="60">
                    </label>
                </div>
            </div>
            <div class="todo-editor-section">
                <span class="todo-editor-label"><?= t('todo.status') ?></span>
                <div class="todo-status-selector" id="todoStatusSelector" role="group" aria-label="<?= t('todo.status') ?>">
                    <button type="button" class="todo-status-btn" data-status=""><?= t('todo.status_open') ?></button>
                    <button type="button" class="todo-status-btn" data-status="in_progress"><?= t('todo.status_in_progress') ?></button>
                    <button type="button" class="todo-status-btn" data-status="waiting"><?= t('todo.status_waiting') ?></button>
                    <button type="button" class="todo-status-btn" id="todoDoneBtn"><?= t('todo.status_done') ?></button>
                </div>
            </div>
            <div class="todo-editor-section">
                <label class="todo-editor-label" for="todoPriorityInput"><?= t('todo.priority') ?></label>
                <select id="todoPriorityInput" class="todo-editor-date-input">
                    <option value=""><?= t('todo.priority_none') ?></option>
                    <option value="1">!1 – <?= t('todo.priority_high') ?></option>
                    <option value="2">!2 – <?= t('todo.priority_medium') ?></option>
                    <option value="3">!3 – <?= t('todo.priority_low') ?></option>
                </select>
            </div>
            <div class="todo-editor-section todo-editor-section--note">
                <label class="todo-editor-label" for="todoNoteInput"><?= t('todo.notes_placeholder') ?></label>
                <textarea id="todoNoteInput" class="todo-note-input" placeholder="<?= t('todo.notes_placeholder') ?>" maxlength="8000"></textarea>
            </div>
        </div>
    </div>

</div>

<script id="userPreferences" type="application/json"><?= json_encode($userPreferences, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>
<script src="<?= htmlspecialchars(appPath('vendor/zxing/browser-0.1.5.js?v=' . $assetVersion), ENT_QUOTES, 'UTF-8') ?>"></script>
<script type="module" src="js/main.js?v=<?= urlencode($assetVersion) ?>"></script>
<script type="module" src="js/tiptap-init.js?v=<?= urlencode($assetVersion) ?>"></script>
<nav class="legal-footer" aria-label="Rechtliche Hinweise">
  <a href="<?= htmlspecialchars(appPath('legal/impressum.php'), ENT_QUOTES, 'UTF-8') ?>">Impressum</a>
  <span aria-hidden="true">·</span>
  <a href="<?= htmlspecialchars(appPath('legal/datenschutz.php'), ENT_QUOTES, 'UTF-8') ?>">Datenschutz</a>
</nav>
</body>
</html>
