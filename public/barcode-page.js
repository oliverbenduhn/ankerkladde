'use strict';

import { t } from './js/i18n.js';

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

const scannerState = {
    stream: null,
    detector: null,
    controls: null,
    mode: 'native',
    rafId: 0,
    watchdogId: 0,
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
        throw new Error(t('error.session_expired'));
    }

    if (!response.ok) {
        throw new Error(payload.error || t('error.unknown'));
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
        pageCameraToggleBtn.setAttribute('aria-label', t(running ? 'barcode_page.camera_off' : 'barcode_page.camera_on'));
        pageCameraToggleBtn.classList.toggle('is-active', running);
    }
}

function isIosWebKit() {
    const userAgent = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const touchMac = platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return /iPad|iPhone|iPod/.test(userAgent) || touchMac;
}

function stopLoop() {
    if (scannerState.rafId) {
        cancelAnimationFrame(scannerState.rafId);
        scannerState.rafId = 0;
    }
}

function stopWatchdog() {
    if (scannerState.watchdogId) {
        clearTimeout(scannerState.watchdogId);
        scannerState.watchdogId = 0;
    }
}

function stopStream() {
    stopWatchdog();

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
    setStatus(t('barcode_page.stopped'));
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
        const hints = new Map();
        const zxing = window.ZXing || {};
        const barcodeFormat = zxing.BarcodeFormat || {};
        const decodeHintType = zxing.DecodeHintType || {};
        const formats = [
            barcodeFormat.EAN_13,
            barcodeFormat.EAN_8,
            barcodeFormat.UPC_A,
            barcodeFormat.UPC_E,
        ].filter(Boolean);

        if (decodeHintType.POSSIBLE_FORMATS && formats.length > 0) {
            hints.set(decodeHintType.POSSIBLE_FORMATS, formats);
        }
        if (decodeHintType.TRY_HARDER) {
            hints.set(decodeHintType.TRY_HARDER, true);
        }

        return { mode: 'zxing', detector: new window.ZXingBrowser.BrowserMultiFormatReader(hints) };
    }

    return null;
}

function waitForVideoReady(video, timeoutMs = 5000) {
    if (!video) {
        return Promise.reject(new Error('Videovorschau fehlt.'));
    }

    if (video.readyState >= 2 && video.videoWidth > 0) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error(t('barcode_page.camera_timeout')));
        }, timeoutMs);

        const onReady = () => {
            if (video.readyState < 2 || video.videoWidth === 0) {
                return;
            }
            cleanup();
            resolve();
        };

        const cleanup = () => {
            clearTimeout(timeoutId);
            video.removeEventListener('loadedmetadata', onReady);
            video.removeEventListener('canplay', onReady);
            video.removeEventListener('playing', onReady);
        };

        video.addEventListener('loadedmetadata', onReady);
        video.addEventListener('canplay', onReady);
        video.addEventListener('playing', onReady);
    });
}

function scheduleWatchdog() {
    stopWatchdog();

    scannerState.watchdogId = setTimeout(() => {
        if (!scannerState.running || scannerState.processing) {
            return;
        }

        if (scannerState.mode === 'zxing' && isIosWebKit()) {
            setStatus(t('scanner.camera_active_ios'), true);
            return;
        }

        setStatus(t('scanner.camera_active_hint'), true);
    }, 7000);
}
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
        img.alt = fields.product_name || t('barcode_page.product_image');
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
    titleCol.appendChild(createElement('div', 'barcode-summary-eyebrow', t('barcode_page.barcode_value', { barcode: product.barcode })));
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
        trHead.appendChild(createElement('th', '', t('barcode_page.nutrition')));
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
    setStatus(t('barcode_page.product_loaded', { barcode }));
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
        setStatus(error instanceof Error ? error.message : t('barcode_page.load_failed'), true);
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
    setStatus(t('barcode_page.camera_starting'));

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setStatus(t('scanner.needs_https'), true);
        pageManualInput?.focus();
        return;
    }

    try {
        const engine = await createBarcodeDetector();
        if (!engine) {
            setStatus(t('scanner.not_supported'), true);
            pageManualInput?.focus();
            return;
        }

        scannerState.mode = engine.mode;
        scannerState.detector = engine.detector;

        const modeLabel = engine.mode === 'zxing' ? 'ZXing' : 'nativ';
        setStatus(t('barcode_page.scanner_starting', { mode: modeLabel }));

        if (engine.mode === 'zxing') {
            setStatus(t('barcode_page.zxing_starting'));
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
                    ? t('scanner.camera_active_zxing_ios')
                    : t('scanner.camera_active_zxing'));
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
        setStatus(t('scanner.camera_active_native'));
        scheduleWatchdog();
        scheduleLoop();
    } catch (error) {
        stopScanner();
        setStatus(error instanceof Error ? error.message : t('barcode_page.camera_failed'), true);
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
        setStatus(t('barcode_page.enter_barcode'), true);
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
