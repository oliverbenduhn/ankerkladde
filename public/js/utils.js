export function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function syncAutoHeight(element) {
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
}

export function normalizeBarcodeValue(value) {
    return String(value || '').replace(/\D+/g, '').trim();
}
