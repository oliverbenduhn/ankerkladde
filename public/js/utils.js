export function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function syncAutoHeight(element) {
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
}

const MODAL_FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'summary',
    'textarea:not([disabled])',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

function visibleModalFocusTargets(modal) {
    return Array.from(modal.querySelectorAll(MODAL_FOCUSABLE_SELECTOR)).filter(element => {
        if (!(element instanceof HTMLElement) || element.hidden) return false;
        if (element.closest('[hidden], [inert]')) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    });
}

/**
 * Applies the complete accessibility contract for custom modal overlays.
 * The overlay remains owned by its controller; this helper only manages
 * semantics, sibling isolation, focus trapping and focus restoration.
 */
export function activateModal(modal, {
    initialFocus = null,
    onEscape = null,
    onBackdrop = null,
    additionalBackground = [],
    fallbackFocus = null,
} = {}) {
    if (!(modal instanceof HTMLElement)) {
        return { deactivate() {} };
    }

    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const siblingBackground = [];
    let foregroundBranch = modal;
    let parent = modal.parentElement;
    while (parent && parent !== document.documentElement) {
        siblingBackground.push(...Array.from(parent.children).filter(element => (
            element instanceof HTMLElement && element !== foregroundBranch
        )));
        foregroundBranch = parent;
        parent = parent.parentElement;
    }
    const backgroundStates = [...new Set([...siblingBackground, ...additionalBackground])]
        .filter(element => element instanceof HTMLElement && element !== modal)
        .map(element => ({
                element,
                inert: element.inert,
                ariaHidden: element.getAttribute('aria-hidden'),
            }));
    const role = modal.getAttribute('role');
    const ariaModal = modal.getAttribute('aria-modal');
    let active = true;

    modal.setAttribute('role', role || 'dialog');
    modal.setAttribute('aria-modal', 'true');
    backgroundStates.forEach(({ element }) => {
        element.inert = true;
        element.setAttribute('aria-hidden', 'true');
    });

    function focusInitial() {
        const requested = typeof initialFocus === 'function' ? initialFocus() : initialFocus;
        const target = requested instanceof HTMLElement ? requested : visibleModalFocusTargets(modal)[0];
        if (target instanceof HTMLElement && target.isConnected) {
            target.focus({ preventScroll: true });
            return;
        }
        if (!modal.hasAttribute('tabindex')) modal.tabIndex = -1;
        modal.focus({ preventScroll: true });
    }

    function handleKeydown(event) {
        if (!active) return;
        if (event.key === 'Escape' && typeof onEscape === 'function') {
            event.preventDefault();
            event.stopPropagation();
            onEscape();
            return;
        }
        if (event.key !== 'Tab') return;

        const targets = visibleModalFocusTargets(modal);
        if (targets.length === 0) {
            event.preventDefault();
            modal.focus({ preventScroll: true });
            return;
        }
        const first = targets[0];
        const last = targets[targets.length - 1];
        const focused = document.activeElement;
        if (event.shiftKey && (focused === first || !modal.contains(focused))) {
            event.preventDefault();
            last.focus({ preventScroll: true });
        } else if (!event.shiftKey && (focused === last || !modal.contains(focused))) {
            event.preventDefault();
            first.focus({ preventScroll: true });
        }
    }

    function handleClick(event) {
        if (active && event.target === modal && typeof onBackdrop === 'function') {
            onBackdrop();
        }
    }

    document.addEventListener('keydown', handleKeydown, true);
    modal.addEventListener('click', handleClick);
    focusInitial();

    return {
        deactivate({ restoreFocus = true } = {}) {
            if (!active) return;
            active = false;
            document.removeEventListener('keydown', handleKeydown, true);
            modal.removeEventListener('click', handleClick);
            backgroundStates.forEach(({ element, inert, ariaHidden }) => {
                element.inert = inert;
                if (ariaHidden === null) element.removeAttribute('aria-hidden');
                else element.setAttribute('aria-hidden', ariaHidden);
            });
            if (role === null) modal.removeAttribute('role');
            else modal.setAttribute('role', role);
            if (ariaModal === null) modal.removeAttribute('aria-modal');
            else modal.setAttribute('aria-modal', ariaModal);
            if (restoreFocus) {
                const fallback = typeof fallbackFocus === 'function' ? fallbackFocus() : fallbackFocus;
                const triggerCanReceiveFocus = trigger?.isConnected
                    && !trigger.hidden
                    && trigger.tabIndex >= 0
                    && !trigger.closest('[hidden], [inert]');
                const target = triggerCanReceiveFocus ? trigger : fallback;
                if (target instanceof HTMLElement
                    && target.isConnected
                    && !target.hidden
                    && target.tabIndex >= 0
                    && !target.closest('[hidden], [inert]')) {
                    target.focus({ preventScroll: true });
                }
            }
        },
        focusInitial,
    };
}

export const ITEM_FIELD_LIMITS = Object.freeze({
    name: 120,
    barcode: 64,
    quantity: 40,
    due_date: 10,
    content: 8000,
    url: 2048,
    category_id: 20,
    id: 20,
    done: 1,
    status: 20,
    is_pinned: 1,
});

export const OFFLINE_QUEUE_MAX_BYTES = 4 * 1024 * 1024;
export const OFFLINE_QUEUE_ITEM_MAX_BYTES = 16 * 1024;

export function limitText(value, maxLength) {
    const text = String(value ?? '');
    return text.length > maxLength ? text.slice(0, maxLength) : text;
}

export function normalizeBarcodeValue(value) {
    return limitText(String(value || '').replace(/\D+/g, '').trim(), ITEM_FIELD_LIMITS.barcode);
}

export function sanitizeItemField(name, value) {
    const rawValue = String(value ?? '');
    const limit = ITEM_FIELD_LIMITS[name];
    if (!Number.isInteger(limit)) return rawValue;

    if (name === 'barcode') {
        return normalizeBarcodeValue(rawValue);
    }
    if (name === 'due_date') {
        return limitText(rawValue.trim(), limit);
    }
    if (name === 'url') {
        return limitText(rawValue.trim(), limit);
    }
    if (['category_id', 'id', 'done', 'is_pinned'].includes(name)) {
        return limitText(rawValue.trim(), limit);
    }
    return limitText(rawValue, limit);
}

export function sanitizeItemPayload(payload) {
    return Object.fromEntries(
        Object.entries(payload || {}).map(([key, value]) => [key, sanitizeItemField(key, value)])
    );
}
