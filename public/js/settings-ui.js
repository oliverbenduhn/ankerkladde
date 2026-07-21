import { t } from './i18n.js';
import {
    panelsKey,
    categoriesKey,
    scrollKey,
    flashStorageKey,
    openCategoryKey,
} from './settings-state.js?v=5.1.34';

export function renderFlash(message, type = 'ok', root = document) {
    if (!message) return;

    const currentFlash = root.querySelector('.settings-flash[data-settings-flash="transient"]');
    if (currentFlash) {
        currentFlash.remove();
    }

    const flash = document.createElement('div');
    flash.className = `settings-flash settings-flash-${type === 'err' ? 'err' : 'ok'}`;
    flash.dataset.settingsFlash = 'transient';
    flash.setAttribute('role', 'alert');
    flash.textContent = message;
    (root === document ? document.body : root).appendChild(flash);
}

export function readOpenPanels() {
    try {
        const raw = window.localStorage.getItem(panelsKey);
        if (raw === null) {
            return null;
        }

        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
    } catch (error) {
        return null;
    }
}

export function readOpenCategories() {
    try {
        const raw = window.localStorage.getItem(categoriesKey);
        if (raw === null) {
            return null;
        }

        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(String) : null;
    } catch (error) {
        return null;
    }
}

export function saveOpenPanels(settingsPanels) {
    try {
        const openPanels = settingsPanels
            .filter(panel => panel.open)
            .map(panel => panel.dataset.settingsPanel)
            .filter(Boolean);
        window.localStorage.setItem(panelsKey, JSON.stringify(openPanels));
    } catch (error) {}
}

export function saveOpenCategories(categoryRows) {
    try {
        const openCategories = categoryRows
            .filter(form => {
                const details = form.querySelector('.settings-category-details');
                return details instanceof HTMLDetailsElement && details.open;
            })
            .map(form => String(form.dataset.categoryId || ''))
            .filter(Boolean);
        window.localStorage.setItem(categoriesKey, JSON.stringify(openCategories));
    } catch (error) {}
}

