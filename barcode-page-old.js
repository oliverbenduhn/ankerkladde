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
function createElement(tag, className, textContent = null) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (textContent !== null) el.textContent = textContent;
    return el;
}

function renderProductDetails(payload) {
    if (!barcodeResult) return;
    barcodeResult.replaceChildren();

    const product = payload.product || {};
    const sources = payload.sources || [];
    let fields = {};
    if (sources.length > 0) {
        fields = sources[0].fields || {};
    }

    const card = createElement('section', 'barcode-summary-card');
    const headerRow = createElement('div', 'p-product-header');
    
    if (fields.image_small_url) {
        const imgWrap = createElement('div', 'p-product-image-wrapper');
        const img = createElement('img', 'p-product-image');
        img.src = fields.image_small_url;
        img.alt = fields.product_name || 'Produktbild';
        imgWrap.appendChild(img);
        headerRow.appendChild(imgWrap);
    }
    
    const titleCol = createElement('div', 'p-product-title-col');
    if (fields.brands || product.brands) {
        titleCol.appendChild(createElement('div', 'p-product-brand', fields.brands || product.brands));
    }
    titleCol.appendChild(createElement('h2', 'p-product-title', fields.product_name || product.product_name || `Artikel ${product.barcode}`));
    if (fields.quantity || product.quantity) {
        titleCol.appendChild(createElement('div', 'p-product-quantity', fields.quantity || product.quantity));
    }
    titleCol.appendChild(createElement('div', 'barcode-summary-eyebrow', `Barcode: ${product.barcode}`));
    headerRow.appendChild(titleCol);
    card.appendChild(headerRow);
    
    if (fields.nutriscore_grade || fields.nova_group || fields.labels) {
        const badgeRow = createElement('div', 'p-badge-row');
        
        if (fields.nutriscore_grade) {
            const ns = String(fields.nutriscore_grade).toLowerCase();
            const badge = createElement('div', `p-badge p-badge-nutri p-badge-nutri-${ns}`, `Nutri-Score ${ns.toUpperCase()}`);
            badgeRow.appendChild(badge);
        }
        
        if (fields.nova_group) {
            const badge = createElement('div', 'p-badge p-badge-nova', `NOVA ${fields.nova_group}`);
            badgeRow.appendChild(badge);
        }
        
        if (fields.labels) {
            const rawLabels = String(fields.labels).split(',');
            rawLabels.slice(0, 3).forEach(lbl => {
                const text = lbl.trim().replace(/^en:/i, '').replace(/^de:/i, '');
                if (text) badgeRow.appendChild(createElement('div', 'p-badge p-badge-label', text));
            });
        }
        
        card.appendChild(badgeRow);
    }
    
    if (fields.energy_kcal_100g || fields['energy-kcal_100g'] || fields.fat_100g) {
        const macros = {
            'Brennwert (kcal)': fields['energy-kcal_100g'] || fields.energy_kcal_100g,
            'Fett': fields.fat_100g,
            '  davon gesättigte Fettsäuren': fields['saturated-fat_100g'] || fields.saturated_fat_100g,
            'Kohlenhydrate': fields.carbohydrates_100g,
            '  davon Zucker': fields.sugars_100g,
            'Ballaststoffe': fields.fiber_100g,
            'Eiweiß': fields.proteins_100g,
            'Salz': fields.salt_100g
        };
        
        const table = createElement('table', 'p-nutrition-table');
        const thead = createElement('thead');
        const trHead = createElement('tr');
        trHead.appendChild(createElement('th', '', 'Nährwerte'));
        trHead.appendChild(createElement('th', '', 'pro 100g'));
        thead.appendChild(trHead);
        table.appendChild(thead);
        
        const tbody = createElement('tbody');
        Object.entries(macros).forEach(([name, val]) => {
            if (!val && val !== 0 && val !== '0') return;
            const tr = createElement('tr');
            tr.appendChild(createElement('td', '', name));
            tr.appendChild(createElement('td', '', `${val}${name.includes('kcal') ? '' : ' g'}`));
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        card.appendChild(table);
    }
    
    if (fields.ingredients_text) {
        const ingrSec = createElement('div', 'p-ingredients-sec');
        ingrSec.appendChild(createElement('h3', 'p-section-title', 'Zutaten'));
        ingrSec.appendChild(createElement('p', 'p-ingredients-text', fields.ingredients_text));
        card.appendChild(ingrSec);
    }
    
    if (fields.allergens) {
        const allg = createElement('div', 'p-allergens-warn', `Allergene: ${String(fields.allergens).replace(/^en:/gi, '').replace(/,/g, ', ')}`);
        card.appendChild(allg);
    }

    barcodeResult.appendChild(card);
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
    stopWatchdog();
    setStatus(`Lade ${barcode}...`);

    try {
        await loadBarcodeDetails(barcode);
        if ('vibrate' in navigator) navigator.vibrate(12);
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Produkt konnte nicht geladen werden.', true);
    } finally {
        window.setTimeout(() => {
            scannerState.processing = false;
            if (scannerState.running) {
                scheduleWatchdog();
            }
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

        const modeLabel = engine.mode === 'zxing' ? 'ZXing' : 'nativ';
        setStatus(`Starte ${modeLabel}-Scanner...`);

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
                await waitForVideoReady(pageVideo);
                setStatus(isIosWebKit()
                    ? 'Kamera aktiv (ZXing). Auf dem iPad/iPhone bitte ruhig halten; alternativ Barcode manuell eingeben.'
                    : 'Kamera aktiv (ZXing). Barcode in den Rahmen halten.');
                scheduleWatchdog();
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
            await waitForVideoReady(pageVideo);
        }

        scannerState.running = true;
        updateCameraButtons();
        setStatus('Kamera aktiv (nativ). Barcode in den Rahmen halten.');
        scheduleWatchdog();
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
