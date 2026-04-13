## Einkaufslisten-Barcode-Scanner - Checkliste

### 1. Kamera-Zugriff im Browser

- `navigator.mediaDevices.getUserMedia(...)`
- Laeuft nur in sicherem Kontext:
- `https://`
- oder lokal `http://localhost`
- Bei Zugriff ueber IP im LAN ist meist `https` noetig

### 2. Barcode-Erkennung

- Entweder `BarcodeDetector` nutzen
- Oder Fallback mit `html5-qrcode` oder ZXing
- Fuer Produkt-Barcodes wichtig:
- `ean_13`
- `ean_8`
- `upc_a`
- `upc_e`

### 3. Produktdaten-Quelle

- Nach dem Scan hast du erstmal nur die Barcode-Nummer
- Fuer den Produktnamen brauchst du eine Datenbank oder API, z. B. Open Food Facts
- Beispiel:

```js
fetch(`https://world.openfoodfacts.net/api/v2/product/${barcode}`)
```

### 4. Ablauf im Projekt

- Benutzer klickt auf `Scan starten`
- Kamera wird geoeffnet
- Barcode wird gelesen
- Gelesene Nummer wird an die Produkt-API geschickt
- Antwort enthaelt z. B. `product.product_name`
- Name wird in die Einkaufsliste uebernommen

### 5. Minimaler technischer Flow

```js
const stream = await navigator.mediaDevices.getUserMedia({
  video: { facingMode: "environment" }
});

// Barcode lesen -> ergibt z.B. "4008400402222"

const response = await fetch(
  `https://world.openfoodfacts.net/api/v2/product/${barcode}`
);
const data = await response.json();

const productName = data?.product?.product_name || "Unbekanntes Produkt";
```

### 6. Was du im UI brauchst

- Button `Scan starten`
- Bereich fuer Kamera-Preview
- Ladezustand
- Fehleranzeige
- Callback wie:

```js
addItemToShoppingList(productName);
```

### 7. Wichtige Stolperfallen

- Kein `file://`
- Kamera-Berechtigung muss erlaubt sein
- `BarcodeDetector` laeuft nicht ueberall, deshalb Fallback einplanen
- Nicht jeder Barcode ist in Open Food Facts vorhanden

### Kurz gesagt

Du brauchst Kamera, Barcode-Scanner und Produkt-API. Der Scanner liefert die Barcode-Zahl, die API liefert daraus den Produktnamen.