export function initUIHandling(root = document) {
    const settingsPanels = Array.from(root.querySelectorAll('details[data-settings-panel]'));
    const categoryRows = Array.from(root.querySelectorAll('form.settings-category-row'));

    // Restore open panels
    const savedPanels = readOpenPanels();
    if (savedPanels !== null) {
        const openPanels = new Set(savedPanels);
        settingsPanels.forEach(panel => {
            panel.open = openPanels.has(panel.dataset.settingsPanel || '');
        });
    }

    settingsPanels.forEach(panel => {
        panel.addEventListener('toggle', () => {
            saveOpenPanels(settingsPanels);
        });
    });

    // Restore scroll
    const saved = window.sessionStorage.getItem(scrollKey);
    if (saved !== null) {
        window.sessionStorage.removeItem(scrollKey);
        window.requestAnimationFrame(() => {
            root.scrollTo({ top: Number(saved) || 0, behavior: 'auto' });
        });
    }

    // Restore flash message
    const savedFlash = window.sessionStorage.getItem(flashStorageKey);
    if (savedFlash) {
        window.sessionStorage.removeItem(flashStorageKey);
        try {
            const parsedFlash = JSON.parse(savedFlash);
            if (parsedFlash && parsedFlash.message) {
                window.requestAnimationFrame(() => {
                    renderFlash(parsedFlash.message, parsedFlash.type || 'ok', root);
                });
            }
        } catch (error) {}
    }

    // Restore category accordion states
    categoryRows.forEach(form => {
        const details = form.querySelector('.settings-category-details');
        if (details instanceof HTMLDetailsElement) {
            details.addEventListener('toggle', () => {
                saveOpenCategories(categoryRows);
            });
        }
    });

    const savedCategories = readOpenCategories();
    const openCategories = new Set(savedCategories || []);
    const savedCategoryId = window.sessionStorage.getItem(openCategoryKey);
    if (savedCategoryId) {
        window.sessionStorage.removeItem(openCategoryKey);
        openCategories.add(String(savedCategoryId));
    }

    if (savedCategories !== null || savedCategoryId) {
        categoryRows.forEach(form => {
            const details = form.querySelector('.settings-category-details');
            if (details instanceof HTMLDetailsElement) {
                details.open = openCategories.has(String(form.dataset.categoryId || ''));
            }
        });
        saveOpenCategories(categoryRows);
    }

    // Protect non-interactive assets from drag/context menu
    const nonInteractiveAssetSelector = '.category-icon-img, .brand-mark';
    root.querySelectorAll(nonInteractiveAssetSelector).forEach(element => {
        if (element instanceof HTMLImageElement) {
            element.draggable = false;
        }
    });

    root.addEventListener('dragstart', event => {
        if (event.target instanceof Element && event.target.closest(nonInteractiveAssetSelector)) {
            event.preventDefault();
        }
    });

    root.addEventListener('contextmenu', event => {
        if (event.target instanceof Element && event.target.closest(nonInteractiveAssetSelector)) {
            event.preventDefault();
        }
    });

    // API Key logic
    const copyButton = root.querySelector('#copy-api-key');
    const apiKeyInput = root.querySelector('#api-key-value');
    if (copyButton && apiKeyInput) {
        copyButton.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(apiKeyInput.value);
                copyButton.textContent = t('ui.copied');
                window.setTimeout(() => {
                    copyButton.textContent = t('settings.action.copy');
                }, 1500);
            } catch (error) {
                copyButton.textContent = t('ui.copy_failed');
            }
        });
    }

    // AI provider toggle
    const providerSelect = root.querySelector('#ai_provider_select');
    const geminiFields = root.querySelector('#gemini_fields');
    const openrouterFields = root.querySelector('#openrouter_fields');

    function updateProviderFields() {
        if (!providerSelect || !geminiFields || !openrouterFields) return;
        const provider = providerSelect.value;
        geminiFields.style.display = provider === 'gemini' ? '' : 'none';
        openrouterFields.style.display = provider === 'openrouter' ? '' : 'none';
    }

    if (providerSelect) {
        providerSelect.addEventListener('change', updateProviderFields);
        updateProviderFields();
    }

    // AI test logic
    const testApiKeyBtn = root.querySelector('#test-api-key');
    const geminiKeyInput = root.querySelector('#gemini_api_key_input');
    const geminiModelSelect = root.querySelector('#gemini_model_select');
    const openrouterKeyInput = root.querySelector('#openrouter_api_key_input');
    const openrouterModelSelect = root.querySelector('#openrouter_model_select');
    const apiTestStatus = root.querySelector('#api-test-status');

    if (testApiKeyBtn) {
        testApiKeyBtn.addEventListener('click', async () => {
            const provider = providerSelect ? providerSelect.value : 'gemini';
            let key, model;

            if (provider === 'openrouter') {
                key = openrouterKeyInput ? openrouterKeyInput.value.trim() : '';
                model = openrouterModelSelect ? openrouterModelSelect.value : '';
            } else {
                key = geminiKeyInput ? geminiKeyInput.value.trim() : '';
                model = geminiModelSelect ? geminiModelSelect.value : '';
            }

            if (!key) {
                apiTestStatus.textContent = t('error.enter_key_first');
                apiTestStatus.style.color = 'var(--error)';
                apiTestStatus.style.display = 'block';
                return;
            }

            testApiKeyBtn.disabled = true;
            apiTestStatus.textContent = t('msg.testing_connection');
            apiTestStatus.style.color = '';
            apiTestStatus.style.display = 'block';

            try {
                const body = {
                    input: 'Hi',
                    test_only: true,
                    ai_provider: provider,
                };
                if (provider === 'openrouter') {
                    body.openrouter_api_key = key;
                    body.openrouter_model = model;
                } else {
                    body.gemini_api_key = key;
                    body.gemini_model = model;
                }

                const csrfToken = root.querySelector('input[name="csrf_token"]')?.value || '';
                const response = await fetch('ai.php', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken
                    },
                    body: JSON.stringify({ ...body, csrf_token: csrfToken }),
                });

                const result = await response.json();
                if (response.ok) {
                    apiTestStatus.textContent = t('msg.connection_success', { model });
                    apiTestStatus.style.color = 'green';
                } else {
                    apiTestStatus.textContent = t('error.connection_failed', { error: result.error || t('error.invalid_key') });
                    apiTestStatus.style.color = 'var(--error)';
                }
            } catch (error) {
                apiTestStatus.textContent = t('error.network_test_failed');
                apiTestStatus.style.color = 'var(--error)';
            } finally {
                testApiKeyBtn.disabled = false;
            }
        });
    }
}
