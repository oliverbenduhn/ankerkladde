import { settingsUrl } from './api.js';
import { t } from './i18n.js';
import { settingsDialogContentEl, settingsDialogEl, settingsDialogCloseEl } from './ui.js';

export function createSettingsDrawer({ onRequestClose, onContentChanged }) {
    let loaded = false;
    let loading = null;
    let currentTab = 'app';
    let settingsModule = null;
    let opening = 0;

    async function render(tab, preserveScroll = false) {
        const scrollTop = preserveScroll ? settingsDialogContentEl.scrollTop : 0;
        const response = await fetch(settingsUrl(tab), { headers: { 'X-Requested-With': 'fetch' } });
        if (!response.ok) throw new Error('Einstellungen konnten nicht geladen werden.');

        settingsDialogContentEl.innerHTML = await response.text();
        settingsModule ||= await import('./settings.js');
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
        const attempt = ++opening;
        currentTab = tab;
        if (!loaded) {
            loading ||= render(tab).finally(() => { loading = null; });
            try {
                await loading;
            } catch {
                if (attempt !== opening) return;
                const message = document.createElement('p');
                message.textContent = t('error.settings_load');
                message.setAttribute('role', 'alert');
                const retry = document.createElement('button');
                retry.type = 'button';
                retry.textContent = t('action.settings_retry');
                retry.addEventListener('click', () => void open(tab), { once: true });
                settingsDialogContentEl.replaceChildren(message, retry);
                if (!settingsDialogEl.open) settingsDialogEl.showModal();
                retry.focus();
                return;
            }
        }
        if (attempt !== opening) return;
        if (!settingsDialogEl.open) settingsDialogEl.showModal();

        const panel = settingsDialogContentEl.querySelector(`details[data-settings-panel="${tab}"]`);
        if (panel instanceof HTMLDetailsElement && tab !== 'app') panel.open = true;
        (settingsDialogCloseEl.hidden ? panel?.querySelector('input, button, select') : settingsDialogCloseEl)?.focus();
    }

    function close() {
        opening += 1;
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
