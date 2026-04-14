export function createLightboxController() {
    let currentOverlay = null;
    let onKeyHandler = null;

    function close() {
        if (currentOverlay) {
            currentOverlay.remove();
            currentOverlay = null;
        }
        if (onKeyHandler) {
            document.removeEventListener('keydown', onKeyHandler);
            onKeyHandler = null;
        }
    }

    function open(src, alt) {
        close();

        const overlay = document.createElement('div');
        overlay.className = 'lightbox-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', alt);

        const img = document.createElement('img');
        img.className = 'lightbox-img';
        img.src = src;
        img.alt = alt;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'lightbox-close';
        closeBtn.setAttribute('aria-label', 'Schließen');
        closeBtn.textContent = '×';

        const close = () => {
            overlay.remove();
            if (onKeyHandler) {
                document.removeEventListener('keydown', onKeyHandler);
                onKeyHandler = null;
            }
            currentOverlay = null;
        };

        onKeyHandler = (event) => {
            if (event.key === 'Escape') close();
        };

        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) close();
        });
        document.addEventListener('keydown', onKeyHandler);

        overlay.append(img, closeBtn);
        document.body.appendChild(overlay);
        closeBtn.focus();
        currentOverlay = overlay;
    }

    return {
        open,
        close,
    };
}