export const appEl = document.getElementById('app');
export const listEl = document.getElementById('list');
export const listAreaEl = document.querySelector('.list-area');
export const listSwipeStageEl = document.getElementById('listSwipeStage');
export const listSwipePreviewEl = document.getElementById('listSwipePreview');
export const listSwipePreviewHeaderEl = document.getElementById('listSwipePreviewHeader');
export const listSwipePreviewListEl = document.getElementById('listSwipePreviewList');
export const itemForm = document.getElementById('itemForm');
export const itemInput = document.getElementById('itemInput');
export const linkDescriptionInput = document.getElementById('linkDescriptionInput');
export const quantityInput = document.getElementById('quantityInput');
export const scanAddBtn = document.getElementById('scanAddBtn');
export const scanShoppingBtn = document.getElementById('scanShoppingBtn');
export const fileInput = document.getElementById('fileInput');
export const fileInputGroup = document.getElementById('fileInputGroup');
export const uploadModeToggle = document.getElementById('uploadModeToggle');
export const uploadModeFileBtn = document.getElementById('uploadModeFile');
export const uploadModeUrlBtn = document.getElementById('uploadModeUrl');
export const filePickerArea = document.getElementById('filePickerArea');
export const filePickerButton = document.getElementById('filePickerButton');
export const filePickerName = document.getElementById('filePickerName');
export const urlImportArea = document.getElementById('urlImportArea');
export const urlImportInput = document.getElementById('urlImportInput');
export const cameraBtn = document.getElementById('cameraBtn');
export const cameraInput = document.getElementById('cameraInput');
export const dropZoneEl = document.getElementById('dropZone');
export const inputHintEl = document.getElementById('inputHint');
export const clearDoneBtn = document.getElementById('clearDoneBtn');
export const messageEl = document.getElementById('message');
export const uploadProgressEl = document.getElementById('uploadProgress');
export const uploadProgressBarEl = document.getElementById('uploadProgressBar');
export const progressEl = document.getElementById('progress');
export const searchBtn = document.getElementById('searchBtn');
export const searchBar = document.getElementById('searchBar');
export const searchInput = document.getElementById('searchInput');
export const searchClose = document.getElementById('searchClose');
export const magicBtns = document.querySelectorAll('.btn-magic');
export const productScannerLinks = document.querySelectorAll('[href$="barcode.php"]');
export const magicBar = document.getElementById('magicBar');
export const magicInput = document.getElementById('magicInput');
export const magicSubmit = document.getElementById('magicSubmit');
export const magicVoiceBtn = document.getElementById('magicVoiceBtn');
export const magicClose = document.getElementById('magicClose');
export const modeToggleBtns = document.querySelectorAll('.btn-mode-toggle');
export const settingsBtns = document.querySelectorAll('.btn-settings');
export const sectionTabsEl = document.getElementById('sectionTabs');
export const mehrMenuEl = document.getElementById('mehrMenu');
export const tabsToggleBtns = document.querySelectorAll('.btn-tabs-toggle');
export const networkStatusEl = document.getElementById('networkStatus');
export const updateBannerEl = document.getElementById('updateBanner');
export const diskFreeEl = document.getElementById('diskFreeDisplay');
export const noteEditorEl = document.getElementById('noteEditor');
export const noteEditorBack = document.getElementById('noteEditorBack');
export const noteTitleInput = document.getElementById('noteTitleInput');
export const noteSaveStatus = document.getElementById('noteSaveStatus');
export const noteEditorBody = document.getElementById('noteEditorEl');
export const noteToolbar = document.getElementById('noteToolbar');
export const todoEditorEl = document.getElementById('todoEditor');
export const todoEditorBack = document.getElementById('todoEditorBack');
export const todoTitleInput = document.getElementById('todoTitleInput');
export const todoDateInput = document.getElementById('todoDateInput');
export const todoNoteInput = document.getElementById('todoNoteInput');
export const todoStatusSelector = document.getElementById('todoStatusSelector');
export const scannerOverlay = document.getElementById('scannerOverlay');
export const scannerCloseBtn = document.getElementById('scannerCloseBtn');
export const scannerVideo = document.getElementById('scannerVideo');
export const scannerSubtitle = document.getElementById('scannerSubtitle');
export const scannerStatus = document.getElementById('scannerStatus');
export const scannerManualForm = document.getElementById('scannerManualForm');
export const scannerManualInput = document.getElementById('scannerManualInput');
export const userPreferencesScript = document.getElementById('userPreferences');
export const brandMarkEls = document.querySelectorAll('.brand-mark');
export const settingsEmbedEl = document.getElementById('settingsEmbed');
export const settingsFrameEl = document.getElementById('settingsFrame');

export function svgIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');
    svg.innerHTML = `<use href="#icon-${name}"></use>`;
    return svg;
}

export function updateViewportHeight() {
    const viewportHeight = (window.visualViewport?.height || window.innerHeight || 0)
        + (window.visualViewport?.offsetTop || 0);
    if (viewportHeight > 0) {
        document.documentElement.style.setProperty('--app-height', `${Math.round(viewportHeight)}px`);
    }
}
