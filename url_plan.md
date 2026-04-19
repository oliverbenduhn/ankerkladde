# Plan: Datei von URL laden (files-Kategorie)

## Context

In der `files`-Kategorie können Nutzer bisher nur Dateien vom Gerät hochladen. Der Wunsch ist, alternativ eine URL eingeben zu können — PHP lädt die Datei dann serverseitig herunter und speichert sie wie einen normalen Upload.

---

## Änderungen

### 1. `public/index.php` — HTML-Toggle (Zeilen 158–165)

Das bestehende `file-input-group`-div erhält:
- Einen Segmented-Control-Toggle (zwei Buttons: „Datei wählen" / „Von URL laden"), sichtbar nur in `files`-Kategorien
- Ein neues `urlImportArea`-div mit `<input type="url" id="urlImportInput">`

```html
<div class="file-input-group" id="fileInputGroup" hidden>
    <div class="upload-mode-toggle" id="uploadModeToggle" hidden>
        <button type="button" class="upload-mode-btn is-active" id="uploadModeFile" aria-pressed="true">Datei wählen</button>
        <button type="button" class="upload-mode-btn" id="uploadModeUrl" aria-pressed="false">Von URL laden</button>
    </div>
    <div id="filePickerArea">
        <label for="fileInput" class="file-picker-button" id="filePickerButton">Datei wählen</label>
        <input type="file" id="fileInput" name="attachment" hidden>
        <button type="button" id="cameraBtn" class="file-picker-button btn-camera" hidden aria-label="Foto aufnehmen"><?= icon('camera') ?></button>
        <input type="file" id="cameraInput" accept="image/*" capture="environment" hidden>
        <span class="file-picker-name" id="filePickerName">Keine Datei ausgewählt</span>
    </div>
    <div id="urlImportArea" hidden>
        <input type="url" id="urlImportInput" placeholder="https://example.com/datei.pdf"
               inputmode="url" autocomplete="off" autocorrect="off"
               class="url-import-input" aria-label="Datei-URL">
    </div>
    <span class="disk-free-display" id="diskFreeDisplay" hidden></span>
</div>
```

### 2. `public/js/ui.js` — Neue Element-Exporte

```js
export const uploadModeToggle = document.getElementById('uploadModeToggle');
export const uploadModeFileBtn = document.getElementById('uploadModeFile');
export const uploadModeUrlBtn = document.getElementById('uploadModeUrl');
export const filePickerArea = document.getElementById('filePickerArea');
export const urlImportArea = document.getElementById('urlImportArea');
export const urlImportInput = document.getElementById('urlImportInput');
```

### 3. `public/js/app-ui.js` — Upload-Modus-Logik

- Neue lokale Variable `let uploadMode = 'file'` im Controller
- Neue Funktion `setUploadMode(mode)`: schaltet `aria-pressed`, `is-active`-Klasse, `hidden` auf `filePickerArea`/`urlImportArea`
- `updateUploadUi()` anpassen:
  - `uploadModeToggle.hidden = type !== 'files'` (Toggle nur bei `files` sichtbar)
  - Beim Kategoriewechsel `setUploadMode('file')` zurücksetzen
  - Submit-Button sichtbar machen wenn Modus `url`: `submitBtn.hidden = uploadCategory && uploadMode === 'file'`
- `setUploadMode` und `getUploadMode` im Return-Objekt exportieren

### 4. `public/js/app-events.js` — Toggle-Events

```js
uploadModeFileBtn?.addEventListener('click', () => { setUploadMode('file'); updateUploadUi(); });
uploadModeUrlBtn?.addEventListener('click', () => { setUploadMode('url'); updateUploadUi(); urlImportInput?.focus(); });
```

(`setUploadMode`/`updateUploadUi` kommen via `deps` aus `appUiController`)

### 5. `public/js/items-actions.js` — URL-Import-Funktion

Neue Funktion `importFileFromUrl()` nach `uploadSelectedAttachment` (Zeile 191):

```js
async function importFileFromUrl() {
    const category = getCurrentCategory();
    if (!category || category.type !== 'files') return;
    const url = urlImportInput?.value.trim() || '';
    if (!url) { setMessage('Bitte gib eine URL ein.', true); return; }
    try {
        const p = new URL(url);
        if (!['http:', 'https:'].includes(p.protocol)) { setMessage('Nur HTTP(S)-URLs erlaubt.', true); return; }
    } catch { setMessage('Ungültige URL.', true); return; }

    const body = new URLSearchParams({ category_id: String(category.id), url, name: itemInput.value.trim() });
    setMessage('Datei wird geladen…');
    await api('import_url', { method: 'POST', body });
    resetItemForm();
    if (urlImportInput) urlImportInput.value = '';
    invalidateCategoryCache(category.id);
    await loadItems();
    setMessage('Datei importiert.');
}
```

`addItem()` (Zeile 212–214) anpassen:
```js
if (isAttachmentCategory(category.type)) {
    if (getUploadMode() === 'url' && category.type === 'files') {
        await importFileFromUrl();
    } else {
        await uploadSelectedAttachment();
    }
    return;
}
```

