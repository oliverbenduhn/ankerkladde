import { appEl, magicBtn, magicBar, magicInput, magicSubmit, magicClose } from './ui.js';

export function createMagicController(deps) {
    const { loadCategories, loadItems, setMessage, updateHeaders } = deps;

    function openMagic() {
        if (!magicBar) return;
        
        // Close other bars if needed (handled by app-events usually, but good to be sure)
        document.dispatchEvent(new CustomEvent('ankerkladde-close-bars'));
        
        magicBar.hidden = false;
        appEl.classList.add('is-magic-active');
        magicBtn.classList.add('is-active');
        magicInput.focus();
    }

    function closeMagic() {
        if (!magicBar) return;
        magicBar.hidden = true;
        appEl.classList.remove('is-magic-active');
        magicBtn.classList.remove('is-active');
        magicInput.value = '';
    }

    async function submitMagic() {
        const input = magicInput.value.trim();
        if (!input) return;

        magicBar.classList.add('is-loading');
        setMessage('Magie wird gewirkt...');

        try {
            const response = await fetch('ai.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'KI-Anfrage fehlgeschlagen');
            }

            setMessage(result.message || 'Erledigt!');
            
            // Reload everything to show new items
            await loadCategories();
            await loadItems();
            updateHeaders();
            
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
        toggleMagic: () => {
            if (magicBar.hidden) {
                openMagic();
            } else {
                closeMagic();
            }
        }
    };
}
