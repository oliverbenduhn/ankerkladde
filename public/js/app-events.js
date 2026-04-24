import { state, scannerState, themeMediaQuery, isAttachmentCategory, normalizePreferences } from './state.js?v=4.2.59';
import {
    appEl,
    cameraBtn,
    cameraInput,
    clearDoneBtn,
    dropZoneEl,
    fileInput,
    itemForm,
    itemInput,
    linkDescriptionInput,
    noteEditorBack,
    noteTitleInput,
    noteToolbar,
    todoEditorBack,
    quantityInput,
    scanAddBtn,
    scanShoppingBtn,
    scannerCloseBtn,
    scannerManualForm,
    scannerManualInput,
    scannerOverlay,
    searchBtn,
    searchClose,
    searchInput,
    magicBtns,
    magicBar,
    magicInput,
    magicSubmit,
    magicVoiceBtn,
    magicClose,
    sectionTabsEl,
    settingsBtns,
    settingsFrameEl,
    tabsToggleBtns,
    updateViewportHeight,
    uploadModeFileBtn,
    uploadModeUrlBtn,
    urlImportInput,
} from './ui.js?v=4.2.59';
import { applyThemePreferences } from './theme.js?v=4.2.59';
import { normalizeBarcodeValue, syncAutoHeight } from './utils.js?v=4.2.59';

