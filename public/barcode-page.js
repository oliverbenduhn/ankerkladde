'use strict';

const csrfMeta = document.querySelector('meta[name="csrf-token"]');
const appBasePathMeta = document.querySelector('meta[name="app-base-path"]');
if (!csrfMeta) throw new Error('csrf-token meta tag missing');

const appBasePath = appBasePathMeta?.content || '/';
const pageCameraToggleBtn = document.getElementById('barcodePageCameraToggleBtn');
const pageVideo = document.getElementById('barcodePageVideo');
const pageStatus = document.getElementById('barcodePageStatus');
const pageSubtitle = document.getElementById('barcodePageSubtitle');
const pageManualForm = document.getElementById('barcodePageManualForm');
const pageManualInput = document.getElementById('barcodePageManualInput');
const barcodeResult = document.getElementById('barcodeResult');
const barcodeEmptyState = document.getElementById('barcodeEmptyState');

const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
const SCAN_COOLDOWN_MS = 1800;
const FIELD_LABELS = {
    code: 'Barcode',
    product_name: 'Produktname',
    abbreviated_product_name: 'Kurzname',
    generic_name: 'Allgemeine Bezeichnung',
    quantity: 'Menge',
    brands: 'Marken',
    categories: 'Kategorien',
    main_category: 'Hauptkategorie',
    countries: 'Länder',
    stores: 'Geschäfte',
    purchase_places: 'Kauforte',
    brand_owner: 'Markeninhaber',
    packaging: 'Verpackung',
    packaging_text: 'Verpackungstext',
    labels: 'Label',
    origins: 'Herkunft',
    manufacturing_places: 'Herstellungsorte',
    emb_codes: 'Betriebscodes',
    ingredients_text: 'Zutaten',
    allergens: 'Allergene',
    traces: 'Spurenhinweise',
    serving_size: 'Portionsgröße',
    serving_quantity: 'Portionsmenge',
    no_nutrition_data: 'Keine Nährwertdaten',
    additives: 'Zusatzstoffe',
    additives_n: 'Anzahl Zusatzstoffe',
    nutriscore_score: 'Nutri-Score Punkte',
    nutriscore_grade: 'Nutri-Score',
    nova_group: 'NOVA-Gruppe',
    pnns_groups_1: 'Lebensmittelgruppe',
    pnns_groups_2: 'Untergruppe',
    food_groups: 'Food Group',
    states: 'Status',
    image_url: 'Bild',
    image_small_url: 'Kleines Bild',
    image_ingredients_url: 'Zutatenbild',
    image_nutrition_url: 'Nährwertbild',
    product_quantity: 'Produktmenge',
    owner: 'Eigentümer',
    completeness: 'Vollständigkeit',
    unique_scans_n: 'Anzahl Scans',
    last_image_t: 'Letztes Bild Zeitstempel',
    last_image_datetime: 'Letztes Bild Datum',
    energy_kj_100g: 'Energie kJ pro 100 g',
    energy_kcal_100g: 'Energie kcal pro 100 g',
    energy_100g: 'Energie pro 100 g',
    fat_100g: 'Fett pro 100 g',
    saturated_fat_100g: 'Gesättigte Fettsäuren pro 100 g',
    carbohydrates_100g: 'Kohlenhydrate pro 100 g',
    sugars_100g: 'Zucker pro 100 g',
    fiber_100g: 'Ballaststoffe pro 100 g',
    proteins_100g: 'Eiweiß pro 100 g',
    salt_100g: 'Salz pro 100 g',
    sodium_100g: 'Natrium pro 100 g',
    alcohol_100g: 'Alkohol pro 100 g',
    vitamin_a_100g: 'Vitamin A pro 100 g',
    vitamin_c_100g: 'Vitamin C pro 100 g',
    vitamin_d_100g: 'Vitamin D pro 100 g',
    calcium_100g: 'Calcium pro 100 g',
    iron_100g: 'Eisen pro 100 g',
    magnesium_100g: 'Magnesium pro 100 g',
    potassium_100g: 'Kalium pro 100 g',
    zinc_100g: 'Zink pro 100 g',
    environmental_score_score: 'Umweltscore Punkte',
    environmental_score_grade: 'Umweltscore',
    popularity_tags: 'Beliebtheit',
};

