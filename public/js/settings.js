(() => {
    const settingsDataEl = document.getElementById('settings-data');
    const settingsData = settingsDataEl ? JSON.parse(settingsDataEl.textContent) : {};
    
    const allThemeColors = settingsData.allThemeColors || {};
    const themePreferences = settingsData.themePreferences || {};
    const settingsStorageScope = settingsData.settingsStorageScope || '';
    const localPrefsStorageKey = 'ankerkladde_local_prefs';
    const scrollKey = 'einkauf-settings-scroll-y:' + settingsStorageScope;
    const panelsKey = 'einkauf-settings-open-panels:' + settingsStorageScope;
    const categoriesKey = 'einkauf-settings-open-categories:' + settingsStorageScope;
    const copyButton = document.getElementById('copy-api-key');
    const apiKeyInput = document.getElementById('api-key-value');
    const testApiKeyBtn = document.getElementById('test-api-key');
    const geminiKeyInput = document.getElementById('gemini_api_key_input');
    const geminiModelSelect = document.getElementById('gemini_model_select');
    const apiTestStatus = document.getElementById('api-test-status');
    const settingsPanels = Array.from(document.querySelectorAll('details[data-settings-panel]'));
    const categoryRows = Array.from(document.querySelectorAll('form.settings-category-row'));
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

    const saved = window.sessionStorage.getItem(scrollKey);
    const themeMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function readLocalPrefs() {
        try {
            const raw = window.localStorage.getItem(localPrefsStorageKey);
            return raw ? JSON.parse(raw) : {};
        } catch (error) {
            return {};
        }
    }

    function saveLocalPrefs(patch) {
        try {
            window.localStorage.setItem(localPrefsStorageKey, JSON.stringify({ ...readLocalPrefs(), ...patch }));
        } catch (error) {}
    }

    function getLocalThemePreferences() {
        const localPrefs = readLocalPrefs();
        return {
            theme_mode: typeof localPrefs.theme_mode === 'string' ? localPrefs.theme_mode : themePreferences.theme_mode,
            light_theme: typeof localPrefs.light_theme === 'string' ? localPrefs.light_theme : themePreferences.light_theme,
            dark_theme: typeof localPrefs.dark_theme === 'string' ? localPrefs.dark_theme : themePreferences.dark_theme,
        };
    }

    function getLocalBooleanPreference(key, fallback) {
        const localPrefs = readLocalPrefs();
        return typeof localPrefs[key] === 'boolean' ? localPrefs[key] : fallback;
    }

    function applyThemePreferencePatch(patch) {
        themePreferences.theme_mode = patch.theme_mode || themePreferences.theme_mode || 'auto';
        themePreferences.light_theme = patch.light_theme || themePreferences.light_theme || 'hafenblau';
        themePreferences.dark_theme = patch.dark_theme || themePreferences.dark_theme || 'nachtwache';
    }

    function getLocalFormPatch(form) {
        const patch = {};
        const categorySwipeInput = form.querySelector('input[name="category_swipe_enabled"]');
        if (categorySwipeInput instanceof HTMLInputElement) {
            patch.category_swipe_enabled = categorySwipeInput.checked;
        }
        return patch;
    }

    function stripLocalPreferenceFields(formData) {
        formData.delete('category_swipe_enabled');
        return formData;
    }

    function getFormActionUrl(form) {
        return form.getAttribute('action') || window.location.href;
    }

    function syncThemeFormControls() {
        const themeForm = document.querySelector('form[data-theme-form="1"]');
        if (!(themeForm instanceof HTMLFormElement)) return;

        const findInput = (name, value) => Array.from(themeForm.querySelectorAll(`input[name="${name}"]`))
            .find(input => input instanceof HTMLInputElement && input.value === value);
        const themeMode = findInput('theme_mode', themePreferences.theme_mode || 'auto');
        const lightTheme = findInput('light_theme', themePreferences.light_theme || 'hafenblau');
        const darkTheme = findInput('dark_theme', themePreferences.dark_theme || 'nachtwache');

        if (themeMode instanceof HTMLInputElement) themeMode.checked = true;
        if (lightTheme instanceof HTMLInputElement) lightTheme.checked = true;
        if (darkTheme instanceof HTMLInputElement) darkTheme.checked = true;
    }

    applyThemePreferencePatch(getLocalThemePreferences());

    function readOpenPanels() {
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

    function readOpenCategories() {
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

    function saveOpenPanels() {
        try {
            const openPanels = settingsPanels
                .filter(panel => panel.open)
                .map(panel => panel.dataset.settingsPanel)
                .filter(Boolean);
            window.localStorage.setItem(panelsKey, JSON.stringify(openPanels));
        } catch (error) {}
    }

    function saveOpenCategories() {
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

    function getEffectiveTheme() {
        const mode = themePreferences.theme_mode === 'dark'
            ? 'dark'
            : (themePreferences.theme_mode === 'light' ? 'light' : 'auto');
        const prefersDark = Boolean(themeMediaQuery?.matches);

        if (mode === 'dark') {
            return themePreferences.dark_theme || 'nachtwache';
        }

        if (mode === 'light') {
            return themePreferences.light_theme || 'hafenblau';
        }

        return prefersDark
            ? (themePreferences.dark_theme || 'nachtwache')
            : (themePreferences.light_theme || 'hafenblau');
    }

    function updateAutoModeDot() {
        const dot = document.querySelector('.theme-mode-dot-auto');
        if (!dot) return;
        const lightColor = allThemeColors[themePreferences.light_theme] || '#cfe0ec';
        const darkColor  = allThemeColors[themePreferences.dark_theme]  || '#162338';
        dot.style.background = `conic-gradient(${lightColor} 0deg 180deg, ${darkColor} 180deg 360deg)`;
    }

    function applySettingsTheme() {
        const theme = getEffectiveTheme();
        document.documentElement.dataset.theme = theme;
        if (document.body) {
            document.body.dataset.theme = theme;
        }

        const themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (themeColorMeta && themePreferences.theme_colors?.[theme]) {
            themeColorMeta.setAttribute('content', themePreferences.theme_colors[theme]);
        }

        document.querySelectorAll('img.brand-mark').forEach(image => {
            try {
                const url = new URL(image.src, window.location.href);
                url.searchParams.set('theme', theme);
                image.src = url.toString();
            } catch (error) {}
        });

        updateAutoModeDot();
    }

    function renderFlash(message, type = 'ok') {
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

    function postPreferencesUpdate(preferences) {
        if (!preferences || typeof preferences !== 'object' || !window.parent || window.parent === window) {
            return;
        }

        window.parent.postMessage({
            type: 'ankerkladde-settings-preferences-update',
            preferences,
        }, window.location.origin);
    }

    applySettingsTheme();
    syncThemeFormControls();
    const categorySwipeInput = document.querySelector('input[name="category_swipe_enabled"]');
    if (categorySwipeInput instanceof HTMLInputElement) {
        categorySwipeInput.checked = getLocalBooleanPreference('category_swipe_enabled', categorySwipeInput.checked);
    }

    const savedPanels = readOpenPanels();
    if (savedPanels !== null) {
        const openPanels = new Set(savedPanels);
        settingsPanels.forEach(panel => {
            panel.open = openPanels.has(panel.dataset.settingsPanel || '');
        });
    }

    settingsPanels.forEach(panel => {
        panel.addEventListener('toggle', () => {
            saveOpenPanels();
        });
    });

    if (saved !== null) {
        window.sessionStorage.removeItem(scrollKey);
        window.requestAnimationFrame(() => {
            window.scrollTo({ top: Number(saved) || 0, behavior: 'auto' });
        });
    }

    const flashStorageKey = 'einkauf-settings-flash:' + settingsStorageScope;

    const savedFlash = window.sessionStorage.getItem(flashStorageKey);
    if (savedFlash) {
        window.sessionStorage.removeItem(flashStorageKey);
        try {
            const parsedFlash = JSON.parse(savedFlash);
            if (parsedFlash && parsedFlash.message) {
                // Ensure flash is rendered after DOM is ready
                window.requestAnimationFrame(() => {
                    renderFlash(parsedFlash.message, parsedFlash.type || 'ok');
                });
            }
        } catch (error) {}
    }

    const openCategoryKey = 'einkauf-settings-open-category:' + scrollKey;

    categoryRows.forEach(form => {
        const details = form.querySelector('.settings-category-details');
        if (details instanceof HTMLDetailsElement) {
            details.addEventListener('toggle', () => {
                saveOpenCategories();
            });
        }
    });

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
        saveOpenCategories();
    }

    const autoSaveControllers = new WeakMap();

    document.querySelectorAll('form[data-auto-submit=\"change\"]').forEach(form => {
        form.addEventListener('change', event => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
                return;
            }

            const actionUrl = form.getAttribute('action') || window.location.href;

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
                renderFlash('Theme für dieses Gerät gespeichert.');
                return;
            }

            const localFormPatch = getLocalFormPatch(form);
            if (form.dataset.localPreferences === '1') {
                if (Object.keys(localFormPatch).length > 0) {
                    saveLocalPrefs(localFormPatch);
                    postPreferencesUpdate(localFormPatch);
                    renderFlash('Einstellung für dieses Gerät gespeichert.');
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

    window.addEventListener('message', event => {
        if (event.origin !== window.location.origin) return;
        if (window.parent && event.source !== window.parent) return;
        if (event.data?.type !== 'ankerkladde-theme-update') return;

        const nextPreferences = event.data?.preferences;
        if (!nextPreferences || typeof nextPreferences !== 'object') return;

        applyThemePreferencePatch(nextPreferences);
        saveLocalPrefs({
            theme_mode: themePreferences.theme_mode,
            light_theme: themePreferences.light_theme,
            dark_theme: themePreferences.dark_theme,
        });
        syncThemeFormControls();
        applySettingsTheme();
    });

    if (themeMediaQuery) {
        const onThemeChange = () => {
            if (themePreferences.theme_mode === 'auto') {
                applySettingsTheme();
            }
        };

        if (typeof themeMediaQuery.addEventListener === 'function') {
            themeMediaQuery.addEventListener('change', onThemeChange);
        } else if (typeof themeMediaQuery.addListener === 'function') {
            themeMediaQuery.addListener(onThemeChange);
        }
    }

    (function initCategoryDragReorder() {
        const categoryList = document.querySelector('[data-category-list]');
        if (!categoryList) return;

        let dragEl = null;
        let pointerStartY = 0;
        let dragMoved = false;
        let activeHandle = null;
        let activePointerId = null;

        function getCategoryOrder() {
            return Array.from(categoryList.querySelectorAll('.settings-category-row'))
                .map(row => parseInt(row.dataset.categoryId || '', 10))
                .filter(id => id > 0);
        }

        function moveDraggedCategory(y) {
            if (!dragEl) return;

            const rows = Array.from(categoryList.querySelectorAll('.settings-category-row:not(.settings-category-dragging)'));
            let insertBefore = null;

            for (const item of rows) {
                const rect = item.getBoundingClientRect();
                if (y < rect.top + rect.height / 2) {
                    insertBefore = item;
                    break;
                }
            }

            if (insertBefore) {
                categoryList.insertBefore(dragEl, insertBefore);
            } else {
                categoryList.appendChild(dragEl);
            }
        }

        function cleanupDragListeners() {
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
            document.removeEventListener('pointercancel', onPointerCancel);
        }

        async function persistCategoryOrder() {
            const order = getCategoryOrder();
            if (!order.length) return;

            const csrfToken = (categoryList.querySelector('input[name="csrf_token"]') || document.querySelector('input[name="csrf_token"]'))?.value || '';
            try {
                await fetch(window.location.href, {
                    method: 'POST',
                    headers: { 'Accept': 'application/json', 'X-Requested-With': 'fetch' },
                    body: new URLSearchParams({ action: 'reorder_categories', csrf_token: csrfToken, order: JSON.stringify(order) }),
                });
            } catch (_) {}
        }

        function resetDragState(pointerId = activePointerId) {
            if (dragEl) {
                dragEl.classList.remove('settings-category-dragging');
            }
            try {
                if (pointerId !== null) activeHandle?.releasePointerCapture?.(pointerId);
            } catch (_) {}
            dragEl = null;
            activeHandle = null;
            activePointerId = null;
            dragMoved = false;
        }

        function onPointerMove(e) {
            if (!dragEl || e.pointerId !== activePointerId) return;

            e.preventDefault();
            const y = e.clientY;
            const dy = Math.abs(y - pointerStartY);
            if (dy > 4) dragMoved = true;

            if (!dragMoved) return;

            moveDraggedCategory(y);
        }

        function onPointerUp(e) {
            if (!dragEl || e.pointerId !== activePointerId) return;
            e.preventDefault();
            cleanupDragListeners();
            const wasDragged = dragMoved;
            resetDragState(e.pointerId);

            if (wasDragged) {
                void persistCategoryOrder();
            }
        }

        function onPointerCancel(e) {
            if (!dragEl || e.pointerId !== activePointerId) return;
            cleanupDragListeners();
            resetDragState(e.pointerId);
        }

        categoryList.addEventListener('pointerdown', (e) => {
            const handle = e.target.closest('.settings-drag-handle');
            if (!handle) return;
            const row = handle.closest('.settings-category-row');
            if (!row) return;

            e.preventDefault();
            e.stopPropagation();
            dragEl = row;
            activeHandle = handle;
            dragMoved = false;
            activePointerId = e.pointerId;
            pointerStartY = e.clientY;
            dragEl.classList.add('settings-category-dragging');
            handle.setPointerCapture(e.pointerId);

            document.addEventListener('pointermove', onPointerMove, { passive: false });
            document.addEventListener('pointerup', onPointerUp);
            document.addEventListener('pointercancel', onPointerCancel);
        });

        categoryList.addEventListener('click', (e) => {
            if (e.target.closest('.settings-drag-handle')) {
                e.preventDefault();
                e.stopPropagation();
            }
        });

    })();
})();
