// Minimaler JSON-Parse-Guard fuer Draft-Stores. Gibt den Fallback-Wert
// zurueck, wenn `raw` kein JSON ist oder der Parse fehlschlaegt (z. B.
// bei korrupten sessionStorage-Eintraegen aus frueheren Versionen).

export function safeJsonParse(raw, fallback) {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}
