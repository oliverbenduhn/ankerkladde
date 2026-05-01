import { isAttachmentCategory, state } from './state.js?v=4.3.4';
import {
    cameraBtn,
    cameraInput,
    clearDoneBtn,
    dropZoneEl,
    fileInput,
    itemForm,
    itemInput,
    linkDescriptionInput,
    quantityInput,
    uploadModeFileBtn,
    uploadModeUrlBtn,
    urlImportInput,
} from './ui.js?v=4.3.4';
import { syncAutoHeight } from './utils.js?v=4.3.4';

export function registerFormsEvents(deps) {
    const { addItem, setUploadProgress, setMessage, updateFilePickerLabel, getUploadMode, triggerUploadSelectedAttachment, setUploadMode, updateUploadUi, clearDone } = deps;

    itemForm?.addEventListener('submit', event => {
        void addItem(event).catch(error => {
            setUploadProgress(0);
            setMessage(error instanceof Error ? error.message : 'Aktion fehlgeschlagen.', true);
        });
    });

    fileInput?.addEventListener('change', () => {
        updateFilePickerLabel();

        if (!isAttachmentCategory()) return;
        if (getUploadMode?.() === 'url') return;
        if (!fileInput.files?.[0]) return;

        void triggerUploadSelectedAttachment().catch(error => {
            setUploadProgress(0);
            setMessage(error instanceof Error ? error.message : 'Upload fehlgeschlagen.', true);
        });
    });

    uploadModeFileBtn?.addEventListener('click', () => {
        setUploadMode('file');
        updateUploadUi();
    });

    uploadModeUrlBtn?.addEventListener('click', () => {
        setUploadMode('url');
        updateUploadUi();
        urlImportInput?.focus();
    });

    itemInput?.addEventListener('input', () => {
        syncAutoHeight(itemInput);
    });
    syncAutoHeight(itemInput);

    linkDescriptionInput?.addEventListener('input', () => {
        syncAutoHeight(linkDescriptionInput);
    });

    [itemInput, quantityInput, linkDescriptionInput].forEach(field => {
        field?.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                if (event.isComposing) return;
                if (field instanceof HTMLTextAreaElement && event.shiftKey) return;
                event.preventDefault();
                itemForm?.requestSubmit();
            }
        });
    });

    cameraBtn?.addEventListener('click', () => cameraInput?.click());
    cameraInput?.addEventListener('change', () => {
        if (!cameraInput?.files?.[0] || !fileInput) return;
        fileInput.files = cameraInput.files;
        updateFilePickerLabel();

        if (!isAttachmentCategory()) return;

        void triggerUploadSelectedAttachment().catch(error => {
            setUploadProgress(0);
            setMessage(error instanceof Error ? error.message : 'Upload fehlgeschlagen.', true);
        });
    });

    clearDoneBtn?.addEventListener('click', () => {
        void clearDone().catch(error => {
            setMessage(error instanceof Error ? error.message : 'Löschen fehlgeschlagen.', true);
        });
    });

    dropZoneEl?.addEventListener('dragover', event => {
        if (!isAttachmentCategory()) return;
        event.preventDefault();
        dropZoneEl.classList.add('drop-active');
    });

    dropZoneEl?.addEventListener('dragleave', () => {
        dropZoneEl.classList.remove('drop-active');
    });

    dropZoneEl?.addEventListener('drop', event => {
        if (!isAttachmentCategory()) return;
        event.preventDefault();
        dropZoneEl.classList.remove('drop-active');
        const file = event.dataTransfer?.files?.[0] || null;
        if (!file || !fileInput) return;

        const transfer = new DataTransfer();
        transfer.items.add(file);
        fileInput.files = transfer.files;
        updateFilePickerLabel();

        void triggerUploadSelectedAttachment().catch(error => {
            setUploadProgress(0);
            setMessage(error instanceof Error ? error.message : 'Upload fehlgeschlagen.', true);
        });
    });

    document.addEventListener('paste', event => {
        if (!isAttachmentCategory()) return;
        if (state.noteEditorId !== null) return;
        const file = Array.from(event.clipboardData?.items || [])
            .find(item => item.kind === 'file')
            ?.getAsFile() || null;
        if (!file || !fileInput) return;
        event.preventDefault();
        const transfer = new DataTransfer();
        transfer.items.add(file);
        fileInput.files = transfer.files;
        updateFilePickerLabel();
        void triggerUploadSelectedAttachment().catch(error => {
            setUploadProgress(0);
            setMessage(error instanceof Error ? error.message : 'Upload fehlgeschlagen.', true);
        });
    });
}
