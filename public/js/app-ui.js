import { getCurrentCategory, getCurrentType, getTypeConfig, isAttachmentCategory, state } from './state.js';
import {
    cameraBtn,
    diskFreeEl,
    dropZoneEl,
    fileInput,
    fileInputGroup,
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
    sectionTabsEl,
    tabsToggleBtns,
    uploadProgressBarEl,
    uploadProgressEl,
} from './ui.js';
import { syncAutoHeight } from './utils.js';

export function createAppUiController() {
    let messageTimer = null;

    function setMessage(text, isError = false) {
        clearTimeout(messageTimer);
        messageEl.textContent = text;
        messageEl.classList.toggle('is-error', isError);
        messageEl.classList.add('is-visible');
        messageTimer = setTimeout(() => messageEl.classList.remove('is-visible'), 2500);
    }

    function setUploadProgress(fraction) {
        if (!uploadProgressEl || !uploadProgressBarEl) return;

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

    function updateFilePickerLabel() {
        if (!filePickerName) return;
        const attachment = fileInput?.files?.[0] || null;
        filePickerName.textContent = attachment ? attachment.name : 'Keine Datei ausgewählt';
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
        const uploadCategory = isAttachmentCategory(type);
        const imageCategory = type === 'images';
        const barcodeCategory = type === 'list_quantity';
        const linkCategory = type === 'links';

        if (fileInputGroup) fileInputGroup.hidden = !uploadCategory;
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
        if (submitBtn) submitBtn.hidden = uploadCategory;
        if (scanAddBtn) scanAddBtn.hidden = !barcodeCategory || uploadCategory;
        if (scanShoppingBtn) scanShoppingBtn.hidden = !barcodeCategory;

        if (filePickerButton) filePickerButton.textContent = imageCategory ? 'Bild wählen' : 'Datei wählen';
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
        if (navigator.onLine) {
            networkStatusEl.hidden = true;
            networkStatusEl.textContent = '';
        } else {
            networkStatusEl.hidden = false;
            networkStatusEl.textContent = 'Offline: Die zuletzt geladene Liste bleibt sichtbar.';
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
        setScannerStatus,
        setUploadProgress,
        updateFilePickerLabel,
        updateHeaders,
        updateUploadUi,
    };
}