const scannerState = {
    stream: null,
    detector: null,
    controls: null,
    mode: 'native',
    rafId: 0,
    processing: false,
    running: false,
    lastValue: '',
    lastHandledAt: 0,
};

function appUrl(path) {
    return new URL(path, `${window.location.origin}${appBasePath}`).toString();
}

async function api(action) {
    const response = await fetch(appUrl(`api.php?action=${action}`));
    const payload = await response.json().catch(() => ({}));

    if (response.status === 401) {
        window.location.href = appUrl('login.php');
        throw new Error('Sitzung abgelaufen.');
    }

    if (!response.ok) {
        throw new Error(payload.error || 'Unbekannter Fehler');
    }

    return payload;
}

function normalizeBarcodeValue(value) {
    return String(value || '').replace(/\D+/g, '').trim();
}

function setStatus(text, isError = false) {
    if (!pageStatus) return;
    pageStatus.textContent = text;
    pageStatus.classList.toggle('is-error', Boolean(isError));
}

function setSubtitle(text) {
    if (pageSubtitle) pageSubtitle.textContent = text;
}

function updateCameraButtons() {
    const running = scannerState.running;
    if (pageCameraToggleBtn) {
        pageCameraToggleBtn.setAttribute('aria-label', running ? 'Kamera ausschalten' : 'Kamera einschalten');
        pageCameraToggleBtn.classList.toggle('is-active', running);
    }
}

function stopLoop() {
    if (scannerState.rafId) {
        cancelAnimationFrame(scannerState.rafId);
        scannerState.rafId = 0;
    }
}

function stopStream() {
    const stream = scannerState.stream;
    scannerState.stream = null;
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    if (pageVideo) {
        pageVideo.pause();
        pageVideo.srcObject = null;
    }
}

function stopScanner() {
    stopLoop();

    if (scannerState.controls && typeof scannerState.controls.stop === 'function') {
        scannerState.controls.stop();
        scannerState.controls = null;
    }

    stopStream();
    scannerState.detector = null;
    scannerState.mode = 'native';
    scannerState.processing = false;
    scannerState.running = false;
    updateCameraButtons();
    setStatus('Scanner gestoppt.');
}

async function createBarcodeDetector() {
    if (typeof window.BarcodeDetector === 'function') {
        let formats = BARCODE_FORMATS;
        if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
            try {
                const supported = await window.BarcodeDetector.getSupportedFormats();
                const filtered = BARCODE_FORMATS.filter(format => supported.includes(format));
                if (filtered.length > 0) formats = filtered;
            } catch {}
        }

        try {
            return { mode: 'native', detector: new window.BarcodeDetector({ formats }) };
        } catch {}
    }

    if (window.ZXingBrowser?.BrowserMultiFormatReader) {
        return { mode: 'zxing', detector: new window.ZXingBrowser.BrowserMultiFormatReader() };
    }

    return null;
}

