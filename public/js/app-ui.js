import { getCurrentCategory, getCurrentType, getTypeConfig, isAttachmentCategory, state } from './state.js?v=4.2.94';
import {
    cameraBtn,
    diskFreeEl,
    dropZoneEl,
    fileInput,
    fileInputGroup,
    filePickerArea,
    filePickerButton,
    filePickerName,
    inputHintEl,
    itemForm,
    itemInput,
    linkDescriptionInput,
    messageEl,
    networkStatusEl,
    quantityInput,
    scanAddBtn,
    scanShoppingBtn,
    scannerStatus,
    searchInput,
    productScannerLinks,
    sectionTabsEl,
    tabsToggleBtns,
    uploadProgressBarEl,
    uploadProgressEl,
    uploadModeFileBtn,
    uploadModeToggle,
    uploadModeUrlBtn,
    urlImportArea,
    urlImportInput,
    magicBar,
    magicBtns,
} from './ui.js?v=4.2.94';
import { syncAutoHeight } from './utils.js?v=4.2.94';

export function createAppUiController(deps = {}) {
    const { getUserPreferences = () => ({}), getPendingCount = () => 0, onSyncClick = () => {} } = deps;
    let messageTimer = null;
    let uploadMode = 'file';
    let lastUploadCategoryId = null;
    let remoteImportLoading = false;

    function setMessage(text, isError = false) {
        clearTimeout(messageTimer);
        messageEl.textContent = text;
        messageEl.classList.toggle('is-error', isError);
        messageEl.classList.add('is-visible');
        messageTimer = setTimeout(() => messageEl.classList.remove('is-visible'), 2500);
    }

    function setUploadProgress(fraction) {
        if (!uploadProgressEl || !uploadProgressBarEl) return;
        uploadProgressEl.classList.remove('is-indeterminate');

        if (fraction <= 0) {
            uploadProgressEl.hidden = true;
            uploadProgressBarEl.style.width = '0%';
            return;
        }

        uploadProgressEl.hidden = false;
        uploadProgressBarEl.style.width = `${Math.round(fraction * 100)}%`;

        if (fraction >= 1) {
            window.setTimeout(() => {
                uploadProgressEl.hidden = true;
                uploadProgressBarEl.style.width = '0%';
            }, 600);
        }
    }

    function makeUploadProgressCallback() {
        return fraction => {
            setUploadProgress(fraction);
            messageEl.classList.remove('is-error');
            messageEl.classList.add('is-visible');
            messageEl.textContent = fraction < 1 ? `Hochladen ${Math.round(fraction * 100)} %` : 'Wird gespeichert...';
        };
    }

    function setRemoteImportLoading(active, text = 'Datei wird von URL geladen...') {
        remoteImportLoading = Boolean(active);
        if (uploadProgressEl && uploadProgressBarEl) {
            uploadProgressEl.hidden = !remoteImportLoading;
            uploadProgressEl.classList.toggle('is-indeterminate', remoteImportLoading);
            uploadProgressBarEl.style.width = remoteImportLoading ? '35%' : '0%';
        }

        const submitBtn = itemForm?.querySelector('[type="submit"]');
        if (submitBtn) submitBtn.disabled = remoteImportLoading;
        if (urlImportInput) urlImportInput.disabled = remoteImportLoading;
        if (uploadModeFileBtn) uploadModeFileBtn.disabled = remoteImportLoading;
        if (uploadModeUrlBtn) uploadModeUrlBtn.disabled = remoteImportLoading;

        if (remoteImportLoading) {
            clearTimeout(messageTimer);
            messageEl.textContent = text;
            messageEl.classList.remove('is-error');
            messageEl.classList.add('is-visible');
        }
    }

    function updateFilePickerLabel() {
        if (!filePickerName) return;
        const attachment = fileInput?.files?.[0] || null;
        filePickerName.textContent = attachment ? attachment.name : 'Keine Datei ausgewählt';
    }

    function setUploadMode(mode) {
        uploadMode = mode === 'url' ? 'url' : 'file';
        const isUrlMode = uploadMode === 'url';

        uploadModeFileBtn?.classList.toggle('is-active', !isUrlMode);
        uploadModeUrlBtn?.classList.toggle('is-active', isUrlMode);
        uploadModeFileBtn?.setAttribute('aria-pressed', String(!isUrlMode));
        uploadModeUrlBtn?.setAttribute('aria-pressed', String(isUrlMode));

        if (filePickerArea) filePickerArea.hidden = isUrlMode;
        if (urlImportArea) urlImportArea.hidden = !isUrlMode;
    }

    function getUploadMode() {
        return uploadMode;
    }

    function formatBytes(sizeBytes) {
        const size = Number(sizeBytes);
        if (!Number.isFinite(size) || size < 0) return 'Unbekannt';
        if (size < 1024) return `${size} B`;
        const units = ['KB', 'MB', 'GB', 'TB'];
        let value = size / 1024;
        let unitIndex = 0;

        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex += 1;
        }

        return `${value.toLocaleString('de-DE', {
            minimumFractionDigits: value < 10 ? 1 : 0,
            maximumFractionDigits: 1,
        })} ${units[unitIndex]}`;
    }

    function updateUploadUi() {
        const type = getCurrentType();
        const category = getCurrentCategory();
        const uploadCategory = isAttachmentCategory(type);
        const imageCategory = type === 'images';
        const barcodeCategory = type === 'list_quantity';
        const linkCategory = type === 'links';
        const userPreferences = getUserPreferences();
        const shoppingListScannerEnabled = userPreferences.shopping_list_scanner_enabled !== false;

        if (category?.id !== lastUploadCategoryId) {
            lastUploadCategoryId = category?.id ?? null;
            setUploadMode('file');
        }

        if (type !== 'files' && uploadMode !== 'file') {
            setUploadMode('file');
        } else {
            setUploadMode(uploadMode);
        }

        if (fileInputGroup) fileInputGroup.hidden = !uploadCategory;
        if (uploadModeToggle) uploadModeToggle.hidden = type !== 'files';
        if (linkDescriptionInput) {
            linkDescriptionInput.hidden = !linkCategory;
            if (!linkCategory && linkDescriptionInput.value !== '') {
                linkDescriptionInput.value = '';
            }
            syncAutoHeight(linkDescriptionInput);
        }
        if (inputHintEl) {
            inputHintEl.hidden = true;
            inputHintEl.textContent = '';
        }

        const submitBtn = itemForm?.querySelector('[type="submit"]');
        if (submitBtn) submitBtn.hidden = uploadCategory && uploadMode === 'file';
        if (scanAddBtn) scanAddBtn.hidden = !shoppingListScannerEnabled || !barcodeCategory || uploadCategory;
        if (scanShoppingBtn) scanShoppingBtn.hidden = !shoppingListScannerEnabled || !barcodeCategory;

        if (filePickerButton) filePickerButton.textContent = imageCategory ? 'Bild wählen' : 'Datei wählen';
        if (remoteImportLoading) {
            setRemoteImportLoading(true);
        }
        if (fileInput) {
            fileInput.accept = imageCategory ? 'image/*' : '';
        }
        if (cameraBtn) cameraBtn.hidden = !imageCategory;
        if (dropZoneEl) {
            dropZoneEl.hidden = !uploadCategory;
            const label = dropZoneEl.querySelector('.drop-zone-label');
            if (label) {
                label.textContent = imageCategory
                    ? 'Bild hierher ziehen oder aus Zwischenablage einfügen'
                    : 'Datei hierher ziehen oder aus Zwischenablage einfügen';
            }
        }
        if (diskFreeEl) {
            diskFreeEl.hidden = !uploadCategory || state.diskFreeBytes === null;
            if (!diskFreeEl.hidden) {
                diskFreeEl.textContent = formatBytes(state.diskFreeBytes) + ' frei';
            }
        }

        updateFilePickerLabel();
    }

    function updateFeatureVisibility(preferences = getUserPreferences(), actions = {}) {
        const productScannerEnabled = preferences.product_scanner_enabled !== false;
        const shoppingListScannerEnabled = preferences.shopping_list_scanner_enabled !== false;
        const magicButtonEnabled = preferences.magic_button_enabled !== false;

        productScannerLinks.forEach(link => {
            link.hidden = !productScannerEnabled;
        });

        magicBtns.forEach(button => {
            button.hidden = !magicButtonEnabled;
        });

        if (magicBar) {
            magicBar.hidden = !magicButtonEnabled || magicBar.hidden;
        }

        if (!magicButtonEnabled && typeof actions.closeMagic === 'function') {
            actions.closeMagic();
        }

        if (!shoppingListScannerEnabled && typeof actions.closeScanner === 'function') {
            actions.closeScanner();
        }

        updateUploadUi();
    }

    function updateHeaders() {
        if (state.view === 'settings') {
            const titleListe = document.getElementById('titleListe');
            const titleShopping = document.getElementById('titleShopping');
            if (titleListe) titleListe.textContent = 'Einstellungen';
            if (titleShopping) titleShopping.textContent = 'Einstellungen';
            document.title = 'Ankerkladde - Einstellungen';
            return;
        }

        const category = getCurrentCategory();
        if (!category) return;

        const config = getTypeConfig(category.type);
        const titleListe = document.getElementById('titleListe');
        const titleShopping = document.getElementById('titleShopping');
        if (titleListe) titleListe.textContent = config.title(category.name);
        if (titleShopping) titleShopping.textContent = config.shoppingTitle(category.name);
        document.title = `Ankerkladde - ${category.name}`;

        if (itemInput) {
            itemInput.placeholder = config.placeholder;
            itemInput.required = !isAttachmentCategory(category.type);
        }

        if (quantityInput) {
            if (config.quantityMode === 'text') {
                quantityInput.type = 'text';
                quantityInput.placeholder = 'Menge';
                quantityInput.style.display = '';
                if (quantityInput.value && /^\d{4}-\d{2}-\d{2}$/.test(quantityInput.value)) {
                    quantityInput.value = '';
                }
            } else if (config.quantityMode === 'date') {
                quantityInput.type = 'date';
                quantityInput.placeholder = '';
                quantityInput.style.display = '';
                if (!quantityInput.value) {
                    quantityInput.value = new Date().toISOString().slice(0, 10);
                }
            } else {
                quantityInput.style.display = 'none';
                quantityInput.value = '';
            }
        }

        if (searchInput) {
            searchInput.placeholder = 'In allen Kategorien suchen...';
        }

        updateUploadUi();
    }

    function setScannerStatus(text, isError = false) {
        if (!scannerStatus) return;
        scannerStatus.textContent = text;
        scannerStatus.classList.toggle('is-error', Boolean(isError));
    }

    function setNetworkStatus() {
        if (!networkStatusEl) return;
        const count = getPendingCount();
        if (navigator.onLine && count === 0) {
            networkStatusEl.hidden = true;
            networkStatusEl.textContent = '';
            networkStatusEl.innerHTML = '';
        } else {
            networkStatusEl.hidden = false;
            if (count > 0) {
                const prefix = navigator.onLine ? 'Synchronisierung' : 'Offline';
                const msg = `${prefix} — ${count} Änderung${count === 1 ? '' : 'en'} ausstehend.`;
                networkStatusEl.innerHTML = `<span>${msg}</span> <button type="button" class="btn-network-sync" aria-label="Jetzt synchronisieren">Sync</button>`;
                const syncBtn = networkStatusEl.querySelector('.btn-network-sync');
                if (syncBtn) {
                    syncBtn.addEventListener('click', e => {
                        e.preventDefault();
                        onSyncClick();
                    });
                }
            } else {
                networkStatusEl.textContent = 'Offline: Die zuletzt geladene Liste bleibt sichtbar.';
            }
        }
    }

    function applyTabsVisibility(hidden) {
        if (!sectionTabsEl) return;
        sectionTabsEl.classList.toggle('tabs-hidden', Boolean(hidden));
        tabsToggleBtns.forEach(btn => btn.classList.toggle('is-active', !hidden));
    }

    return {
        applyTabsVisibility,
        formatBytes,
        makeUploadProgressCallback,
        setMessage,
        setNetworkStatus,
        setRemoteImportLoading,
        setScannerStatus,
        setUploadProgress,
        updateFeatureVisibility,
        updateFilePickerLabel,
        updateHeaders,
        updateUploadUi,
        getUploadMode,
        setUploadMode,
    };
}
