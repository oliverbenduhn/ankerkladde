import {
    panelsKey,
    categoriesKey,
    scrollKey,
    flashStorageKey,
    openCategoryKey,
} from './settings-state.js?v=4.3.11';

export function renderFlash(message, type = 'ok') {
    if (!message) return;

    const currentFlash = document.querySelector('.settings-flash[data-settings-flash="transient"]');
    if (currentFlash) {
        currentFlash.remove();
    }

    const flash = document.createElement('div');
    flash.className = `settings-flash settings-flash-${type === 'err' ? 'err' : 'ok'}`;
    flash.dataset.settingsFlash = 'transient';
    flash.setAttribute('role', 'alert');
    flash.textContent = message;
    document.body.appendChild(flash);
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

export function initUIHandling() {
    const settingsPanels = Array.from(document.querySelectorAll('details[data-settings-panel]'));
    const categoryRows = Array.from(document.querySelectorAll('form.settings-category-row'));

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
            window.scrollTo({ top: Number(saved) || 0, behavior: 'auto' });
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
                    renderFlash(parsedFlash.message, parsedFlash.type || 'ok');
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
    document.querySelectorAll(nonInteractiveAssetSelector).forEach(element => {
        if (element instanceof HTMLImageElement) {
            element.draggable = false;
        }
    });

    document.addEventListener('dragstart', event => {
        if (event.target instanceof Element && event.target.closest(nonInteractiveAssetSelector)) {
            event.preventDefault();
        }
    });

    document.addEventListener('contextmenu', event => {
        if (event.target instanceof Element && event.target.closest(nonInteractiveAssetSelector)) {
            event.preventDefault();
        }
    });

    // API Key logic
    const copyButton = document.getElementById('copy-api-key');
    const apiKeyInput = document.getElementById('api-key-value');
    if (copyButton && apiKeyInput) {
        copyButton.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(apiKeyInput.value);
                copyButton.textContent = 'Kopiert';
                window.setTimeout(() => {
                    copyButton.textContent = 'Kopieren';
                }, 1500);
            } catch (error) {
                copyButton.textContent = 'Nicht kopierbar';
            }
        });
    }

    // Gemini test logic
    const testApiKeyBtn = document.getElementById('test-api-key');
    const geminiKeyInput = document.getElementById('gemini_api_key_input');
    const geminiModelSelect = document.getElementById('gemini_model_select');
    const apiTestStatus = document.getElementById('api-test-status');

    if (testApiKeyBtn && geminiKeyInput && geminiModelSelect) {
        testApiKeyBtn.addEventListener('click', async () => {
            const key = geminiKeyInput.value.trim();
            const model = geminiModelSelect.value;
            if (!key) {
                apiTestStatus.textContent = 'Bitte zuerst einen Key eingeben.';
                apiTestStatus.style.color = 'var(--error)';
                apiTestStatus.style.display = 'block';
                return;
            }

            testApiKeyBtn.disabled = true;
            apiTestStatus.textContent = 'Teste Verbindung...';
            apiTestStatus.style.color = '';
            apiTestStatus.style.display = 'block';

            try {
                const response = await fetch('ai.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ input: 'Hi', test_only: true, gemini_api_key: key, gemini_model: model })
                });

                const result = await response.json();
                if (response.ok) {
                    apiTestStatus.textContent = '✅ Verbindung erfolgreich mit ' + model + '!';
                    apiTestStatus.style.color = 'green';
                } else {
                    apiTestStatus.textContent = '❌ Fehler: ' + (result.error || 'Ungültiger Key');
                    apiTestStatus.style.color = 'var(--error)';
                }
            } catch (error) {
                apiTestStatus.textContent = '❌ Netzwerkfehler beim Testen.';
                apiTestStatus.style.color = 'var(--error)';
            } finally {
                testApiKeyBtn.disabled = false;
            }
        });
    }
}
