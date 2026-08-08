import { t } from './i18n.js';
import { activateModal } from './utils.js';

export function createLightboxController() {
    let currentOverlay = null;
    let modalSession = null;

    function close() {
        modalSession?.deactivate();
        modalSession = null;
        if (currentOverlay) {
            currentOverlay.remove();
            currentOverlay = null;
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
        closeBtn.setAttribute('aria-label', t('ui.close'));
        closeBtn.textContent = '×';

        closeBtn.addEventListener('click', close);

        overlay.append(img, closeBtn);
        document.body.appendChild(overlay);
        currentOverlay = overlay;
        modalSession = activateModal(overlay, {
            initialFocus: closeBtn,
            onEscape: close,
            onBackdrop: close,
        });
    }

    return {
        open,
        close,
    };
}
