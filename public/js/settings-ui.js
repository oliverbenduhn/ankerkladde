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
    const openaiCompatibleFields = root.querySelector('#openai_compatible_fields');

    function updateProviderFields() {
        if (!providerSelect || !geminiFields || !openaiCompatibleFields) return;
        const provider = providerSelect.value;
        geminiFields.style.display = provider === 'gemini' ? '' : 'none';
        openaiCompatibleFields.style.display = provider === 'openai_compatible' ? '' : 'none';
    }

    if (providerSelect) {
        providerSelect.addEventListener('change', updateProviderFields);
        updateProviderFields();
    }

    // AI test logic
    const testApiKeyBtn = root.querySelector('#test-api-key');
    const geminiKeyInput = root.querySelector('#gemini_api_key_input');
    const geminiModelSelect = root.querySelector('#gemini_model_select');
    const openaiCompatibleKeyInput = root.querySelector('#openai_compatible_api_key_input');
    const openaiCompatibleModelInput = root.querySelector('#openai_compatible_model_input');
    const openaiCompatibleBaseUrlInput = root.querySelector('#openai_compatible_base_url_input');
    const apiTestStatus = root.querySelector('#api-test-status');

    if (testApiKeyBtn) {
        testApiKeyBtn.addEventListener('click', async () => {
            const provider = providerSelect ? providerSelect.value : 'gemini';
            let key, model, baseUrl;

            if (provider === 'openai_compatible') {
                key = openaiCompatibleKeyInput ? openaiCompatibleKeyInput.value.trim() : '';
                model = openaiCompatibleModelInput ? openaiCompatibleModelInput.value.trim() : '';
                baseUrl = openaiCompatibleBaseUrlInput ? openaiCompatibleBaseUrlInput.value.trim() : '';
            } else {
                key = geminiKeyInput ? geminiKeyInput.value.trim() : '';
                model = geminiModelSelect ? geminiModelSelect.value : '';
                baseUrl = '';
            }

            if (!key && provider !== 'openai_compatible') {
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
                if (provider === 'openai_compatible') {
                    body.openai_compatible_api_key = key;
                    body.openai_compatible_model = model;
                    body.openai_compatible_base_url = baseUrl;
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

    // AI model discovery
    const loadModelsBtn = root.querySelector('#load-models');
    const modelsLoadStatus = root.querySelector('#models-load-status');
    const openaiModelsDatalist = root.querySelector('#openai_models_datalist');
    const modelsCache = new Map(); // key: provider|baseUrl|keyHash → models[]

    function shortHash(input) {
        let h = 0;
        for (let i = 0; i < input.length; i++) {
            h = ((h << 5) - h) + input.charCodeAt(i);
            h |= 0;
        }
        return String(h);
    }

    function invalidateModelCacheForInputs() {
        if (!openaiCompatibleBaseUrlInput && !openaiCompatibleKeyInput && !geminiKeyInput) return;
        modelsCache.clear();
    }

    if (openaiCompatibleBaseUrlInput) {
        openaiCompatibleBaseUrlInput.addEventListener('input', invalidateModelCacheForInputs);
    }
    if (openaiCompatibleKeyInput) {
        openaiCompatibleKeyInput.addEventListener('input', invalidateModelCacheForInputs);
    }
    if (geminiKeyInput) {
        geminiKeyInput.addEventListener('input', invalidateModelCacheForInputs);
    }
    if (providerSelect) {
        providerSelect.addEventListener('change', invalidateModelCacheForInputs);
    }

    function showModelsLoadStatus(text, color) {
        if (!modelsLoadStatus) return;
        modelsLoadStatus.textContent = text;
        modelsLoadStatus.style.color = color || '';
        modelsLoadStatus.style.display = 'block';
    }

    function applyModelsToUi(provider, models) {
        if (provider === 'gemini' && geminiModelSelect) {
            const current = geminiModelSelect.value;
            geminiModelSelect.innerHTML = '';
            for (const m of models) {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.label;
                if (m.id === current) opt.selected = true;
                geminiModelSelect.appendChild(opt);
            }
        } else if (provider === 'openai_compatible' && openaiModelsDatalist) {
            openaiModelsDatalist.innerHTML = '';
            for (const m of models) {
                const opt = document.createElement('option');
                opt.value = m.id;
                openaiModelsDatalist.appendChild(opt);
            }
        }
    }

    if (loadModelsBtn) {
        loadModelsBtn.addEventListener('click', async () => {
            const provider = providerSelect ? providerSelect.value : 'gemini';
            let key, baseUrl, cacheKey;

            if (provider === 'openai_compatible') {
                key = openaiCompatibleKeyInput ? openaiCompatibleKeyInput.value.trim() : '';
                baseUrl = openaiCompatibleBaseUrlInput ? openaiCompatibleBaseUrlInput.value.trim() : '';
                cacheKey = 'openai_compatible|' + baseUrl + '|' + shortHash(key);
            } else {
                key = geminiKeyInput ? geminiKeyInput.value.trim() : '';
                baseUrl = '';
                cacheKey = 'gemini||' + shortHash(key);
            }

            if (!key) {
                showModelsLoadStatus(t('error.enter_key_first'), 'var(--error)');
                return;
            }

            const cached = modelsCache.get(cacheKey);
            if (cached) {
                applyModelsToUi(provider, cached);
                showModelsLoadStatus(t('msg.models_loaded', { count: cached.length }), 'green');
                return;
            }

            loadModelsBtn.disabled = true;
            showModelsLoadStatus(t('msg.loading_models'), '');

            try {
                const body = { ai_provider: provider };
                if (provider === 'openai_compatible') {
                    body.openai_compatible_api_key = key;
                    body.openai_compatible_base_url = baseUrl;
                } else {
                    body.gemini_api_key = key;
                }

                const csrfToken = root.querySelector('input[name="csrf_token"]')?.value || '';
                const response = await fetch('ai-models.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken,
                    },
                    body: JSON.stringify({ ...body, csrf_token: csrfToken }),
                });

                const result = await response.json();
                const models = Array.isArray(result.models) ? result.models : [];

                if (response.ok && models.length > 0) {
                    modelsCache.set(cacheKey, models);
                    applyModelsToUi(provider, models);
                    showModelsLoadStatus(t('msg.models_loaded', { count: models.length }), 'green');
                } else if (response.ok) {
                    showModelsLoadStatus(t('msg.no_models_found'), 'var(--error)');
                } else {
                    showModelsLoadStatus(t('error.models_load_failed', { error: result.error || t('error.invalid_key') }), 'var(--error)');
                }
            } catch (err) {
                showModelsLoadStatus(t('error.network_test_failed'), 'var(--error)');
            } finally {
                loadModelsBtn.disabled = false;
            }
        });
    }
}