### 6. `public/api.php` — Backend-Endpunkt

#### Neue Hilfsfunktionen (nach `validateFileUpload`, Zeile ~1284)

**`validateSsrfSafeUrl(string $url): void`**  
Nutzt die bestehende `isAllowedRemoteUrl()` (Zeile 195–218), die bereits:
- Nur `http`/`https` erlaubt
- `localhost` blockt
- Private IP-Ranges via `FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE` blockt
- DNS-Lookup mit IP-Prüfung durchführt

**`extractFilenameFromUrl(string $url): string`**  
`basename(rawurldecode(parse_url($url, PHP_URL_PATH)))` → `normalizeOriginalFilename()`

**`extractFilenameFromContentDisposition(string $header): string`**  
Parst `filename*=UTF-8''...` (RFC 5987, hat Priorität) und `filename="..."`.

**`downloadRemoteFile(string $url): array`**  
- Wenn cURL verfügbar: `curl_init()` mit `CURLOPT_FILE` (schreibt direkt in temp-Datei), `CURLOPT_FOLLOWLOCATION`, `CURLOPT_MAXREDIRS => 5`, `CURLOPT_CONNECTTIMEOUT => 10`, `CURLOPT_TIMEOUT => 120`, `CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS`, `CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS`, PROGRESSFUNCTION bricht bei > 500 MB ab
- Fallback: `stream_copy_to_stream()` mit Limit
- Gibt `['tmp_path', 'size_bytes', 'original_name', 'content_type']` zurück oder `['error' => '...']`

#### Neuer `case 'import_url':` (nach `case 'upload':`, Zeile ~1920)

```php
case 'import_url':
    requireMethod('POST');
    $data = requestData();
    if (!isApiKeyAuthRequest()) requireCsrfToken($data);

    $category = requireCategory($data, $db, $userId);
    validateCategoryType($category, ['files'], 'URL-Import nur in Dateien-Kategorien.');

    $importUrl = trim((string) ($data['url'] ?? ''));
    validateSsrfSafeUrl($importUrl);

    $name = normalizeName($data['name'] ?? null);
    $downloaded = downloadRemoteFile($importUrl);

    if (isset($downloaded['error'])) respond(422, ['error' => $downloaded['error']]);

    // Datei-Validierung (analog validateFileUpload)
    $extension = normalizeStoredExtension(pathinfo($downloaded['original_name'], PATHINFO_EXTENSION));
    $mediaType  = detectMimeType($downloaded['tmp_path']);
    if ($extension === '') $extension = normalizeStoredExtension(MIME_TYPE_EXTENSIONS[$mediaType] ?? '');

    $storedName = buildStoredFilename('files', $extension);
    $targetPath = getAttachmentStorageDirectory('files') . '/' . $storedName;

    $db->beginTransaction();
    try {
        // INSERT items + rename tmp → targetPath + INSERT attachments
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack(); @unlink($targetPath); @unlink($downloaded['tmp_path']);
        throw $e;
    }

    respond(201, ['message' => 'Datei importiert.', 'id' => $itemId]);
```

### 7. CSS — Upload-Mode-Toggle

Neue Styles in `public/css/main.css` (oder inline in `index.php`):
- `.upload-mode-toggle`: flexbox, gap, margin-bottom
- `.upload-mode-btn`: Pill-Style, `is-active`-Klasse hebt aktiven Button hervor
- `.url-import-input`: volle Breite, gleicher Style wie andere Inputs

---

## Sicherheit

- SSRF: `isAllowedRemoteUrl()` deckt private Ranges, Loopback, DNS-Rebinding-Basis ab; cURL-Protokollrestriktion als Defense-in-Depth
- 500 MB hartes Limit via cURL PROGRESSFUNCTION
- 120s Timeout
- Redirect-Protokolle auf HTTP/HTTPS beschränkt
- Zufälliger `stored_name` (kein Zusammenhang zur Quell-URL)
- Kein Ausführen der heruntergeladenen Datei

---

## Verifikation

1. PHP-Syntax: `php -l public/api.php`
2. Smoke-Test: `bash scripts/smoke-test.sh`
3. Manuell testen:
   - `files`-Kategorie aufrufen → Toggle erscheint
   - „Von URL laden" klicken → URL-Input sichtbar, Submit-Button erscheint
   - Gültige URL eintragen (z.B. öffentliche PDF-URL) → Import funktioniert
   - Eintrag erscheint in der Liste mit Dateiname und Download-Link
   - `images`-Kategorie: kein Toggle sichtbar
   - Ungültige URL: Fehlermeldung
   - `localhost`-URL: wird geblockt

---

## Kritische Dateien

- `public/index.php` (Zeilen 158–165) — HTML
- `public/js/ui.js` — Element-Exporte
- `public/js/app-ui.js` (Zeilen 97–144) — Upload-UI-Logik
- `public/js/app-events.js` — Event-Listener
- `public/js/items-actions.js` (Zeilen 171–214) — Upload/Import-Logik
- `public/api.php` (Zeilen ~1284, ~1920) — Backend-Endpunkt
- `public/css/main.css` — Toggle-Styles
