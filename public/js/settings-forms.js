import { t } from './i18n.js';
import {
    scrollKey,
    openCategoryKey,
    flashStorageKey,
    saveLocalPrefs,
    postPreferencesUpdate,
    themePreferences,
    allThemeColors,
} from './settings-state.js?v=4.3.11';
import { applyThemePreferencePatch, applySettingsTheme } from './settings-theme.js?v=4.3.11';
import { renderFlash } from './settings-ui.js?v=4.3.11';

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

export function initFormHandling() {
    const autoSaveControllers = new WeakMap();

    // Standard Form Submit
    document.querySelectorAll('form').forEach(form => {
        form.addEventListener('submit', async event => {
            event.preventDefault();

            if (form.dataset.autoSubmit === 'change') {
                return;
            }

            window.sessionStorage.setItem(scrollKey, String(window.scrollY || window.pageYOffset || 0));
            const details = form.querySelector('.settings-category-details');
            if (details instanceof HTMLDetailsElement && details.open) {
                window.sessionStorage.setItem(openCategoryKey, form.dataset.categoryId || '');
            }

            const formData = new FormData(form);
            if (event.submitter && event.submitter.name) {
                formData.append(event.submitter.name, event.submitter.value);
            }

            if (event.submitter instanceof HTMLButtonElement) {
                event.submitter.disabled = true;
            }

            try {
                const response = await fetch(getFormActionUrl(form), {
                    method: form.method || 'POST',
                    body: formData,
                    headers: {
                        'Accept': 'application/json',
                        'X-Requested-With': 'fetch',
                    },
                });

                const payload = await response.json().catch(() => null);
                if (payload && payload.flash) {
                    window.sessionStorage.setItem(flashStorageKey, JSON.stringify({
                        message: payload.flash,
                        type: payload.flash_type || 'ok'
                    }));
                }

                if (payload && payload.preferences && typeof payload.preferences === 'object') {
                    postPreferencesUpdate(payload.preferences);
                }

                window.location.reload();
            } catch (error) {
                renderFlash('Ein Fehler ist aufgetreten.', 'err');
                if (event.submitter instanceof HTMLButtonElement) {
                    event.submitter.disabled = false;
                }
            }
        });
    });

    // Auto-Save Forms
    document.querySelectorAll('form[data-auto-submit="change"]').forEach(form => {
        form.addEventListener('change', event => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
                return;
            }

            const actionUrl = getFormActionUrl(form);

            if (form.dataset.themeForm === '1') {
                const formData = new FormData(form);
                const localThemePatch = {
                    theme_mode: String(formData.get('theme_mode') || themePreferences.theme_mode || 'auto'),
                    light_theme: String(formData.get('light_theme') || themePreferences.light_theme || 'hafenblau'),
                    dark_theme: String(formData.get('dark_theme') || themePreferences.dark_theme || 'nachtwache'),
                };
                applyThemePreferencePatch(localThemePatch);
                saveLocalPrefs(localThemePatch);
                applySettingsTheme();
                postPreferencesUpdate(localThemePatch);
                renderFlash(t('msg.theme_saved'));
                return;
            }

            const localFormPatch = getLocalFormPatch(form);
            if (form.dataset.localPreferences === '1') {
                if (Object.keys(localFormPatch).length > 0) {
                    saveLocalPrefs(localFormPatch);
                    postPreferencesUpdate(localFormPatch);
                    renderFlash(t('msg.setting_saved'));
                }
                return;
            }

            if (Object.keys(localFormPatch).length > 0) {
                saveLocalPrefs(localFormPatch);
                postPreferencesUpdate(localFormPatch);
            }

            const previousController = autoSaveControllers.get(form);
            previousController?.abort();

            const controller = new AbortController();
            autoSaveControllers.set(form, controller);

            fetch(actionUrl, {
                method: 'POST',
                body: stripLocalPreferenceFields(new FormData(form)),
                headers: {
                    'Accept': 'application/json',
                    'X-Requested-With': 'fetch',
                },
                signal: controller.signal,
            })
                .then(async response => {
                    const payload = await response.json().catch(() => null);
                    if (!response.ok || !payload || payload.ok === false) {
                        const message = payload?.flash || 'Einstellung konnte nicht gespeichert werden.';
                        throw new Error(message);
                    }

                    if (payload.preferences && typeof payload.preferences === 'object') {
                        const preferences = {
                            ...payload.preferences,
                            ...localFormPatch,
                            theme_mode: themePreferences.theme_mode,
                            light_theme: themePreferences.light_theme,
                            dark_theme: themePreferences.dark_theme,
                        };
                        themePreferences.theme_colors = allThemeColors;
                        applySettingsTheme();
                        postPreferencesUpdate(preferences);
                    }

                    renderFlash(payload.flash || 'Gespeichert.', payload.flash_type || 'ok');
                })
                .catch(error => {
                    if (error.name === 'AbortError') {
                        return;
                    }
                    renderFlash(error instanceof Error ? error.message : 'Einstellung konnte nicht gespeichert werden.', 'err');
                })
                .finally(() => {
                    if (autoSaveControllers.get(form) === controller) {
                        autoSaveControllers.delete(form);
                    }
                });
        });
    });
}
