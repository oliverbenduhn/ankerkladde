import { api } from './api.js?v=4.2.57';
import { BARCODE_FORMATS, isBarcodeCategory, isIosWebKit, isScannerSupported, scannerState, state } from './state.js?v=4.2.57';
import { itemForm, itemInput, quantityInput, scannerManualInput, scannerOverlay, scannerStatus, scannerSubtitle, scannerVideo } from './ui.js?v=4.2.57';
import { normalizeBarcodeValue, syncAutoHeight } from './utils.js?v=4.2.57';

export function createScannerController(deps) {
    /**
     * @typedef {Object} ScannerControllerDeps
     * @property {function(): Object|null} getCurrentCategory
     * @property {function(number): Object|null} getItemById
     * @property {function(): number} getScannerCooldownMs
     * @property {function(): string[]} getScannerSupportedFormats
     * @property {function(): Object} getUserPreferences
     * @property {function(number, number): Promise<void>} handleToggle
     * @property {function(number): void} invalidateCategoryCache
     * @property {function(number=, Object=): Promise<void>} loadItems
     * @property {Object} navigation
     * @property {function(string, boolean=): void} setMessage
     * @property {function(string, boolean=): void} setScannerStatus
     * @property {function(): void} triggerHapticFeedback
     * @property {function(string): void} updateFilePickerLabel
     */

    /** @type {ScannerControllerDeps} */
    const {
        getCurrentCategory,
        getItemById,
        getScannerCooldownMs,
        getScannerSupportedFormats,
        getUserPreferences,
        handleToggle,
        invalidateCategoryCache,
        loadItems,
        navigation,
        setMessage,
        setScannerStatus,
        triggerHapticFeedback,
        updateFilePickerLabel,
    } = deps;

    function getScannerActionLabel() {
        return scannerState.action === 'toggle' ? 'Eintrag abhaken' : 'Artikel hinzufügen';
    }

    function updateScannerSubtitle() {
        if (!scannerSubtitle) return;
        scannerSubtitle.textContent = scannerState.action === 'toggle'
            ? 'Barcode scannt offene Einträge der aktuellen Liste und hakt sie ab.'
            : 'Barcode scannt Produkte und legt sie direkt in der aktuellen Liste an.';
    }

    function stopScannerLoop() {
        if (scannerState.rafId) {
            window.cancelAnimationFrame(scannerState.rafId);
            scannerState.rafId = 0;
        }
    }

    function stopScannerWatchdog() {
        if (scannerState.watchdogId) {
            window.clearTimeout(scannerState.watchdogId);
            scannerState.watchdogId = 0;
        }
    }

    function stopScannerStream() {
        stopScannerWatchdog();

        const controls = scannerState.controls;
        scannerState.controls = null;
        if (controls && typeof controls.stop === 'function') {
            controls.stop();
        }

        const stream = scannerState.stream;
        scannerState.stream = null;

        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }

        if (scannerVideo) {
            scannerVideo.pause();
            scannerVideo.srcObject = null;
        }
    }

    function closeScanner() {
        stopScannerLoop();
        stopScannerStream();
        scannerState.detector = null;
        scannerState.mode = 'native';
        scannerState.processing = false;
        scannerState.open = false;
        if (scannerOverlay) scannerOverlay.hidden = true;
    }

    async function createBarcodeDetector() {
        if (typeof window.BarcodeDetector === 'function') {
            let formats = getScannerSupportedFormats();
            if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
                try {
                    const supported = await window.BarcodeDetector.getSupportedFormats();
                    const filtered = getScannerSupportedFormats().filter(format => supported.includes(format));
                    if (filtered.length > 0) {
                        formats = filtered;
                    }
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
            const timeoutId = window.setTimeout(() => {
                cleanup();
                reject(new Error('Kamerabild wurde nicht rechtzeitig bereit.'));
            }, timeoutMs);

            const onReady = () => {
                if (video.readyState < 2 || video.videoWidth === 0) {
                    return;
                }
                cleanup();
                resolve();
            };

            const cleanup = () => {
                window.clearTimeout(timeoutId);
                video.removeEventListener('loadedmetadata', onReady);
                video.removeEventListener('canplay', onReady);
                video.removeEventListener('playing', onReady);
            };

            video.addEventListener('loadedmetadata', onReady);
            video.addEventListener('canplay', onReady);
            video.addEventListener('playing', onReady);
        });
    }

    function scheduleScannerWatchdog() {
        stopScannerWatchdog();

        scannerState.watchdogId = window.setTimeout(() => {
            if (!scannerState.open || scannerState.processing) {
                return;
            }

            if (scannerState.mode === 'zxing' && isIosWebKit()) {
                setScannerStatus('Kamera aktiv. Auf iPad/iPhone erkennt WebKit Barcodes nicht immer zuverlässig. Falls nichts passiert, Barcode unten manuell eingeben.', true);
                return;
            }

            setScannerStatus('Kamera aktiv. Falls kein Scan erkannt wird, Barcode unten manuell eingeben.', true);
        }, 7000);
    }

    async function lookupProductByBarcode(barcode) {
        try {
            const payload = await api(`product_lookup&barcode=${encodeURIComponent(barcode)}`);
            return payload?.product || null;
        } catch {
            return null;
        }
    }

    async function addItemFromBarcode(barcode) {
        const category = getCurrentCategory();
        if (!isBarcodeCategory(category)) {
            throw new Error('Barcode-Scan ist nur in Einkaufslisten verfügbar.');
        }

        const product = await lookupProductByBarcode(barcode);
        const productName = typeof product?.product_name === 'string' ? product.product_name.trim() : '';
        const brandName = typeof product?.brands === 'string' ? product.brands.trim() : '';
        const name = productName !== ''
            ? (brandName !== '' ? `${productName} (${brandName})` : productName)
            : (brandName !== '' ? brandName : `Artikel ${barcode}`);
        const body = new URLSearchParams({
            category_id: String(category.id),
            name,
            barcode,
        });

        const quantity = quantityInput?.value.trim() || product?.quantity?.trim() || '';
        if (quantity !== '') {
            body.set('quantity', quantity);
        }

        await api('add', { method: 'POST', body });
        itemForm?.reset();
        syncAutoHeight(itemInput);
        updateFilePickerLabel();
        invalidateCategoryCache(category.id);
        await loadItems();
        setMessage(`${name} hinzugefügt.`);
    }

    async function toggleItemFromBarcode(barcode) {
        const category = getCurrentCategory();
        if (!isBarcodeCategory(category)) {
            throw new Error('Barcode-Scan ist nur in Einkaufslisten verfügbar.');
        }

        const openItem = state.items.find(item => item.barcode === barcode && item.done !== 1) || null;
        if (openItem) {
            await handleToggle(openItem.id, 1);
            setMessage(`${openItem.name} abgehakt.`);
            return;
        }

        const doneItem = state.items.find(item => item.barcode === barcode) || null;
        if (doneItem) {
            throw new Error(`${doneItem.name} ist bereits abgehakt.`);
        }

        throw new Error('Kein offener Eintrag mit diesem Barcode in der aktuellen Liste gefunden.');
    }

    async function handleScannedBarcode(rawValue) {
        const barcode = normalizeBarcodeValue(rawValue);
        if (barcode.length < 8) return;

        const now = Date.now();
        if (barcode === scannerState.lastValue && now - scannerState.lastHandledAt < getScannerCooldownMs()) {
            return;
        }

        scannerState.lastValue = barcode;
        scannerState.lastHandledAt = now;
        scannerState.processing = true;
        stopScannerWatchdog();
        setScannerStatus(`${getScannerActionLabel()}: ${barcode}`);

        try {
            if (scannerState.action === 'toggle') {
                await toggleItemFromBarcode(barcode);
            } else {
                await addItemFromBarcode(barcode);
            }
            triggerHapticFeedback();
            setScannerStatus(`Erfolgreich: ${barcode}`);
            window.setTimeout(() => {
                if (scannerState.open) {
                    navigation.navigateBackOrReplace({ screen: 'list' });
                }
            }, 180);
        } catch (error) {
            setScannerStatus(error instanceof Error ? error.message : 'Barcode konnte nicht verarbeitet werden.', true);
        } finally {
            window.setTimeout(() => {
                scannerState.processing = false;
                if (scannerState.open) {
                    scheduleScannerWatchdog();
                }
            }, 350);
        }
    }

    function scheduleScannerLoop() {
        stopScannerLoop();

        const scanFrame = async () => {
            if (!scannerState.open) return;
            scannerState.rafId = window.requestAnimationFrame(scanFrame);

            if (scannerState.processing || !scannerState.detector || !scannerVideo || scannerVideo.readyState < 2) {
                return;
            }

            try {
                const barcodes = await scannerState.detector.detect(scannerVideo);
                const rawValue = barcodes?.[0]?.rawValue || '';
                if (rawValue) {
                    await handleScannedBarcode(rawValue);
                }
            } catch {}
        };

        scannerState.rafId = window.requestAnimationFrame(scanFrame);
    }

    async function openScanner(action = state.mode === 'einkaufen' ? 'toggle' : 'add') {
        if (scannerState.open) {
            return;
        }
        if (getUserPreferences().shopping_list_scanner_enabled === false) {
            setMessage('Die Scanfunktion für die Einkaufsliste ist in den Einstellungen deaktiviert.', true);
            return;
        }
        const category = getCurrentCategory();
        if (!isBarcodeCategory(category)) {
            setMessage('Barcode-Scan ist nur in Einkaufslisten verfügbar.', true);
            return;
        }
        if (state.noteEditorId !== null || state.search.open) {
            setMessage('Scanner ist während Suche oder Notizbearbeitung nicht verfügbar.', true);
            return;
        }

        scannerState.action = action;
        scannerState.processing = false;
        scannerState.lastValue = '';
        scannerState.lastHandledAt = 0;
        scannerState.controls = null;
        scannerState.open = true;
        updateScannerSubtitle();
        setScannerStatus('Kamera wird vorbereitet…');
        if (scannerOverlay) scannerOverlay.hidden = false;
        if (scannerManualInput) scannerManualInput.value = '';

        if (!isScannerSupported()) {
            setScannerStatus('Kamera-Scan braucht HTTPS oder localhost. Manueller Barcode-Eintrag bleibt verfügbar.', true);
            scannerManualInput?.focus();
            return;
        }

        try {
            const engine = await createBarcodeDetector();
            if (!engine) {
                setScannerStatus('Automatischer Barcode-Scan wird in diesem Browser nicht unterstützt. Manueller Barcode-Eintrag ist aktiv.', true);
                scannerManualInput?.focus();
                return;
            }

            scannerState.mode = engine.mode;
            scannerState.detector = engine.detector;

            const modeLabel = engine.mode === 'zxing' ? 'ZXing' : 'nativ';
            setScannerStatus(`Starte ${modeLabel}-Scanner...`);

            if (engine.mode === 'zxing') {
                setScannerStatus('ZXing: Starte Kamera...');
                try {
                    scannerState.controls = await scannerState.detector.decodeFromVideoDevice(
                        undefined,
                        scannerVideo,
                        (result, error) => {
                            if (error) return;
                            const rawValue = typeof result?.getText === 'function' ? result.getText() : '';
                            if (rawValue) {
                                void handleScannedBarcode(rawValue);
                            }
                        }
                    );
                    await waitForVideoReady(scannerVideo);
                    setScannerStatus(isIosWebKit()
                        ? 'Kamera aktiv (ZXing). Auf dem iPad/iPhone bitte ruhig halten; alternativ Barcode unten manuell eingeben.'
                        : 'Kamera aktiv (ZXing). Barcode in den Rahmen halten.');
                    scheduleScannerWatchdog();
                } catch (err) {
                    setScannerStatus('ZXing-Fehler: ' + err.message, true);
                }
                return;
            }

            scannerState.stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    facingMode: { ideal: 'environment' },
                },
            });

            if (scannerVideo) {
                scannerVideo.srcObject = scannerState.stream;
                await scannerVideo.play();
                await waitForVideoReady(scannerVideo);
            }

            setScannerStatus('Kamera aktiv (nativ). Barcode in den Rahmen halten.');
            scheduleScannerWatchdog();
            scheduleScannerLoop();
        } catch (error) {
            stopScannerStream();
            setScannerStatus(error instanceof Error ? error.message : 'Kamera konnte nicht gestartet werden.', true);
            scannerManualInput?.focus();
        }
    }

    return {
        closeScanner,
        openScanner,
        handleScannedBarcode,
    };
}
