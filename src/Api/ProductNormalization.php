<?php
declare(strict_types=1);

function normalizeProductTextValue(?string $value, int $maxLength = 255): string
{
    $value = html_entity_decode(trim((string) $value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $value = preg_replace('/\s+/u', ' ', $value) ?? '';
    $value = trim($value, " \t\n\r\0\x0B,;|-");

    return truncateText($value, $maxLength);
}

function normalizeProductCompareKey(string $value): string
{
    $value = normalizeProductTextValue($value, 255);
    $value = function_exists('mb_strtolower')
        ? mb_strtolower($value, 'UTF-8')
        : strtolower($value);
    $value = preg_replace('/[^[:alnum:]]+/u', '', $value) ?? '';

    return $value;
}

function formatDisplayBrandName(string $brand): string
{
    $brand = normalizeProductTextValue($brand, 120);
    if ($brand === '') {
        return '';
    }

    if (preg_match('/^[A-ZÄÖÜ0-9]+(?:-[A-ZÄÖÜ0-9]+)+$/u', $brand) === 1) {
        $parts = preg_split('/-/', $brand) ?: [];
        $parts = array_map(static function (string $part): string {
            $part = strtolower($part);
            return ucfirst($part);
        }, $parts);

        return implode('-', $parts);
    }

    return $brand;
}

function filterPreferredConsumerBrands(array $brands): array
{
    if (count($brands) <= 1) {
        return $brands;
    }

    $corporateBrands = [
        'unilever',
        'nestle',
        'cocacola',
        'pepsico',
        'mondelēzinternational',
        'mondelezinternational',
        'kraftheinz',
        'heinz',
        'danone',
        'mars',
        'ferrero',
        'generalmills',
        'kelloggs',
    ];

    $filtered = [];
    foreach ($brands as $brand) {
        $key = normalizeProductCompareKey($brand);
        if ($key === '') {
            continue;
        }

        if (in_array($key, $corporateBrands, true)) {
            continue;
        }

        $filtered[] = $brand;
    }

    return $filtered !== [] ? $filtered : $brands;
}

function normalizeProductBrandsValue(?string $brands): string
{
    $brands = normalizeProductTextValue($brands, 255);
    if ($brands === '') {
        return '';
    }

    $brands = preg_replace('/\s+\/\s+/u', ',', $brands) ?? $brands;
    $parts = preg_split('/\s*,\s*|\s*;\s*|\s+\/\s+/u', $brands) ?: [];
    $unique = [];
    $seen = [];

    foreach ($parts as $part) {
        $part = normalizeProductTextValue($part, 120);
        if ($part === '') {
            continue;
        }

        $key = normalizeProductCompareKey($part);
        if ($key === '') {
            continue;
        }

        if (isset($seen[$key])) {
            continue;
        }

        $seen[$key] = true;
        $unique[] = formatDisplayBrandName($part);
    }

    $unique = filterPreferredConsumerBrands($unique);

    return truncateText(implode(', ', $unique), 255);
}

function normalizeProductQuantityValue(?string $quantity): string
{
    $quantity = normalizeProductTextValue($quantity, 80);
    if ($quantity === '') {
        return '';
    }

    $quantity = preg_replace('/(?<=\d),(?=\d)/', '.', $quantity) ?? $quantity;
    if (preg_match('/^(\d+(?:\.\d+)?)\s*(kg|g|mg|l|ml|cl|oz|lb|gram|grams|pcs?|pieces?)$/iu', $quantity, $matches) === 1) {
        $value = (string) ($matches[1] ?? '');
        $unit = function_exists('mb_strtolower')
            ? mb_strtolower((string) ($matches[2] ?? ''), 'UTF-8')
            : strtolower((string) ($matches[2] ?? ''));

        if (preg_match('/^\d+\.0+$/', $value) === 1) {
            $value = (string) (int) $value;
        }

        $unit = match ($unit) {
            'gram', 'grams' => 'g',
            'piece', 'pieces', 'pc', 'pcs' => 'Stk.',
            default => $unit,
        };

        if (str_contains($value, '.')) {
            $value = rtrim(rtrim($value, '0'), '.');
            if (str_contains($value, '.')) {
                $value = str_replace('.', ',', $value);
            }
        }

        return truncateText($value . ' ' . $unit, 40);
    }

    return truncateText($quantity, 40);
}

function trimRepeatedBrandFromProductName(string $productName, string $brands): string
{
    $productName = normalizeProductTextValue($productName, 255);
    $brands = normalizeProductBrandsValue($brands);
    if ($productName === '' || $brands === '') {
        return $productName;
    }

    $brandParts = preg_split('/\s*,\s*/u', $brands) ?: [];
    foreach ($brandParts as $brandPart) {
        $brandPart = normalizeProductTextValue($brandPart, 120);
        if ($brandPart === '') {
            continue;
        }

        $quotedBrand = preg_quote($brandPart, '/');
        $patterns = [
            '/^' . $quotedBrand . '\s*[:\-–()]?\s*/iu',
            '/\s*\(' . $quotedBrand . '\)\s*$/iu',
        ];

        foreach ($patterns as $pattern) {
            $candidate = preg_replace($pattern, '', $productName) ?? $productName;
            $candidate = normalizeProductTextValue($candidate, 255);
            if ($candidate !== '' && $candidate !== $productName) {
                $productName = $candidate;
            }
        }
    }

    return $productName;
}

function formatProductNameDisplay(string $productName): string
{
    $productName = normalizeProductTextValue($productName, 255);
    if ($productName === '') {
        return '';
    }

    $hasUppercase = preg_match('/\p{Lu}/u', $productName) === 1;
    if ($hasUppercase) {
        return $productName;
    }

    $tokens = preg_split('/(\s+|-)/u', $productName, -1, PREG_SPLIT_DELIM_CAPTURE) ?: [$productName];
    $minorWords = [
        'und', 'oder', 'mit', 'ohne', 'aus', 'von', 'in', 'im', 'mit', 'für', 'fur',
        'de', 'du', 'la', 'le', 'des', 'del', 'da', 'di', 'van', 'von', 'the', 'and',
    ];

    $result = [];
    $wordIndex = 0;
    foreach ($tokens as $token) {
        if ($token === '' || preg_match('/^(\s+|-)$/u', $token) === 1) {
            $result[] = $token;
            continue;
        }

        if (preg_match('/^\d+[a-z]*$/u', $token) === 1) {
            $result[] = $token;
            $wordIndex++;
            continue;
        }

        $lowerToken = function_exists('mb_strtolower')
            ? mb_strtolower($token, 'UTF-8')
            : strtolower($token);

        if ($wordIndex > 0 && in_array($lowerToken, $minorWords, true)) {
            $result[] = $lowerToken;
            $wordIndex++;
            continue;
        }

        $firstChar = function_exists('mb_substr') ? mb_substr($lowerToken, 0, 1, 'UTF-8') : substr($lowerToken, 0, 1);
        $restChars = function_exists('mb_substr') ? mb_substr($lowerToken, 1, null, 'UTF-8') : substr($lowerToken, 1);
        $upperFirst = function_exists('mb_strtoupper')
            ? mb_strtoupper((string) $firstChar, 'UTF-8')
            : strtoupper((string) $firstChar);

        $result[] = $upperFirst . $restChars;
        $wordIndex++;
    }

    return normalizeProductTextValue(implode('', $result), 255);
}

function heuristicNormalizeProductData(array $product): array
{
    $brands = normalizeProductBrandsValue($product['brands'] ?? '');
    $productName = normalizeProductTextValue($product['product_name'] ?? '', 255);
    $productName = trimRepeatedBrandFromProductName($productName, $brands);
    $productName = formatProductNameDisplay($productName);

    return [
        'product_name' => $productName,
        'brands' => $brands,
        'quantity' => normalizeProductQuantityValue($product['quantity'] ?? ''),
    ];
}

function shouldUseAiForProductNormalization(array $rawProduct, array $heuristicProduct): bool
{
    $rawName = (string) ($rawProduct['product_name'] ?? '');
    $rawBrands = (string) ($rawProduct['brands'] ?? '');
    $rawQuantity = (string) ($rawProduct['quantity'] ?? '');

    $name = (string) ($heuristicProduct['product_name'] ?? '');
    $brands = (string) ($heuristicProduct['brands'] ?? '');
    $quantity = (string) ($heuristicProduct['quantity'] ?? '');

    if ($name === '' && $brands === '') {
        return false;
    }

    if ($rawName !== $name || $rawBrands !== $brands || $rawQuantity !== $quantity) {
        return true;
    }

    if (preg_match('/&(?:amp|quot|#0*39|apos|nbsp);/i', $rawName . ' ' . $rawBrands) === 1) {
        return true;
    }

    if ($name !== '' && preg_match('/^(?:x+|\d+|n\/a|null|-+)$/iu', $name) === 1) {
        return true;
    }

    if ($rawBrands !== '' && preg_match('/\s\/\s|,.*\//u', $rawBrands) === 1) {
        return true;
    }

    if ($rawBrands !== '' && preg_match('/,.*,/u', $rawBrands) === 1) {
        return true;
    }

    if ($rawName !== '' && $brands !== '' && str_starts_with(normalizeProductCompareKey($rawName), normalizeProductCompareKey(explode(',', $brands)[0] ?? ''))) {
        return true;
    }

    if ($rawQuantity !== '' && !preg_match('/^\d+(?:[.,]\d+)?\s*(kg|g|mg|l|ml|cl|oz|lb|stk\.)$/iu', $quantity) && $quantity !== '') {
        return true;
    }

    if ($name !== '' && preg_match('/^[[:lower:]\d\s\-&\/.,()]+$/u', $name) === 1) {
        return true;
    }

    return false;
}

function normalizeOpenFoodFactsProductWithAi(array $product, array $preferences): array
{
    $normalized = heuristicNormalizeProductData($product);

    $aiConfig = getActiveAiConfig($preferences);
    if ($aiConfig['key'] === '') {
        return $normalized;
    }

    if (!shouldUseAiForProductNormalization($product, $normalized)) {
        return $normalized;
    }

    $systemPrompt = <<<PROMPT
Du normalisierst uneinheitliche Produktdaten aus OpenFoodFacts fuer eine deutschsprachige Einkaufslisten-App.
Antworte AUSSCHLIESSLICH mit validem JSON in genau diesem Objektformat:
{"product_name":"","brands":"","quantity":""}

Ziel:
- product_name: kurzer, lesbarer Produktname ohne Barcode, ohne HTML-Entities, ohne unnoetige Markennamen, ohne doppelte Informationen
- brands: kommagetrennte Markenliste, dedupliziert, sauber formatiert
- quantity: moeglichst einheitlich formatiert, z.B. "230 g", "700 ml", "1 kg", "1 Stk."; sonst leer

Regeln:
1. Erfinde nichts. Wenn etwas unklar ist, uebernimm konservativ oder lasse das Feld leer.
2. Entferne offensichtlichen Datenmuell, HTML-Entities und ueberfluessige Trennzeichen.
3. product_name soll fuer Menschen gut lesbar sein und nicht nur die Marke wiederholen.
4. brands darf leer sein.
5. quantity darf nur die Gebinde-/Packungsmenge enthalten, keine Naehrwerte.
6. Behalte die Sprache des Namens bei; uebersetze keine Produktnamen.
7. Wenn product_name offensichtlich unbrauchbar ist, z.B. nur "xxx", "6666" oder leer, lass ihn leer statt etwas zu erfinden.
8. Wenn Marke und Produktname doppelte Information enthalten, halte den Produktnamen kompakt.
9. Bevorzuge im Markenfeld sichtbare Verbraucher-Marken. Entferne uebergeordnete Hersteller- oder Konzernnamen, wenn daneben konkretere Marken stehen.
10. Bewahre Sorten, Geschmacksrichtungen und Produktvarianten im product_name, auch wenn der Name dadurch etwas laenger wird.
11. Wenn die Marke am Anfang des product_name steht und separat im brands-Feld vorkommt, entferne sie aus product_name.
12. Korrigiere Gross-/Kleinschreibung vorsichtig fuer bessere Lesbarkeit, aber erfinde keine Woerter.

Lokale Beispiel-Barcodes aus der Produkttabelle:
Barcode 000000000063
Input: {"product_name":"M&amp;M white","brands":"Fitpiggy","quantity":"80 gram"}
Output: {"product_name":"M&M white","brands":"Fitpiggy","quantity":"80 g"}

Barcode 00000017
Input: {"product_name":"Collagen For Her","brands":"Bodylab","quantity":"1.0 kg"}
Output: {"product_name":"Collagen For Her","brands":"Bodylab","quantity":"1 kg"}

Barcode 00000011
Input: {"product_name":"","brands":"Kugler, Pyrat","quantity":"1pcs"}
Output: {"product_name":"","brands":"Kugler, Pyrat","quantity":"1 Stk."}

Barcode 00000027
Input: {"product_name":"Volle yoghurt","brands":"Zuivelmeester","quantity":"700ml"}
Output: {"product_name":"Volle yoghurt","brands":"Zuivelmeester","quantity":"700 ml"}

Barcode 00000119
Input: {"product_name":"Bio Flohsamenschalen gemahlen","brands":"Deto Organica, Nu U Nutrition","quantity":"500g"}
Output: {"product_name":"Bio Flohsamenschalen gemahlen","brands":"Deto Organica, Nu U Nutrition","quantity":"500 g"}

Barcode 20774370
Input: {"product_name":"Bakken &amp; braden margarine","brands":"Vita D&#039;Or","quantity":"100 gram"}
Output: {"product_name":"Bakken & braden margarine","brands":"Vita D'Or","quantity":"100 g"}

Barcode 0041220583997
Input: {"product_name":"Jamón Serrano HEB","brands":"HEB","quantity":""}
Output: {"product_name":"Jamón Serrano","brands":"HEB","quantity":""}

Barcode 00000006666
Input: {"product_name":"6666","brands":"","quantity":"1pcs"}
Output: {"product_name":"","brands":"","quantity":"1 Stk."}

Weitere kuratierte Barcode-Beispiele:
Barcode 4311501480397
Input: {"product_name":"Saucenbinder Hell","brands":"Edeka / Gut & Günstig","quantity":""}
Output: {"product_name":"Saucenbinder Hell","brands":"Edeka, Gut & Günstig","quantity":""}

Barcode 4032600122055
Input: {"product_name":"Kartoffelpüree","brands":"Maggi / Pfanni","quantity":""}
Output: {"product_name":"Kartoffelpüree","brands":"Maggi, Pfanni","quantity":""}

Barcode 4103040231017
Input: {"product_name":"Sebamed frische Deo","brands":"","quantity":""}
Output: {"product_name":"Frische Deo","brands":"sebamed","quantity":""}

Barcode 3800048221583
Input: {"product_name":"Ice Tea Passionsfrucht","brands":"Bolero","quantity":""}
Output: {"product_name":"Ice Tea Passionsfrucht","brands":"Bolero","quantity":""}

Barcode 3800048222153
Input: {"product_name":"Bolero ice tea Pfirsich","brands":"Bolero","quantity":""}
Output: {"product_name":"Ice Tea Pfirsich","brands":"Bolero","quantity":""}

Barcode 4010995004903
Input: {"product_name":"Wiha PicoFinish 260 P Schlitzschraubendreher","brands":"","quantity":""}
Output: {"product_name":"PicoFinish 260 P Schlitzschraubendreher","brands":"Wiha","quantity":""}

Barcode 4012362003922
Input: {"product_name":"Zetti Edel Marzipan","brands":"Zetti","quantity":""}
Output: {"product_name":"Edel Marzipan","brands":"Zetti","quantity":""}

Barcode 3341504003935
Input: {"product_name":"Edler Blauschimmelkäse aus Frankreich","brands":"Saint Agur","quantity":""}
Output: {"product_name":"Edler Blauschimmelkäse aus Frankreich","brands":"Saint Agur","quantity":""}

Barcode 4037300104455
Input: {"product_name":"Königsberger Klopse","brands":"Erasco","quantity":""}
Output: {"product_name":"Königsberger Klopse","brands":"Erasco","quantity":""}

Barcode 4056489336136
Input: {"product_name":"Bio Ingwer Shot Lidl","brands":"Solevita","quantity":""}
Output: {"product_name":"Bio Ingwer Shot","brands":"Solevita","quantity":""}

Barcode 4063367570117
Input: {"product_name":"Ganze Kartoffeln gekocht Kaufland","brands":"K-Classic","quantity":""}
Output: {"product_name":"Ganze Kartoffeln gekocht","brands":"K-Classic","quantity":""}

Barcode 7622202295133
Input: {"product_name":"Biscoff (Milka)","brands":"Milka","quantity":""}
Output: {"product_name":"Biscoff","brands":"Milka","quantity":""}

Weitere Testbeobachtungen:
Input: {"product_name":"Kartoffelpüree","brands":"Maggi, Pfanni, Unilever","quantity":"240g"}
Output: {"product_name":"Kartoffelpüree","brands":"Maggi, Pfanni","quantity":"240 g"}

Input: {"product_name":"Bolero ice tea","brands":"Bolero","quantity":""}
Output: {"product_name":"Ice Tea","brands":"Bolero","quantity":""}

Input: {"product_name":"ganze Kartoffeln gekocht","brands":"K-CLASSIC","quantity":"425g"}
Output: {"product_name":"Ganze Kartoffeln gekocht","brands":"K-Classic","quantity":"425 g"}

Input: {"product_name":"Saucenbinder Hell","brands":"Edeka, Gut & Günstig, Gut & Günstig / Edeka","quantity":"250g"}
Output: {"product_name":"Saucenbinder Hell","brands":"Edeka, Gut & Günstig","quantity":"250 g"}
PROMPT;

    $prompt = $systemPrompt . "\n\nInput: " . json_encode($product, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $result = callAiProvider($aiConfig['key'], $aiConfig['provider'], $aiConfig['model'], $prompt, [
        'timeout' => 30,
        'connect_timeout' => 10,
        'json_mode' => true,
        'temperature' => 0.1,
    ]);

    if (!$result['ok'] || $result['text'] === '') {
        return $normalized;
    }

    $aiText = $result['text'];

    if (preg_match('/^```(?:json)?\s*(.*?)\s*```$/s', $aiText, $matches) === 1) {
        $aiText = trim((string) ($matches[1] ?? ''));
    }

    $aiProduct = json_decode($aiText, true);
    if (!is_array($aiProduct)) {
        return $normalized;
    }

    return [
        'product_name' => normalizeProductTextValue($aiProduct['product_name'] ?? $normalized['product_name'], 255),
        'brands' => normalizeProductBrandsValue($aiProduct['brands'] ?? $normalized['brands']),
        'quantity' => normalizeProductQuantityValue($aiProduct['quantity'] ?? $normalized['quantity']),
    ];
}
