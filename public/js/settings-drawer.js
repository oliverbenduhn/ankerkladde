import { settingsUrl } from './api.js?v=5.1.34';
import { settingsDialogContentEl, settingsDialogEl, settingsDialogCloseEl } from './ui.js?v=5.1.34';

export function createSettingsDrawer({ onRequestClose, onContentChanged }) {
    let loaded = false;
    let loading = null;
    let currentTab = 'app';
    let settingsModule = null;

    async function render(tab, preserveScroll = false) {
        const scrollTop = preserveScroll ? settingsDialogContentEl.scrollTop : 0;
        const response = await fetch(settingsUrl(tab), { headers: { 'X-Requested-With': 'fetch' } });
        if (!response.ok) throw new Error('Einstellungen konnten nicht geladen werden.');

        settingsDialogContentEl.innerHTML = await response.text();
        settingsModule ||= await import('./settings.js?v=5.1.34');
        settingsModule.initSettings(settingsDialogContentEl);
        settingsDialogContentEl.scrollTop = scrollTop;
        loaded = true;
    }

    function requestClose() {
        if (settingsDialogEl.dataset.required === '1') return;
        close();
        onRequestClose();
    }

    async function open(tab = 'app') {
        currentTab = tab;
        if (!loaded) {
            loading ||= render(tab).finally(() => { loading = null; });
            await loading;
        }
        if (!settingsDialogEl.open) settingsDialogEl.showModal();

        const panel = settingsDialogContentEl.querySelector(`details[data-settings-panel="${tab}"]`);
        if (panel instanceof HTMLDetailsElement && tab !== 'app') panel.open = true;
        (settingsDialogCloseEl.hidden ? panel?.querySelector('input, button, select') : settingsDialogCloseEl)?.focus();
    }

    function close() {
        if (settingsDialogEl.open) settingsDialogEl.close();
    }

    settingsDialogCloseEl?.addEventListener('click', requestClose);
    settingsDialogEl?.addEventListener('cancel', event => {
        event.preventDefault();
        requestClose();
    });
    settingsDialogEl?.addEventListener('click', event => {
        if (event.target === settingsDialogEl) requestClose();
    });
    window.addEventListener('ankerkladde-settings-content-changed', () => {
        void onContentChanged('save_category');
    });
    window.addEventListener('ankerkladde-settings-reload', async event => {
        await onContentChanged(event.detail?.action || '');
        if (event.detail?.action === 'change_password') {
            delete settingsDialogEl.dataset.required;
            settingsDialogCloseEl.hidden = false;
        }
        await render(currentTab, true);
        settingsModule.renderFlash(event.detail?.message || '', event.detail?.type || 'ok', settingsDialogContentEl);
    });

    return { close, open };
}
