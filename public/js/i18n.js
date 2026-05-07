// @ts-check

/** @type {Record<string, string>} */
const strings = window.__i18n || {};

/**
 * Translate a key with optional placeholder replacement.
 * Placeholders use {name} syntax.
 *
 * @param {string} key
 * @param {Record<string, string>} [params]
 * @returns {string}
 */
export function t(key, params = {}) {
    let text = strings[key] ?? key;
    for (const [k, v] of Object.entries(params)) {
        text = text.replaceAll(`{${k}}`, v);
    }
    return text;
}