function humanizeKey(key) {
    const normalized = String(key || '').replace(/-/g, '_');
    if (FIELD_LABELS[normalized]) {
        return FIELD_LABELS[normalized];
    }

    return key
        .replace(/_/g, ' ')
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function shouldDisplayField(key, value) {
    if (value === null || value === '') return false;

    const normalized = String(key || '').toLowerCase();
    const normalizedValue = String(value).trim().toLowerCase();

    const hiddenValues = new Set([
        '',
        'unknown',
        'en:unknown',
        'unknown unknown',
        'null',
        'n/a',
        'na',
    ]);

    if (hiddenValues.has(normalizedValue)) {
        return false;
    }

    const hiddenExact = new Set([
        'url',
        'creator',
        'created_t',
        'created_datetime',
        'last_modified_t',
        'last_modified_datetime',
        'last_modified_by',
        'last_updated_t',
        'last_updated_datetime',
        'states',
        'states_tags',
        'states_en',
        'data_quality_errors_tags',
        'popularity_tags',
        'completeness',
        'owners',
        'owner',
        'unique_scans_n',
    ]);

    if (hiddenExact.has(normalized)) {
        return false;
    }

    const hiddenPrefixes = [
        'image_',
    ];

    if (hiddenPrefixes.some(prefix => normalized.startsWith(prefix))) {
        return false;
    }

    const hiddenContains = [
        '_tags',
        '_en',
        '_datetime',
        'debug',
        'unknown',
        'selected',
        'uploaded',
        'to_be_',
        'to-be-',
    ];

    if (hiddenContains.some(part => normalized.includes(part))) {
        return false;
    }

    return true;
}

function getFieldGroup(key) {
    const normalized = String(key || '').toLowerCase();

    if ([
        'code', 'url', 'product_name', 'abbreviated_product_name', 'generic_name', 'quantity',
        'brands', 'brands_tags', 'brands_en', 'categories', 'categories_tags', 'categories_en',
        'main_category', 'main_category_en', 'countries', 'countries_tags', 'countries_en',
        'stores', 'purchase_places', 'owner', 'brand_owner'
    ].includes(normalized)) {
        return 'Allgemein';
    }

    if (normalized.startsWith('image_') || normalized.endsWith('_url') || normalized.includes('photo')) {
        return 'Bilder & Links';
    }

    if (
        normalized.includes('ingredient') ||
        normalized.includes('allergen') ||
        normalized.includes('trace') ||
        normalized.includes('additive') ||
        normalized.includes('packaging') ||
        normalized.includes('label') ||
        normalized.includes('origin')
    ) {
        return 'Inhalt & Herkunft';
    }

    if (
        normalized.includes('nutri') ||
        normalized.includes('nova') ||
        normalized.includes('energy') ||
        normalized.includes('fat') ||
        normalized.includes('sugar') ||
        normalized.includes('salt') ||
        normalized.includes('protein') ||
        normalized.includes('fiber') ||
        normalized.includes('sodium') ||
        normalized.includes('vitamin') ||
        normalized.includes('mineral') ||
        normalized.includes('calcium') ||
        normalized.includes('iron') ||
        normalized.includes('magnesium') ||
        normalized.includes('zinc') ||
        normalized.includes('potassium') ||
        normalized.endsWith('_100g')
    ) {
        return 'Nährwerte & Analyse';
    }

    return null;
}

function renderFieldList(entries) {
    const list = document.createElement('dl');
    list.className = 'barcode-field-list';

    entries.forEach(([key, value]) => {
        if (!shouldDisplayField(key, value)) return;

        const term = document.createElement('dt');
        term.textContent = humanizeKey(key);

        const description = document.createElement('dd');
        description.textContent = String(value);

        list.append(term, description);
    });

    return list;
}

function groupFields(fields) {
    const groups = new Map();

    Object.entries(fields || {}).forEach(([key, value]) => {
        if (!shouldDisplayField(key, value)) return;
        const groupName = getFieldGroup(key);
        if (!groupName) return;
        const current = groups.get(groupName) || [];
        current.push([key, value]);
        groups.set(groupName, current);
    });

    return groups;
}

function renderGroupedFields(fields) {
    const wrapper = document.createElement('div');
    wrapper.className = 'barcode-groups';

    groupFields(fields).forEach((entries, groupName) => {
        if (entries.length === 0) return;

        const section = document.createElement('section');
        section.className = 'barcode-group';

        const title = document.createElement('h4');
        title.className = 'barcode-group-title';
        title.textContent = groupName;

        section.append(title, renderFieldList(entries));
        wrapper.appendChild(section);
    });

    return wrapper;
}

function renderProductDetails(payload) {
    if (!barcodeResult) return;
    barcodeResult.replaceChildren();

    const summary = document.createElement('section');
    summary.className = 'barcode-summary-card';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'barcode-summary-eyebrow';
    eyebrow.textContent = payload.product.source || 'lokal';

    const title = document.createElement('h2');
    title.className = 'barcode-summary-title';
    title.textContent = payload.product.product_name || `Artikel ${payload.product.barcode}`;

    const meta = document.createElement('div');
    meta.className = 'barcode-summary-meta';
    meta.textContent = [
        payload.product.barcode ? `Barcode ${payload.product.barcode}` : null,
        payload.product.brands || null,
        payload.product.quantity || null,
    ].filter(Boolean).join(' • ');

    summary.append(eyebrow, title, meta);
    barcodeResult.appendChild(summary);

    (payload.sources || []).forEach(source => {
        const card = document.createElement('section');
        card.className = 'barcode-source-card';

        const heading = document.createElement('h3');
        heading.className = 'barcode-source-title';
        heading.textContent = source.dataset;

        card.appendChild(heading);
        card.appendChild(renderGroupedFields(source.fields || {}));
        barcodeResult.appendChild(card);
    });
}

async function loadBarcodeDetails(barcode) {
    const payload = await api(`product_details&barcode=${encodeURIComponent(barcode)}`);
    renderProductDetails(payload);
    if (barcodeEmptyState) barcodeEmptyState.hidden = true;
    setSubtitle(`Lokale Daten zu ${barcode}`);
    setStatus(`Produkt geladen: ${barcode}`);
}

async function handleBarcode(rawValue) {
    const barcode = normalizeBarcodeValue(rawValue);
    if (barcode.length < 8) return;

    const now = Date.now();
    if (barcode === scannerState.lastValue && now - scannerState.lastHandledAt < SCAN_COOLDOWN_MS) {
        return;
    }

    scannerState.lastValue = barcode;
    scannerState.lastHandledAt = now;
    scannerState.processing = true;
    setStatus(`Lade ${barcode}...`);

    try {
        await loadBarcodeDetails(barcode);
        if ('vibrate' in navigator) navigator.vibrate(12);
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Produkt konnte nicht geladen werden.', true);
    } finally {
        window.setTimeout(() => {
            scannerState.processing = false;
        }, 300);
    }
}

function scheduleLoop() {
    stopLoop();

    const scanFrame = async () => {
        scannerState.rafId = requestAnimationFrame(scanFrame);
        if (scannerState.processing || !scannerState.detector || !pageVideo || pageVideo.readyState < 2) {
            return;
        }

        try {
            const codes = await scannerState.detector.detect(pageVideo);
            const rawValue = codes?.[0]?.rawValue || '';
            if (rawValue) {
                await handleBarcode(rawValue);
            }
        } catch {}
    };

    scannerState.rafId = requestAnimationFrame(scanFrame);
}

async function startScanner() {
    stopScanner();
    setStatus('Kamera wird gestartet...');

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setStatus('Kamera-Scan braucht HTTPS oder localhost. Manueller Barcode-Eintrag bleibt verfügbar.', true);
        pageManualInput?.focus();
        return;
    }

    try {
        const engine = await createBarcodeDetector();
        if (!engine) {
            setStatus('Automatischer Barcode-Scan wird in diesem Browser nicht unterstützt. Manueller Barcode-Eintrag ist aktiv.', true);
            pageManualInput?.focus();
            return;
        }

        scannerState.mode = engine.mode;
        scannerState.detector = engine.detector;

        if (engine.mode === 'zxing') {
            setStatus('ZXing: Starte Kamera...');
            try {
                scannerState.controls = await scannerState.detector.decodeFromVideoDevice(
                    undefined,
                    pageVideo,
                    (result, error) => {
                        if (error) return;
                        const rawValue = typeof result?.getText === 'function' ? result.getText() : '';
                        if (rawValue) {
                            void handleBarcode(rawValue);
                        }
                    }
                );
                scannerState.running = true;
                updateCameraButtons();
                setStatus('Kamera aktiv. Barcode in den Rahmen halten.');
            } catch (err) {
                setStatus('ZXing-Fehler: ' + err.message, true);
            }
            return;
        }

        scannerState.stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' } },
        });

        if (pageVideo) {
            pageVideo.srcObject = scannerState.stream;
            await pageVideo.play();
        }

        scannerState.running = true;
        updateCameraButtons();
        setStatus('Kamera aktiv. Barcode in den Rahmen halten.');
        scheduleLoop();
    } catch (error) {
        stopScanner();
        setStatus(error instanceof Error ? error.message : 'Kamera konnte nicht gestartet werden.', true);
        pageManualInput?.focus();
    }
}

function toggleScanner() {
    if (scannerState.running) {
        stopScanner();
        return;
    }

    void startScanner();
}

pageCameraToggleBtn?.addEventListener('click', toggleScanner);

pageManualForm?.addEventListener('submit', event => {
    event.preventDefault();
    const barcode = normalizeBarcodeValue(pageManualInput?.value || '');
    if (barcode === '') {
        setStatus('Bitte Barcode eingeben.', true);
        return;
    }

    void handleBarcode(barcode);
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopScanner();
    }
});

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        stopScanner();
    }
});

setStatus('Bereit zum Scannen.');
updateCameraButtons();
void startScanner();
