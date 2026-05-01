export function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function syncAutoHeight(element) {
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
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
