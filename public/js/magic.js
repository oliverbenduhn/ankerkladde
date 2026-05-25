import { t } from './i18n.js';
import { appUrl } from './api.js?v=4.3.4';
import { appEl, magicBtns, magicBar, magicInput, magicSubmit, magicClose, magicVoiceBtn } from './ui.js?v=4.3.4';
import { state } from './state.js?v=4.3.4';

export function createMagicController(deps) {
    const { getUserPreferences, invalidateCategoryCache, loadCategories, loadItems, setCategory, setMessage, updateHeaders } = deps;
    let recognition = null;
    let isSubmitting = false;
    let previewContainer = null;
    let pendingItems = null;

    function setMagicLoading(loading) {
        isSubmitting = loading;
        if (!magicBar) return;
        magicBar.classList.toggle('is-loading', loading);
        magicBar.setAttribute('aria-busy', loading ? 'true' : 'false');
        if (magicInput) magicInput.disabled = loading;
        if (magicSubmit) magicSubmit.disabled = loading;
        if (magicVoiceBtn) magicVoiceBtn.disabled = loading;
        if (magicClose) magicClose.disabled = loading;
    }

    function openMagic() {
        if (getUserPreferences().magic_button_enabled === false) {
            setMessage('Der Magic Button ist in den Einstellungen deaktiviert.', true);
            return;
        }
        if (!magicBar) return;

        document.dispatchEvent(new CustomEvent('ankerkladde-close-bars'));

        magicBar.hidden = false;
        appEl.classList.add('is-magic-active');
        magicBtns.forEach(btn => btn.classList.add('is-active'));
        magicInput.focus();
    }

    function closePreview() {
        if (previewContainer) {
            previewContainer.remove();
            previewContainer = null;
        }
        pendingItems = null;
    }

    function closeMagic(force = false) {
        if (isSubmitting && !force) return;
        if (!magicBar) return;
        closePreview();
        magicBar.hidden = true;
        appEl.classList.remove('is-magic-active');
        magicBtns.forEach(btn => btn.classList.remove('is-active'));
        magicInput.value = '';
        magicInput.placeholder = t('ui.magic_placeholder');
        if (recognition) {
            recognition.stop();
        }
    }

    function renderPreview(items) {
        closePreview();
        pendingItems = items;

        previewContainer = document.createElement('div');
        previewContainer.className = 'magic-preview';

        const header = document.createElement('div');
        header.className = 'magic-preview-header';
        header.textContent = items.length + (items.length === 1 ? ' Eintrag' : ' Einträge') + ' erkannt:';
        previewContainer.appendChild(header);

        const list = document.createElement('ul');
        list.className = 'magic-preview-list';
        items.forEach((item, index) => {
            const li = document.createElement('li');
            li.className = 'magic-preview-item';
            li.dataset.index = index;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.className = 'magic-preview-check';
            checkbox.setAttribute('aria-label', 'Auswahl ' + item.name);
            li.appendChild(checkbox);

            const info = document.createElement('span');
            info.className = 'magic-preview-info';
            let label = item.name;
            if (item.quantity) label += ' (' + item.quantity + ')';
            info.textContent = label;
            li.appendChild(info);

            const cat = document.createElement('span');
            cat.className = 'magic-preview-cat';
            cat.textContent = item.category_name;
            li.appendChild(cat);

            list.appendChild(li);
        });
        previewContainer.appendChild(list);

        const actions = document.createElement('div');
        actions.className = 'magic-preview-actions';

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'magic-preview-confirm';
        confirmBtn.textContent = t('ui.magic_confirm');
        confirmBtn.addEventListener('click', () => confirmPreview());
        actions.appendChild(confirmBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'magic-preview-cancel';
        cancelBtn.textContent = t('ui.magic_cancel');
        cancelBtn.addEventListener('click', () => {
            closePreview();
            magicInput.value = '';
            magicInput.focus();
        });
        actions.appendChild(cancelBtn);

        previewContainer.appendChild(actions);
        magicBar.parentNode.insertBefore(previewContainer, magicBar.nextSibling);
    }

    async function confirmPreview() {
        if (!pendingItems || isSubmitting) return;

        // Collect only checked items
        const checkboxes = previewContainer.querySelectorAll('.magic-preview-check');
        const selectedItems = pendingItems.filter((_, i) => checkboxes[i]?.checked);

        if (selectedItems.length === 0) {
            setMessage(t('msg.magic_none_selected'), true);
            return;
        }

        setMagicLoading(true);
        try {
            const response = await fetch(appUrl('ai.php'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'confirm', items: selectedItems, input: '' })
            });

            const rawText = await response.text();
            let result = {};
            try {
                result = rawText ? JSON.parse(rawText) : {};
            } catch {
                throw new Error(rawText || 'Speichern fehlgeschlagen');
            }

            if (!response.ok) {
                throw new Error(result.error || 'Speichern fehlgeschlagen');
            }

            setMessage(result.toast_message || 'Erledigt!');

            // Invalidate cache for all affected categories
            const affectedCategoryIds = new Set(selectedItems.map(item => Number(item.category_id)));
            for (const catId of affectedCategoryIds) {
                invalidateCategoryCache(catId);
            }

            const targetCategoryId = Number(result.target_category_id);
            if (Number.isInteger(targetCategoryId) && targetCategoryId > 0) {
                await setCategory(targetCategoryId);
            } else {
                await loadCategories();
                await loadItems();
                updateHeaders();
            }

            closeMagic(true);
        } catch (error) {
            console.error('[Magic] Confirm error:', error);
            setMessage(error.message, true);
        } finally {
            setMagicLoading(false);
        }
    }

    function startVoiceRecognition() {
        if (isSubmitting) return;
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setMessage(t('msg.speech_not_supported'), true);
            return;
        }

        if (recognition) {
            recognition.stop();
            return;
        }

        recognition = new SpeechRecognition();
        const langMap = { de: 'de-DE', en: 'en-US' };
        recognition.lang = langMap[window.__lang] || 'de-DE';
        recognition.interimResults = true;

        recognition.onstart = () => {
            magicVoiceBtn.classList.add('is-listening');
            magicInput.placeholder = t('msg.listening');
        };

        recognition.onresult = (event) => {
            const transcript = Array.from(event.results)
                .map(result => result[0])
                .map(result => result.transcript)
                .join('');

            magicInput.value = transcript;

            if (event.results[0].isFinal) {
                recognition.stop();
                submitMagic();
            }
        };

        recognition.onerror = (event) => {
            console.error('[Magic Voice] Error:', event.error);
            magicVoiceBtn.classList.remove('is-listening');
            magicInput.placeholder = t('ui.magic_placeholder');
            if (event.error !== 'no-speech') {
                setMessage('Sprachfehler: ' + event.error, true);
            }
            recognition = null;
        };

        recognition.onend = () => {
            magicVoiceBtn.classList.remove('is-listening');
            magicInput.placeholder = t('ui.magic_placeholder');
            recognition = null;
        };

        recognition.start();
    }

    async function submitMagic() {
        if (isSubmitting) return;
        if (getUserPreferences().magic_button_enabled === false) {
            setMessage('Der Magic Button ist in den Einstellungen deaktiviert.', true);
            return;
        }
        const input = magicInput.value.trim();
        if (!input) return;

        closePreview();
        setMagicLoading(true);
        setMessage(t('msg.magic_working'));

        try {
            const activeCategoryId = Number(state.categoryId) || 0;
            const response = await fetch(appUrl('ai.php'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input, active_category_id: activeCategoryId, mode: 'preview' })
            });

            const rawText = await response.text();
            let result = {};
            try {
                result = rawText ? JSON.parse(rawText) : {};
            } catch {
                throw new Error(rawText || 'KI-Anfrage fehlgeschlagen');
            }

            if (!response.ok) {
                throw new Error(result.error || 'KI-Anfrage fehlgeschlagen');
            }

            // Handle clarification from AI
            if (result.clarification) {
                setMagicLoading(false);
                magicInput.value = '';
                magicInput.placeholder = result.clarification;
                magicInput.focus();
                setMessage('');
                return;
            }

            // Show preview
            if (result.preview && result.items?.length > 0) {
                setMagicLoading(false);
                setMessage('');
                renderPreview(result.items);
                return;
            }

            setMessage(t('msg.magic_no_results'), true);
        } catch (error) {
            console.error('[Magic] Error:', error);
            setMessage(error.message, true);
        } finally {
            setMagicLoading(false);
        }
    }

    return {
        openMagic,
        closeMagic,
        submitMagic,
        startVoiceRecognition,
        toggleMagic: () => {
            if (magicBar.hidden) {
                openMagic();
            } else {
                closeMagic();
            }
        }
    };
}
