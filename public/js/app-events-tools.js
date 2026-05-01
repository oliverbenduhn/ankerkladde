import { saveLocalPrefs, state, scannerState, normalizePreferences, userPreferencesRef } from './state.js?v=4.3.4';
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