export function registerAppEventHandlers(deps) {
    const {
        applyTabsVisibility,
        clearDone,
        closeScanner,
        closeSearch,
        doSearch,
        flushOfflineQueue,
        handleScannedBarcode,
        loadCategories,
        loadItems,
        navigation,
        openScanner,
        openSearch,
        renderCategoryTabs,
        renderItems,
        router,
        savePreferences,
        scheduleNoteSave,
        setMessage,
        setNetworkStatus,
        setScannerStatus,
        setUploadProgress,
        setUserPreferences,
        setUploadMode,
        syncSettingsFrameTheme,
        tabsViewController,
        triggerUploadSelectedAttachment,
        updateFilePickerLabel,
        updateHeaders,
        updateUploadUi,
        userPreferencesRef,
        editorController,
        closeTodoEditor,
        addItem,
        magicController,
    } = deps;

    itemForm?.addEventListener('submit', event => {
        void addItem(event).catch(error => {
            setUploadProgress(0);
            setMessage(error instanceof Error ? error.message : 'Aktion fehlgeschlagen.', true);
        });
    });

    fileInput?.addEventListener('change', () => {
        updateFilePickerLabel();

        if (!isAttachmentCategory()) return;
        if (deps.getUploadMode?.() === 'url') return;
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

    scanAddBtn?.addEventListener('click', () => {
        void openScanner('add').then(() => {
            if (scannerState.open) {
                navigation.pushHistoryState({ screen: 'scanner', action: scannerState.action, categoryId: state.categoryId });
            }
        }).catch(error => {
            setScannerStatus(error instanceof Error ? error.message : 'Scanner konnte nicht gestartet werden.', true);
        });
    });

    scanShoppingBtn?.addEventListener('click', () => {
        void openScanner('toggle').then(() => {
            if (scannerState.open) {
                navigation.pushHistoryState({ screen: 'scanner', action: scannerState.action, categoryId: state.categoryId });
            }
        }).catch(error => {
            setScannerStatus(error instanceof Error ? error.message : 'Scanner konnte nicht gestartet werden.', true);
        });
    });

    scannerCloseBtn?.addEventListener('click', () => navigation.navigateBackOrReplace({ screen: 'list' }));
    scannerOverlay?.addEventListener('click', event => {
        if (event.target === scannerOverlay) {
            navigation.navigateBackOrReplace({ screen: 'list' });
        }
    });

    scannerManualForm?.addEventListener('submit', event => {
        event.preventDefault();
        const barcode = normalizeBarcodeValue(scannerManualInput?.value || '');
        if (barcode === '') {
            setScannerStatus('Bitte Barcode eingeben.', true);
            return;
        }

        void handleScannedBarcode(barcode);
    });

    deps.modeToggleBtns.forEach(button => {
        button.addEventListener('click', () => {
            if (scannerState.open) {
                closeScanner();
            }
            state.mode = button.dataset.nav === 'einkaufen' ? 'einkaufen' : 'liste';
            appEl.dataset.mode = state.mode;
            void savePreferences({ mode: state.mode });
            renderItems();
        });
    });

    settingsBtns.forEach(button => {
        button.addEventListener('click', event => {
            event.preventDefault();
            const targetTab = button.dataset.settingsTab || 'app';
            if (state.view === 'settings' && state.settingsTab === targetTab) {
                router.closeSettings();
                navigation.navigateBackOrReplace({ screen: 'list' });
                void loadCategories().then(() => loadItems(undefined, { useCache: false })).catch(() => {});
                return;
            }
            void router.openSettings(targetTab).then(() => {
                navigation.pushHistoryState({ screen: 'settings', tab: state.settingsTab });
            }).catch(() => {});
        });
    });

    settingsFrameEl?.addEventListener('load', () => {
        try {
            const frameUrl = new URL(settingsFrameEl.contentWindow?.location.href || settingsFrameEl.src, window.location.href);
            if (frameUrl.protocol === 'about:') {
                return;
            }
            state.settingsTab = frameUrl.searchParams.get('tab') === 'extension' ? 'extension' : 'app';
            if (state.view === 'settings') {
                navigation.replaceCurrentHistoryState({ screen: 'settings', tab: state.settingsTab });
                void loadCategories()
                    .then(() => {
                        updateHeaders();
                        syncSettingsFrameTheme();
                    })
                    .catch(() => {});
            }
        } catch {
            // same-origin expected; ignore if unavailable
        }
    });

    window.addEventListener('message', event => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === 'ankerkladde-settings-close') {
            router.closeSettings();
            navigation.navigateBackOrReplace({ screen: 'list' });
            void loadCategories().then(() => loadItems(undefined, { useCache: false })).catch(() => {});
            return;
        }

        if (event.data?.type === 'ankerkladde-settings-preferences-update') {
            const nextPreferences = normalizePreferences({
                ...userPreferencesRef(),
                ...(event.data?.preferences || {}),
            });
            setUserPreferences(nextPreferences);
            applyThemePreferences(nextPreferences);
        }
    });

    window.addEventListener('popstate', event => {
        void navigation.handlePopState(event, setMessage);
    });

    tabsToggleBtns.forEach(button => {
        button.addEventListener('click', () => {
            const hidden = !sectionTabsEl.classList.contains('tabs-hidden');
            applyTabsVisibility(hidden);
            void savePreferences({ tabs_hidden: hidden });
        });
    });

    document.addEventListener('click', event => {
        tabsViewController.handleDocumentClick(event.target);
    });

    window.addEventListener('resize', () => {
        updateViewportHeight();
        renderCategoryTabs();
    });

    window.addEventListener('orientationchange', () => {
        updateViewportHeight();
        renderCategoryTabs();
    });

    window.addEventListener('pageshow', () => {
        updateViewportHeight();
        renderCategoryTabs();
    });

    window.visualViewport?.addEventListener('resize', () => {
        updateViewportHeight();
        renderCategoryTabs();
    });

    window.visualViewport?.addEventListener('scroll', () => {
        updateViewportHeight();
        renderCategoryTabs();
    });

    linkDescriptionInput?.addEventListener('input', () => {
        syncAutoHeight(linkDescriptionInput);
    });

    [itemInput, quantityInput, linkDescriptionInput].forEach(field => {
        field?.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            if (event.isComposing) return;
            if (field instanceof HTMLTextAreaElement && event.shiftKey) return;
            event.preventDefault();
            itemForm?.requestSubmit();
        });
    });

    searchBtn?.addEventListener('click', () => {
        if (state.view === 'settings' || state.noteEditorId !== null) return;
        if (state.search.open) {
            navigation.navigateBackOrReplace({ screen: 'list' });
            return;
        }
        if (scannerState.open) closeScanner();
        if (!magicBar.hidden) magicController.closeMagic();
        openSearch();
        navigation.pushHistoryState({ screen: 'search', query: state.search.query });
    });

    searchClose?.addEventListener('click', () => {
        navigation.navigateBackOrReplace({ screen: 'list' });
    });

    searchInput?.addEventListener('input', () => {
        void doSearch(searchInput.value);
    });

    searchInput?.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            closeSearch();
        }
    });

    magicBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (state.view === 'settings' || state.noteEditorId !== null) return;
            if (!magicBar.hidden) {
                magicController.closeMagic();
                return;
            }
            if (scannerState.open) closeScanner();
            if (state.search.open) closeSearch();
            magicController.openMagic();
        });
    });

    magicVoiceBtn?.addEventListener('click', () => {
        magicController.startVoiceRecognition();
    });

    magicClose?.addEventListener('click', () => {
        magicController.closeMagic();
    });

    magicSubmit?.addEventListener('click', () => {
        void magicController.submitMagic();
    });

    magicInput?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            void magicController.submitMagic();
        } else if (event.key === 'Escape') {
            magicController.closeMagic();
        }
    });

    document.addEventListener('ankerkladde-close-bars', () => {
        if (!magicBar.hidden) magicController.closeMagic();
        if (state.search.open) closeSearch();
    });

    noteEditorBack?.addEventListener('click', () => {
        navigation.navigateBackOrReplace({ screen: 'list' });
    });

    todoEditorBack?.addEventListener('click', () => {
        void closeTodoEditor();
    });

    noteTitleInput?.addEventListener('input', scheduleNoteSave);

    noteToolbar?.addEventListener('click', event => {
        editorController.handleToolbarClick(event);
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

    let onlineSyncRunning = false;
    const runOnlineSync = async () => {
        if (onlineSyncRunning) return;
        onlineSyncRunning = true;
        try {
            await flushOfflineQueue();
        } catch {
            // Keep queued actions for the next retry.
        } finally {
            setNetworkStatus();
            onlineSyncRunning = false;
        }
    };

    window.addEventListener('online', () => {
        void runOnlineSync();
    });
    if (themeMediaQuery) {
        const onThemeMediaChange = () => {
            if (userPreferencesRef().theme_mode === 'auto') applyThemePreferences(userPreferencesRef());
        };
        if (typeof themeMediaQuery.addEventListener === 'function') {
            themeMediaQuery.addEventListener('change', onThemeMediaChange);
        } else if (typeof themeMediaQuery.addListener === 'function') {
            themeMediaQuery.addListener(onThemeMediaChange);
        }
    }
    window.addEventListener('offline', setNetworkStatus);

    // Polling fallback: mobile browsers do not always fire online/offline reliably.
    setInterval(() => {
        if (navigator.onLine) {
            void runOnlineSync();
        }
    }, 3000);

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && scannerState.open) {
            navigation.navigateBackOrReplace({ screen: 'list' });
            return;
        }
        if (event.key === 'Escape' && state.search.open) {
            navigation.navigateBackOrReplace({ screen: 'list' });
            return;
        }
        if (event.key === 'Escape' && state.noteEditorId !== null) {
            navigation.navigateBackOrReplace({ screen: 'list' });
            return;
        }
        if (event.key === 'Escape' && state.view === 'settings') {
            navigation.navigateBackOrReplace({ screen: 'list' });
        }
        if (event.key === 'Escape' && !magicBar.hidden) {
            magicController.closeMagic();
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && scannerState.open) {
            navigation.navigateBackOrReplace({ screen: 'list' });
        }
    });

    let deferredInstallPrompt = null;
    const installBannerEl = document.getElementById('installBanner');
    const installBtn = document.getElementById('installBtn');
    const installDismiss = document.getElementById('installDismiss');

    window.addEventListener('beforeinstallprompt', event => {
        if (userPreferencesRef().install_banner_dismissed || !installBannerEl || !installBtn) return;
        deferredInstallPrompt = event;
        event.preventDefault();
        installBannerEl.hidden = false;
    });

    installBtn?.addEventListener('click', async () => {
        if (installBannerEl) installBannerEl.hidden = true;
        await deferredInstallPrompt?.prompt();
        deferredInstallPrompt = null;
    });

    installDismiss?.addEventListener('click', () => {
        if (installBannerEl) installBannerEl.hidden = true;
        deferredInstallPrompt = null;
        void savePreferences({ install_banner_dismissed: true });
    });

    document.querySelectorAll('.clickable-brand').forEach(el => {
        el.addEventListener('click', () => {
            const visibleCategories = state.categories?.filter(c => Number(c.is_hidden) !== 1) || [];
            if (visibleCategories.length > 0) {
                const firstCatId = visibleCategories[0].id;
                if (state.categoryId === String(firstCatId) && state.view !== 'settings' && !state.search.open && !scannerState.open) return;
                state.categoryId = String(firstCatId);
                state.swipeTransitionActive = true;
                void savePreferences({ last_category_id: firstCatId });
                if (state.search.open) closeSearch();
                if (state.view === 'settings') router.closeSettings();
                if (scannerState.open) closeScanner();
                navigation.pushHistoryState({ screen: 'list', categoryId: firstCatId });
                renderCategoryTabs();
                renderItems();
                updateHeaders();
                document.querySelectorAll('details').forEach(el => el.removeAttribute('open'));
                setTimeout(() => { state.swipeTransitionActive = false; }, 300);
            }
        });
    });
}
