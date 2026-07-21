import { t } from './i18n.js';
import {
    scrollKey,
    openCategoryKey,
    saveLocalPrefs,
    postPreferencesUpdate,
    themePreferences,
    allThemeColors,
} from './settings-state.js?v=5.1.34';
import { applyThemePreferencePatch, applySettingsTheme } from './settings-theme.js?v=5.1.34';
import { renderFlash } from './settings-ui.js?v=5.1.34';

const RELOAD_ACTIONS = new Set([
    'change_password',
    'create_category',
    'delete_category',
    'regenerate_api_key',
    'rename_categories',
]);

export function getLocalFormPatch(form) {
    const patch = {};
    const categorySwipeInput = form.querySelector('input[name="category_swipe_enabled"]');
    if (categorySwipeInput instanceof HTMLInputElement) {
        patch.category_swipe_enabled = categorySwipeInput.checked;
    }
    return patch;
}

export function stripLocalPreferenceFields(formData) {
    formData.delete('category_swipe_enabled');
    return formData;
}

export function getFormActionUrl(form) {
    return form.getAttribute('action') || window.location.href;
}

export function initFormHandling(root = document) {
    const autoSaveControllers = new WeakMap();

    async function submitForm(form, submitter = null) {
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        window.sessionStorage.setItem(scrollKey, String(root.scrollTop || 0));
        const details = form.querySelector('.settings-category-details');
        if (details instanceof HTMLDetailsElement && details.open) {
            window.sessionStorage.setItem(openCategoryKey, form.dataset.categoryId || '');
        }

        const formData = new FormData(form);
        if (submitter?.name) formData.append(submitter.name, submitter.value);
        const action = String(formData.getAll('action').at(-1) || '');
        if (submitter instanceof HTMLButtonElement) submitter.disabled = true;

        try {
            const response = await fetch(getFormActionUrl(form), {
                method: form.method || 'POST',
                body: formData,
                headers: { 'Accept': 'application/json', 'X-Requested-With': 'fetch' },
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload || payload.ok === false) {
                throw new Error(payload?.flash || 'Einstellung konnte nicht gespeichert werden.');
            }

            if (payload.preferences && typeof payload.preferences === 'object') {
                postPreferencesUpdate(payload.preferences);
            }

            if (action === 'save_language') {
                window.location.reload();
                return;
            }
            if (action === 'save_category') {
                const previewName = form.querySelector('.settings-category-preview-name');
                const nameInput = form.querySelector('input[name="category_name"]');
                if (previewName && nameInput instanceof HTMLInputElement) previewName.textContent = nameInput.value.trim();
                const selectedIcon = form.querySelector('input[name="category_icon"]:checked + .category-icon-choice-visual img');
                const previewIcon = form.querySelector('.settings-category-preview-icon img');
                if (selectedIcon instanceof HTMLImageElement && previewIcon instanceof HTMLImageElement) previewIcon.src = selectedIcon.src;
                window.dispatchEvent(new CustomEvent('ankerkladde-settings-content-changed'));
            }
            if (RELOAD_ACTIONS.has(action)) {
                window.dispatchEvent(new CustomEvent('ankerkladde-settings-reload', {
                    detail: { action, message: payload.flash, type: payload.flash_type || 'ok' },
                }));
                return;
            }

            renderFlash(payload.flash || t('msg.setting_saved'), payload.flash_type || 'ok', root);
        } catch (error) {
            renderFlash(error instanceof Error ? error.message : 'Ein Fehler ist aufgetreten.', 'err', root);
        } finally {
            if (submitter instanceof HTMLButtonElement) submitter.disabled = false;
        }
    }

    root.querySelectorAll('form').forEach(form => {
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (form.dataset.autoSubmit === 'change') return;
            void submitForm(form, event.submitter);
        });
    });

    root.querySelectorAll('form[data-auto-submit="change"]').forEach(form => {
        form.addEventListener('change', event => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;

            if (form.dataset.themeForm === '1') {
                const formData = new FormData(form);
                const patch = {
                    theme_mode: String(formData.get('theme_mode') || themePreferences.theme_mode || 'auto'),
                    light_theme: String(formData.get('light_theme') || themePreferences.light_theme || 'hafenblau'),
                    dark_theme: String(formData.get('dark_theme') || themePreferences.dark_theme || 'nachtwache'),
                };
                applyThemePreferencePatch(patch);
                saveLocalPrefs(patch);
                applySettingsTheme(root);
                postPreferencesUpdate(patch);
                renderFlash(t('msg.theme_saved'), 'ok', root);
                return;
            }

            const localPatch = getLocalFormPatch(form);
            if (Object.keys(localPatch).length > 0) {
                saveLocalPrefs(localPatch);
                postPreferencesUpdate(localPatch);
            }
            if (form.dataset.localPreferences === '1') {
                renderFlash(t('msg.setting_saved'), 'ok', root);
                return;
            }

            autoSaveControllers.get(form)?.abort();
            const controller = new AbortController();
            autoSaveControllers.set(form, controller);
            fetch(getFormActionUrl(form), {
                method: 'POST',
                body: stripLocalPreferenceFields(new FormData(form)),
                headers: { 'Accept': 'application/json', 'X-Requested-With': 'fetch' },
                signal: controller.signal,
            }).then(async response => {
                const payload = await response.json().catch(() => null);
                if (!response.ok || !payload || payload.ok === false) throw new Error(payload?.flash || 'Einstellung konnte nicht gespeichert werden.');
                if (payload.preferences) postPreferencesUpdate({ ...payload.preferences, ...localPatch });
                if (String(new FormData(form).get('action') || '') === 'save_language') {
                    window.location.reload();
                    return;
                }
                renderFlash(payload.flash || t('msg.setting_saved'), payload.flash_type || 'ok', root);
            }).catch(error => {
                if (error.name !== 'AbortError') renderFlash(error.message, 'err', root);
            }).finally(() => {
                if (autoSaveControllers.get(form) === controller) autoSaveControllers.delete(form);
            });
        });
    });

    root.querySelectorAll('form[data-auto-submit="category"]').forEach(form => {
        form.addEventListener('change', event => {
            if (event.target instanceof HTMLInputElement && event.target.name !== 'category_name') void submitForm(form);
        });
        const nameInput = form.querySelector('input[name="category_name"]');
        nameInput?.addEventListener('blur', () => void submitForm(form));
        nameInput?.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                nameInput.blur();
            }
        });
    });
}
