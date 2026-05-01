import os

source_file = '/home/oliver/Dokumente/ankerkladde/public/js/app-events.js'

layout_js = """import { saveLocalPrefs, state, themeMediaQuery, getCurrentType, userPreferencesRef } from './state.js?v=4.3.4';
import { appEl, sectionTabsEl, updateViewportHeight } from './ui.js?v=4.3.4';
import { applyThemePreferences } from './theme.js?v=4.3.4';

export function registerLayoutEvents(deps) {
    const { applyTabsVisibility, renderCategoryTabs, renderItems, savePreferences, navigation, closeSearch, closeScanner, updateHeaders, router } = deps;
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

    function applyDesktopLayout(layout) {
        state.desktopLayout = layout;
        if (appEl) appEl.dataset.desktopLayout = layout;
        deps.desktopLayoutBtns.forEach(btn => {
            btn.setAttribute('aria-pressed', btn.dataset.layout === layout ? 'true' : 'false');
        });
        saveLocalPrefs({ desktop_layout: layout });
        renderItems();
    }

    function transitionDesktopLayout(layout) {
        if (layout === state.desktopLayout) return;
        const reduceMotion = Boolean(prefersReducedMotion?.matches);
        const canUseViewTransition = !reduceMotion && typeof document.startViewTransition === 'function';

        if (canUseViewTransition) {
            document.startViewTransition(() => applyDesktopLayout(layout));
            return;
        }

        if (!reduceMotion) {
            appEl?.classList.add('is-layout-transitioning');
            window.setTimeout(() => {
                appEl?.classList.remove('is-layout-transitioning');
            }, 260);
        }
        applyDesktopLayout(layout);
    }

    deps.modeToggleBtns.forEach(button => {
        button.addEventListener('click', () => {
            if (deps.scannerState?.open) {
                closeScanner();
            }
            state.mode = button.dataset.nav === 'einkaufen' ? 'einkaufen' : 'liste';
            appEl.dataset.mode = state.mode;
            void savePreferences({ mode: state.mode });
            renderItems();
        });
    });

    deps.desktopLayoutBtns.forEach(button => {
        button.addEventListener('click', () => {
            let layout = button.dataset.layout || 'liste';
            if (layout === 'kanban' && getCurrentType() !== 'list_due_date') {
                layout = 'liste';
            }
            transitionDesktopLayout(layout);
        });
    });

    deps.tabsToggleBtns.forEach(button => {
        button.addEventListener('click', () => {
            const hidden = !sectionTabsEl.classList.contains('tabs-hidden');
            applyTabsVisibility(hidden);
            void savePreferences({ tabs_hidden: hidden });
        });
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

    document.querySelectorAll('.clickable-brand').forEach(el => {
        el.addEventListener('click', () => {
            const visibleCategories = state.categories?.filter(c => Number(c.is_hidden) !== 1) || [];
            if (visibleCategories.length > 0) {
                const firstCatId = visibleCategories[0].id;
                if (state.categoryId === String(firstCatId) && state.view !== 'settings' && !state.search.open && !deps.scannerState?.open) return;
                state.categoryId = String(firstCatId);
                state.swipeTransitionActive = true;
                void savePreferences({ last_category_id: firstCatId });
                if (state.search.open) closeSearch();
                if (state.view === 'settings') router.closeSettings();
                if (deps.scannerState?.open) closeScanner();
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
"""

forms_js = """import { isAttachmentCategory, state } from './state.js?v=4.3.4';
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
"""

tools_js = """import { saveLocalPrefs, state, scannerState, normalizePreferences, userPreferencesRef } from './state.js?v=4.3.4';
import { applyThemePreferences } from './theme.js?v=4.3.4';
import { normalizeSettingsTab } from './api.js?v=4.3.4';
import {
    magicBar,
    magicBtns,
    magicClose,
    magicInput,
    magicSubmit,
    magicVoiceBtn,
    noteEditorBack,
    noteTitleInput,
    noteToolbar,
    scanAddBtn,
    scanShoppingBtn,
    scannerCloseBtn,
    scannerManualForm,
    scannerManualInput,
    scannerOverlay,
    searchBtn,
    searchClose,
    searchInput,
    settingsBtns,
    settingsFrameEl,
    todoEditorBack,
} from './ui.js?v=4.3.4';
import { normalizeBarcodeValue } from './utils.js?v=4.3.4';

export function registerToolsEvents(deps) {
    const {
        openScanner, closeScanner, setScannerStatus, navigation, handleScannedBarcode,
        router, loadCategories, loadItems, updateHeaders, syncSettingsFrameTheme, setUserPreferences,
        openSearch, closeSearch, doSearch, magicController, scheduleNoteSave, editorController, closeTodoEditor
    } = deps;

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
            state.settingsTab = normalizeSettingsTab(frameUrl.searchParams.get('tab') || 'app');
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
        if (settingsFrameEl?.contentWindow && event.source !== settingsFrameEl.contentWindow) return;
        if (event.data?.type === 'ankerkladde-settings-close') {
            router.closeSettings();
            navigation.navigateBackOrReplace({ screen: 'list' });
            void loadCategories().then(() => loadItems(undefined, { useCache: false })).catch(() => {});
            return;
        }

        if (event.data?.type === 'ankerkladde-settings-preferences-update') {
            const patch = event.data?.preferences || {};
            saveLocalPrefs(patch);
            const nextPreferences = normalizePreferences({
                ...userPreferencesRef(),
                ...patch,
            });
            setUserPreferences(nextPreferences);
            applyThemePreferences(nextPreferences);
            syncSettingsFrameTheme();
        }
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

    let searchTimeout;
    searchInput?.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            void doSearch(searchInput.value);
        }, 300);
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
}
"""

system_js = """import { saveLocalPrefs, state, scannerState, userPreferencesRef } from './state.js?v=4.3.4';
import { magicBar } from './ui.js?v=4.3.4';

export function registerSystemEvents(deps) {
    const { navigation, setMessage, flushOfflineQueue, setNetworkStatus, magicController, closeSearch } = deps;

    window.addEventListener('popstate', event => {
        void navigation.handlePopState(event, setMessage);
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

    window.addEventListener('offline', setNetworkStatus);

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
}
"""

main_js = """import { registerLayoutEvents } from './app-events-layout.js?v=4.3.11';
import { registerFormsEvents } from './app-events-forms.js?v=4.3.11';
import { registerToolsEvents } from './app-events-tools.js?v=4.3.11';
import { registerSystemEvents } from './app-events-system.js?v=4.3.11';

export function registerAppEventHandlers(deps) {
    // Add scannerState explicitly if not passed
    if (!deps.scannerState) {
        import('./state.js?v=4.3.4').then(({ scannerState }) => {
            deps.scannerState = scannerState;
        });
    }

    registerLayoutEvents(deps);
    registerFormsEvents(deps);
    registerToolsEvents(deps);
    registerSystemEvents(deps);
}
"""

with open('/home/oliver/Dokumente/ankerkladde/public/js/app-events-layout.js', 'w') as f:
    f.write(layout_js)
with open('/home/oliver/Dokumente/ankerkladde/public/js/app-events-forms.js', 'w') as f:
    f.write(forms_js)
with open('/home/oliver/Dokumente/ankerkladde/public/js/app-events-tools.js', 'w') as f:
    f.write(tools_js)
with open('/home/oliver/Dokumente/ankerkladde/public/js/app-events-system.js', 'w') as f:
    f.write(system_js)
with open('/home/oliver/Dokumente/ankerkladde/public/js/app-events.js', 'w') as f:
    f.write(main_js)

print("Done Refactoring!")
