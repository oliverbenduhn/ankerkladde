import { appUrl } from './api.js?v=4.2.69';
import { appEl, magicBtns, magicBar, magicInput, magicSubmit, magicClose, magicVoiceBtn } from './ui.js?v=4.2.69';

export function createMagicController(deps) {
    const { getUserPreferences, loadCategories, loadItems, setCategory, setMessage, updateHeaders } = deps;
    let recognition = null;

    function openMagic() {
        if (getUserPreferences().magic_button_enabled === false) {
            setMessage('Der Magic Button ist in den Einstellungen deaktiviert.', true);
            return;
        }
        if (!magicBar) return;
        
        // Close other bars if needed (handled by app-events usually, but good to be sure)
        document.dispatchEvent(new CustomEvent('ankerkladde-close-bars'));
        
        magicBar.hidden = false;
        appEl.classList.add('is-magic-active');
        magicBtns.forEach(btn => btn.classList.add('is-active'));
        magicInput.focus();
    }

    function closeMagic() {
        if (!magicBar) return;
        magicBar.hidden = true;
        appEl.classList.remove('is-magic-active');
        magicBtns.forEach(btn => btn.classList.remove('is-active'));
        magicInput.value = '';
        if (recognition) {
            recognition.stop();
        }
    }

    function startVoiceRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setMessage('Spracherkennung wird von diesem Browser nicht unterstützt.', true);
            return;
        }

        if (recognition) {
            recognition.stop();
            return;
        }

        recognition = new SpeechRecognition();
        recognition.lang = 'de-DE';
        recognition.interimResults = true;

        recognition.onstart = () => {
            magicVoiceBtn.classList.add('is-listening');
            magicInput.placeholder = 'Höre zu...';
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
            magicInput.placeholder = 'KI-Befehl...';
            if (event.error !== 'no-speech') {
                setMessage('Sprachfehler: ' + event.error, true);
            }
            recognition = null;
        };

        recognition.onend = () => {
            magicVoiceBtn.classList.remove('is-listening');
            magicInput.placeholder = 'KI-Befehl...';
            recognition = null;
        };

        recognition.start();
    }

    async function submitMagic() {
        if (getUserPreferences().magic_button_enabled === false) {
            setMessage('Der Magic Button ist in den Einstellungen deaktiviert.', true);
            return;
        }
        const input = magicInput.value.trim();
        if (!input) return;

        magicBar.classList.add('is-loading');
        setMessage('Magie wird gewirkt...');

        try {
            const response = await fetch(appUrl('ai.php'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input })
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

            setMessage(result.toast_message || result.message || 'Erledigt!');

            const targetCategoryId = Number(result.target_category_id);
            if (Number.isInteger(targetCategoryId) && targetCategoryId > 0) {
                await setCategory(targetCategoryId);
            } else {
                await loadCategories();
                await loadItems();
                updateHeaders();
            }
            
            closeMagic();
        } catch (error) {
            console.error('[Magic] Error:', error);
            setMessage(error.message, true);
        } finally {
            magicBar.classList.remove('is-loading');
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
