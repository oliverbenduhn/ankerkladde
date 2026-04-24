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

const ICONS = {
    menu: '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    'theme-auto': '<path d="M4 12a8 8 0 0 1 8-8v8Z"/><path d="M20 12a8 8 0 0 1-8 8v-8Z"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M2 12h2"/><path d="M20 12h2"/>',
    'theme-light': '<path d="M12 3v2"/><path d="M12 19v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66-1.41-1.41"/><path d="M3 12h2"/><path d="M19 12h2"/><path d="m4.93 19.07 1.41-1.41"/><path d="m17.66 6.34-1.41 1.41"/><circle cx="12" cy="12" r="4"/>',
    'theme-dark': '<path d="M12 3a6 6 0 1 0 9 9 7.5 7.5 0 1 1-9-9Z"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    scan: '<path d="M4 7V5a1 1 0 0 1 1-1h2"/><path d="M20 7V5a1 1 0 0 0-1-1h-2"/><path d="M4 17v2a1 1 0 0 0 1 1h2"/><path d="M20 17v2a1 1 0 0 1-1 1h-2"/><path d="M7 12h10"/><path d="M8 9v6"/><path d="M11 9v6"/><path d="M14 9v6"/><path d="M16 9v6"/>',
    'scan-info': '<path d="M4 7V5a1 1 0 0 1 1-1h2"/><path d="M20 7V5a1 1 0 0 0-1-1h-2"/><path d="M4 17v2a1 1 0 0 0 1 1h2"/><path d="M20 17v2a1 1 0 0 1-1 1h-2"/><path d="M7 12h6"/><path d="M8 9v6"/><path d="M11 9v6"/><circle cx="18" cy="12" r="3"/><path d="M18 10.8h.01"/><path d="M18 12.2v1.4"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    'panel-bottom': '<g fill="none"><path d="M6.25 3A3.25 3.25 0 0 0 3 6.25v11.5A3.25 3.25 0 0 0 6.25 21h11.5A3.25 3.25 0 0 0 21 17.75V6.25A3.25 3.25 0 0 0 17.75 3H6.25zM4.5 6.25c0-.966.784-1.75 1.75-1.75h11.5c.966 0 1.75.784 1.75 1.75v11.5a1.75 1.75 0 0 1-1.75 1.75H14.5v-1.75a2.25 2.25 0 0 0-2.25-2.25H4.5V6.25zM4.5 17h7.75a.75.75 0 0 1 .75.75v1.75H6.25a1.75 1.75 0 0 1-1.75-1.75V17z" fill="currentColor" /></g>',
    sparkles: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/><line x1="8" x2="16" y1="22" y2="22"/>',
    pin: '<line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.69l-1.78.9A2 2 0 0 0 5 15.24Z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    'more-horizontal': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
};

export function svgIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');
    svg.innerHTML = ICONS[name] || '';
    return svg;
}

export function updateViewportHeight() {
    const viewportHeight = (window.visualViewport?.height || window.innerHeight || 0)
        + (window.visualViewport?.offsetTop || 0);
    if (viewportHeight > 0) {
        document.documentElement.style.setProperty('--app-height', `${Math.round(viewportHeight)}px`);
    }
}
