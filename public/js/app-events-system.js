import { saveLocalPrefs, state, scannerState, userPreferencesRef } from './state.js?v=4.3.4';
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
