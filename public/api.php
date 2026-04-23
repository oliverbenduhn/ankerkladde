<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require __DIR__ . '/theme.php';

enforceCanonicalRequest();
startAppSession();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const IMAGE_UPLOAD_MIME_TYPES = [
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
    'image/webp' => 'webp',
    'image/gif' => 'gif',
];
const MIME_TYPE_EXTENSIONS = [
    'application/pdf' => 'pdf',
    'application/zip' => 'zip',
    'application/x-zip-compressed' => 'zip',
    'application/gzip' => 'gz',
    'application/x-tar' => 'tar',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' => 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation' => 'pptx',
    'application/msword' => 'doc',
    'application/vnd.ms-excel' => 'xls',
    'application/vnd.ms-powerpoint' => 'ppt',
    'text/plain' => 'txt',
    'text/csv' => 'csv',
    'text/html' => 'html',
    'audio/mpeg' => 'mp3',
    'audio/ogg' => 'ogg',
    'audio/wav' => 'wav',
    'audio/flac' => 'flac',
    'audio/mp4' => 'm4a',
    'video/mp4' => 'mp4',
    'video/webm' => 'webm',
    'video/quicktime' => 'mov',
    'video/x-matroska' => 'mkv',
    'video/x-msvideo' => 'avi',
];

function respond(int $status, array $payload): never
{
    if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT', 'PATCH', 'DELETE']) && $status >= 200 && $status < 300) {
        $wsUrl = getenv('WS_NOTIFY_URL') ?: 'http://127.0.0.1:3000/notify';
        if (function_exists('curl_init')) {
            $ch = curl_init($wsUrl);
            if ($ch !== false) {
                curl_setopt_array($ch, [
                    CURLOPT_CUSTOMREQUEST => 'POST',
                    CURLOPT_POSTFIELDS => json_encode(['action' => 'update']),
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_TIMEOUT_MS => 150,
                    CURLOPT_NOSIGNAL => true,
                    CURLOPT_HTTPHEADER => ['Content-Type: application/json']
                ]);
                curl_exec($ch);
                curl_close($ch);
            }
        } else {
            $context = stream_context_create([
                'http' => [
                    'method' => 'POST',
                    'header' => 'Content-Type: application/json',
                    'content' => json_encode(['action' => 'update']),
                    'timeout' => 0.15,
                    'ignore_errors' => true
                ]
            ]);
            @file_get_contents($wsUrl, false, $context);
        }
    }

    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function requireMethod(string $expectedMethod): void
{
    if ($_SERVER['REQUEST_METHOD'] !== $expectedMethod) {
        header('Allow: ' . $expectedMethod);
        respond(405, ['error' => sprintf('Nur %s ist für diese Aktion erlaubt.', $expectedMethod)]);
    }
}

function requestData(): array
{
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && $_POST !== []) {
        return $_POST;
    }

    $raw = file_get_contents('php://input');
    if (!$raw) {
        return [];
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function requestPath(string $path): string
{
    $scriptName = $_SERVER['SCRIPT_NAME'] ?? '';
    $directory = str_replace('\\', '/', dirname(is_string($scriptName) ? $scriptName : ''));

    if ($directory === '/' || $directory === '.') {
        $directory = '';
    }

    return $directory . '/' . ltrim($path, '/');
}

function truncateText(string $value, int $length): string
{
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $length);
    }

    return substr($value, 0, $length);
}

function normalizeWhitespace(string $value): string
{
    return trim(preg_replace('/\s+/u', ' ', $value) ?? '');
}

function isPublicIpAddress(string $ip): bool
{
    return filter_var(
        $ip,
        FILTER_VALIDATE_IP,
        FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
    ) !== false;
}

function isResolvablePublicHostname(string $host): bool
{
    static $resultCache = [];

    $normalizedHost = strtolower(trim($host));
    if ($normalizedHost === '') {
        return false;
    }

    if (array_key_exists($normalizedHost, $resultCache)) {
        return $resultCache[$normalizedHost];
    }

    if (strlen($normalizedHost) > 253) {
        return $resultCache[$normalizedHost] = false;
    }

    if (filter_var($normalizedHost, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME) === false) {
        return $resultCache[$normalizedHost] = false;
    }

    if (function_exists('gethostbynamel')) {
        $ipv4Hosts = @gethostbynamel($normalizedHost);
        if (is_array($ipv4Hosts) && $ipv4Hosts !== []) {
            foreach (array_slice($ipv4Hosts, 0, 8) as $resolvedIp) {
                if (!isPublicIpAddress($resolvedIp)) {
                    return $resultCache[$normalizedHost] = false;
                }
            }

            return $resultCache[$normalizedHost] = true;
        }
    }

    if (function_exists('dns_get_record')) {
        $ipv6Records = @dns_get_record($normalizedHost, DNS_AAAA);
        if (is_array($ipv6Records) && $ipv6Records !== []) {
            foreach (array_slice($ipv6Records, 0, 8) as $record) {
                $resolvedIp = (string) ($record['ipv6'] ?? '');
                if ($resolvedIp !== '' && !isPublicIpAddress($resolvedIp)) {
                    return $resultCache[$normalizedHost] = false;
                }
            }

            return $resultCache[$normalizedHost] = true;
        }
    }

    return $resultCache[$normalizedHost] = true;
}

function isAllowedRemoteUrl(string $url): bool
{
    $parts = parse_url($url);
    if (!is_array($parts)) {
        return false;
    }

    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    $host = strtolower((string) ($parts['host'] ?? ''));

    if (!in_array($scheme, ['http', 'https'], true) || $host === '') {
        return false;
    }

    if (in_array($host, ['localhost', 'localhost.localdomain'], true)) {
        return false;
    }

    if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
        return isPublicIpAddress($host);
    }

    return isResolvablePublicHostname($host);
}

function parseHttpResponseHeaders(array $headers): array
{
    $parsed = [
        'status' => 0,
        'content_type' => '',
    ];

    foreach ($headers as $headerLine) {
        if (!is_string($headerLine) || $headerLine === '') {
            continue;
        }

        if (preg_match('#^HTTP/\S+\s+(\d{3})#i', $headerLine, $match)) {
            $parsed['status'] = (int) $match[1];
            continue;
        }

        $separatorPos = strpos($headerLine, ':');
        if ($separatorPos === false) {
            continue;
        }

        $headerName = strtolower(trim(substr($headerLine, 0, $separatorPos)));
        $headerValue = trim(substr($headerLine, $separatorPos + 1));

        if ($headerName === 'content-type') {
            $parsed['content_type'] = strtolower($headerValue);
        }
    }

    return $parsed;
}

function isHtmlContentType(string $contentType): bool
{
    if ($contentType === '') {
        return true;
    }

    return str_contains($contentType, 'text/html') || str_contains($contentType, 'application/xhtml+xml');
}

function fetchWithCurl(string $url, int $connectTimeoutSeconds, int $requestTimeoutSeconds, int $maxRedirects, array $headers): array
{
    $ch = curl_init($url);
    if ($ch === false) {
        return ['html' => null, 'error' => 'cURL konnte nicht initialisiert werden.'];
    }

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => $maxRedirects,
        CURLOPT_TIMEOUT => $requestTimeoutSeconds,
        CURLOPT_CONNECTTIMEOUT => $connectTimeoutSeconds,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_ENCODING => '',
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);

    if (defined('CURLOPT_PROTOCOLS')) {
        curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
    }

    if (defined('CURLOPT_REDIR_PROTOCOLS')) {
        curl_setopt($ch, CURLOPT_REDIR_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
    }

    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $contentType = strtolower((string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE));
    $error = curl_errno($ch) !== 0 ? curl_error($ch) : '';
    curl_close($ch);

    if (!is_string($body) || $body === '') {
        return ['html' => null, 'error' => $error !== '' ? $error : 'Seite nicht abrufbar.'];
    }

    if ($status >= 400) {
        return ['html' => null, 'error' => 'HTTP ' . $status];
    }

    if (!isHtmlContentType($contentType)) {
        return ['html' => null, 'error' => 'Ziel liefert kein HTML.'];
    }

    return ['html' => truncateText($body, 512000), 'error' => null];
}

function fetchWithStream(string $url, int $requestTimeoutSeconds, int $maxRedirects, array $headers): array
{
    $context = stream_context_create([
        'http' => [
            'timeout' => $requestTimeoutSeconds,
            'follow_location' => 1,
            'max_redirects' => $maxRedirects,
            'ignore_errors' => true,
            'header' => implode("\r\n", $headers) . "\r\n",
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);

    $body = @file_get_contents($url, false, $context);
    $responseHeaders = parseHttpResponseHeaders($http_response_header ?? []);

    if (!is_string($body) || $body === '') {
        $error = error_get_last();
        return ['html' => null, 'error' => is_array($error) ? (string) ($error['message'] ?? 'Seite nicht abrufbar.') : 'Seite nicht abrufbar.'];
    }

    if (($responseHeaders['status'] ?? 0) >= 400) {
        return ['html' => null, 'error' => 'HTTP ' . $responseHeaders['status']];
    }

    if (!isHtmlContentType((string) ($responseHeaders['content_type'] ?? ''))) {
        return ['html' => null, 'error' => 'Ziel liefert kein HTML.'];
    }

    return ['html' => truncateText($body, 512000), 'error' => null];
}

function fetchRemoteHtml(string $url): array
{
    $connectTimeoutSeconds = 3;
    $requestTimeoutSeconds = 6;
    $maxRedirects = 3;

    $headers = [
        'Accept: text/html,application/xhtml+xml',
        'Accept-Language: de-DE,de;q=0.9,en;q=0.8',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    ];

    if (extension_loaded('curl')) {
        return fetchWithCurl($url, $connectTimeoutSeconds, $requestTimeoutSeconds, $maxRedirects, $headers);
    }

    return fetchWithStream($url, $requestTimeoutSeconds, $maxRedirects, $headers);
}

function extractMetaContent(string $html, string $attributeName, string $attributeValue): string
{
    $quotedAttributeValue = preg_quote($attributeValue, '/');
    $pattern = '/<meta\b(?=[^>]*\b' . preg_quote($attributeName, '/') . '\s*=\s*([\'"])' . $quotedAttributeValue . '\1)(?=[^>]*\bcontent\s*=\s*([\'"])(.*?)\2)[^>]*>/is';

    if (preg_match($pattern, $html, $match) === 1) {
        return normalizeWhitespace(html_entity_decode((string) ($match[3] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }

    return '';
}

function absolutizeUrl(string $baseUrl, string $candidate): string
{
    $candidate = trim($candidate);
    if ($candidate === '') {
        return '';
    }

    if (preg_match('#^https?://#i', $candidate) === 1) {
        return $candidate;
    }

    $baseParts = parse_url($baseUrl);
    if (!is_array($baseParts)) {
        return $candidate;
    }

    $scheme = (string) ($baseParts['scheme'] ?? 'https');
    $host = (string) ($baseParts['host'] ?? '');
    if ($host === '') {
        return $candidate;
    }

    if (str_starts_with($candidate, '//')) {
        return $scheme . ':' . $candidate;
    }

    $path = (string) ($baseParts['path'] ?? '/');
    $directory = preg_replace('#/[^/]*$#', '/', $path) ?? '/';

    if (str_starts_with($candidate, '/')) {
        return $scheme . '://' . $host . $candidate;
    }

    return $scheme . '://' . $host . $directory . $candidate;
}

function requireCsrfToken(array $data): void
{
    $providedToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($data['csrf_token'] ?? null);

    if (!hasValidCsrfToken(is_string($providedToken) ? $providedToken : null)) {
        respond(403, ['error' => 'Ungültiges Sicherheits-Token.']);
    }
}

function normalizeName(?string $name): string
{
    $name = trim((string) $name);
    $name = preg_replace('/\s+/u', ' ', $name) ?? '';
    return truncateText($name, 120);
}

function normalizeQuantity(?string $quantity): string
{
    $quantity = trim((string) $quantity);
    $quantity = preg_replace('/\s+/u', ' ', $quantity) ?? '';
    return truncateText($quantity, 40);
}

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
    $geminiKey = trim((string) ($preferences['gemini_api_key'] ?? ''));
    if ($geminiKey === '') {
        return $normalized;
    }

    if (!shouldUseAiForProductNormalization($product, $normalized)) {
        return $normalized;
    }

    $availableGeminiModels = getAvailableGeminiModels();
    $geminiModel = (string) ($preferences['gemini_model'] ?? 'gemini-2.5-flash');
    if (!array_key_exists($geminiModel, $availableGeminiModels)) {
        $geminiModel = 'gemini-2.5-flash';
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

    $apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($geminiModel) . ':generateContent';
    $postData = [
        'contents' => [[
            'parts' => [[
                'text' => $systemPrompt . "\n\nInput: " . json_encode($product, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ]],
        ]],
        'generationConfig' => [
            'response_mime_type' => 'application/json',
            'temperature' => 0.1,
        ],
    ];

    $ch = curl_init($apiUrl);
    if ($ch === false) {
        return $normalized;
    }

    $encodedPostData = json_encode($postData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $encodedPostData === false ? '{}' : $encodedPostData,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'x-goog-api-key: ' . $geminiKey,
        ],
    ]);

    $response = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    if (!is_string($response) || $response === '' || $httpCode !== 200) {
        return $normalized;
    }

    $result = json_decode($response, true);
    $aiText = trim((string) ($result['candidates'][0]['content']['parts'][0]['text'] ?? ''));
    if ($aiText === '') {
        return $normalized;
    }

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

function normalizeDueDate(?string $date): string
{
    $date = trim((string) $date);
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ? $date : '';
}

function normalizeIdList(mixed $ids): array
{
    if (!is_array($ids) || $ids === []) {
        return [];
    }

    $normalized = [];

    foreach ($ids as $rawId) {
        $id = filter_var($rawId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        if ($id === false || $id === null) {
            return [];
        }

        $normalized[] = (int) $id;
    }

    if (count(array_unique($normalized)) !== count($normalized)) {
        return [];
    }

    return $normalized;
}

function sanitizeFtsQuery(string $q): string
{
    $q = truncateText($q, 256);
    $q = trim($q);
    if ($q === '') {
        return '';
    }

    $words = array_values(array_filter(preg_split('/\s+/u', $q) ?: []));
    if ($words === []) {
        return '';
    }

    $words = array_slice($words, 0, 8);

    $parts = array_map(
        static fn(string $w): string => '"' . str_replace('"', '""', truncateText($w, 32)) . '"*',
        $words
    );

    return implode(' ', $parts);
}

function normalizeContent(?string $content): string
{
    return sanitizeRichTextHtml(truncateText(trim((string) $content), 102400));
}

function normalizePlainTextContent(?string $content): string
{
    return truncateText(trim((string) $content), 8000);
}

function sanitizeRichTextHref(string $href): ?string
{
    $href = trim($href);
    if ($href === '') {
        return null;
    }

    if (preg_match('/^(https?:|mailto:|tel:)/i', $href) !== 1) {
        return null;
    }

    return $href;
}

function sanitizeRichTextHtmlFallback(string $html): string
{
    $html = preg_replace('#<(script|style)\b[^>]*>.*?</\1>#is', '', $html) ?? '';
    $html = preg_replace('/\son[a-z]+\s*=\s*(".*?"|\'.*?\'|[^\s>]+)/is', '', $html) ?? '';
    $html = preg_replace('/\sstyle\s*=\s*(".*?"|\'.*?\')/is', '', $html) ?? '';

    return strip_tags($html, '<p><br><strong><b><em><i><s><ul><ol><li><blockquote><pre><code><h1><h2><h3><a>');
}

function cleanNonElementNode(DOMNode $node, DOMDocument $document): bool
{
    if ($node instanceof DOMComment) {
        $node->parentNode?->removeChild($node);
        return true;
    }

    if (!($node instanceof DOMElement)) {
        foreach (iterator_to_array($node->childNodes) as $childNode) {
            sanitizeRichTextNode($childNode, $document);
        }
        return true;
    }

    return false;
}

function cleanElementNode(DOMElement $node, DOMDocument $document): bool
{
    $allowedTags = ['p', 'br', 'strong', 'b', 'em', 'i', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'a'];
    $tagName = strtolower($node->tagName);

    if (!in_array($tagName, $allowedTags, true)) {
        $parentNode = $node->parentNode;
        if ($parentNode !== null) {
            while ($node->firstChild !== null) {
                $parentNode->insertBefore($node->firstChild, $node);
            }
            $parentNode->removeChild($node);
        }
        return true;
    }

    return false;
}

function cleanElementAttributes(DOMElement $node): void
{
    $tagName = strtolower($node->tagName);

    foreach (iterator_to_array($node->attributes) as $attribute) {
        $attributeName = strtolower($attribute->nodeName);

        if ($tagName !== 'a' || !in_array($attributeName, ['href', 'target', 'rel'], true)) {
            $node->removeAttributeNode($attribute);
            continue;
        }

        if ($attributeName === 'href') {
            $sanitizedHref = sanitizeRichTextHref($attribute->nodeValue);
            if ($sanitizedHref === null) {
                $node->removeAttribute('href');
            } else {
                $node->setAttribute('href', $sanitizedHref);
            }
        }

        if ($attributeName === 'target' && strtolower($attribute->nodeValue) !== '_blank') {
            $node->removeAttribute('target');
        }
    }

    if ($tagName === 'a') {
        if ($node->hasAttribute('target')) {
            $node->setAttribute('rel', 'noopener noreferrer');
        } else {
            $node->removeAttribute('rel');
        }
    }
}

function sanitizeRichTextNode(DOMNode $node, DOMDocument $document): void
{
    if (cleanNonElementNode($node, $document)) {
        return;
    }

    if ($node instanceof DOMElement) {
        if (cleanElementNode($node, $document)) {
            return;
        }

        cleanElementAttributes($node);
    }

    foreach (iterator_to_array($node->childNodes) as $childNode) {
        sanitizeRichTextNode($childNode, $document);
    }
}

function sanitizeRichTextHtml(string $html): string
{
    if ($html === '') {
        return '';
    }

    if (!class_exists(DOMDocument::class)) {
        return sanitizeRichTextHtmlFallback($html);
    }

    $document = new DOMDocument('1.0', 'UTF-8');
    $previousUseInternalErrors = libxml_use_internal_errors(true);
    $loaded = $document->loadHTML(
        '<!DOCTYPE html><html><body>' . $html . '</body></html>',
        LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
    );
    libxml_clear_errors();
    libxml_use_internal_errors($previousUseInternalErrors);

    if (!$loaded) {
        return sanitizeRichTextHtmlFallback($html);
    }

    $body = $document->getElementsByTagName('body')->item(0);
    if (!$body instanceof DOMElement) {
        return sanitizeRichTextHtmlFallback($html);
    }

    foreach (iterator_to_array($body->childNodes) as $childNode) {
        sanitizeRichTextNode($childNode, $document);
    }

    $sanitized = '';
    foreach ($body->childNodes as $childNode) {
        $sanitized .= $document->saveHTML($childNode);
    }

    return trim($sanitized);
}

function normalizeOriginalFilename(?string $filename): string
{
    $filename = trim((string) $filename);
    $filename = str_replace(["\r", "\n", "\0"], '', $filename);
    $filename = preg_replace('/[\/\\\\]+/', ' ', $filename) ?? '';
    $filename = preg_replace('/\s+/u', ' ', $filename) ?? '';
    $filename = trim($filename, " .\t");

    if ($filename === '') {
        return 'upload';
    }

    return truncateText($filename, 255);
}

function getProductCatalogDatasets(): array
{
    return ['food', 'beauty', 'petfood', 'products'];
}

function getProductCatalogTableName(string $dataset): string
{
    if (!in_array($dataset, getProductCatalogDatasets(), true)) {
        throw new InvalidArgumentException('Ungültiges Produkt-Dataset.');
    }

    return 'product_catalog_' . $dataset;
}

function quoteSqlIdentifier(string $identifier): string
{
    return '"' . str_replace('"', '""', $identifier) . '"';
}

function normalizeStoredExtension(string $extension): string
{
    $extension = strtolower(trim($extension));
    $extension = preg_replace('/[^a-z0-9]+/', '', $extension) ?? '';

    return truncateText($extension, 16);
}

function detectMimeType(string $path): string
{
    $mediaType = '';

    if (class_exists('finfo')) {
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $detected = $finfo->file($path);
        if (is_string($detected) && trim($detected) !== '') {
            $mediaType = trim($detected);
        }
    }

    if ($mediaType === '' && function_exists('mime_content_type')) {
        $detected = mime_content_type($path);
        if (is_string($detected) && trim($detected) !== '') {
            $mediaType = trim($detected);
        }
    }

    if ($mediaType === '' && function_exists('getimagesize')) {
        $info = @getimagesize($path);
        if (is_array($info) && isset($info['mime']) && is_string($info['mime']) && $info['mime'] !== '') {
            $mediaType = $info['mime'];
        }
    }

    return $mediaType !== '' ? $mediaType : 'application/octet-stream';
}

function uploadedFileErrorMessage(int $errorCode): array
{
    return match ($errorCode) {
        UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => [413, 'Datei ist zu groß.'],
        UPLOAD_ERR_PARTIAL => [422, 'Datei wurde unvollständig hochgeladen.'],
        UPLOAD_ERR_NO_FILE => [422, 'Bitte wähle eine Datei aus.'],
        UPLOAD_ERR_NO_TMP_DIR, UPLOAD_ERR_CANT_WRITE, UPLOAD_ERR_EXTENSION => [500, 'Upload konnte nicht gespeichert werden.'],
        default => [422, 'Ungültiger Upload.'],
    };
}

function activeUploadLimits(): array
{
    static $limits = null;

    if ($limits === null) {
        $limits = getUploadLimitSettings(getDatabase());
    }

    return $limits;
}

function activeUploadLimitBytes(string $key): int
{
    $limits = activeUploadLimits();
    $megabytes = (int) ($limits[$key] ?? DEFAULT_UPLOAD_LIMITS_MB[$key] ?? 1);

    return uploadLimitMegabytesToBytes($megabytes);
}

function formatBytesForMessage(int $bytes): string
{
    if ($bytes >= 1073741824 && $bytes % 1073741824 === 0) {
        return (int) ($bytes / 1073741824) . ' GB';
    }
    if ($bytes >= 1048576 && $bytes % 1048576 === 0) {
        return (int) ($bytes / 1048576) . ' MB';
    }
    if ($bytes >= 1024 && $bytes % 1024 === 0) {
        return (int) ($bytes / 1024) . ' KB';
    }

    return $bytes . ' B';
}

function getSingleUploadedFile(): array
{
    if ($_FILES === []) {
        respond(422, ['error' => 'Bitte wähle eine Datei aus.']);
    }

    $candidate = $_FILES['file'] ?? $_FILES['attachment'] ?? $_FILES['upload'] ?? reset($_FILES);

    if (!is_array($candidate)) {
        respond(422, ['error' => 'Bitte wähle eine Datei aus.']);
    }

    if (is_array($candidate['error'] ?? null)) {
        respond(422, ['error' => 'Mehrere Dateien pro Request werden nicht unterstützt.']);
    }

    $errorCode = (int) ($candidate['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($errorCode !== UPLOAD_ERR_OK) {
        [$status, $message] = uploadedFileErrorMessage($errorCode);
        respond($status, ['error' => $message]);
    }

    $tmpName = (string) ($candidate['tmp_name'] ?? '');
    if ($tmpName === '' || !is_uploaded_file($tmpName)) {
        respond(422, ['error' => 'Ungültiger Upload.']);
    }

    $sizeBytes = filter_var($candidate['size'] ?? null, FILTER_VALIDATE_INT, [
        'options' => ['min_range' => 0],
    ]);

    if (!is_int($sizeBytes)) {
        $actualSize = filesize($tmpName);
        $sizeBytes = $actualSize !== false ? $actualSize : 0;
    }

    return [
        'tmp_name' => $tmpName,
        'size_bytes' => $sizeBytes,
        'original_name' => normalizeOriginalFilename((string) ($candidate['name'] ?? '')),
    ];
}

function validateImageUpload(array $uploadedFile): array
{
    $maxBytes = activeUploadLimitBytes('image_upload_max_mb');
    if ((int) $uploadedFile['size_bytes'] > $maxBytes) {
        respond(413, ['error' => 'Bilder dürfen maximal ' . formatBytesForMessage($maxBytes) . ' groß sein.']);
    }

    $mediaType = detectMimeType((string) $uploadedFile['tmp_name']);
    $extension = IMAGE_UPLOAD_MIME_TYPES[$mediaType] ?? null;

    if (!is_string($extension)) {
        respond(422, ['error' => 'Nur JPG, PNG, WebP und GIF sind als Bilder erlaubt.']);
    }

    if (function_exists('getimagesize') && @getimagesize((string) $uploadedFile['tmp_name']) === false) {
        respond(422, ['error' => 'Die hochgeladene Datei ist kein gültiges Bild.']);
    }

    return [
        'media_type' => $mediaType,
        'stored_extension' => $extension,
    ];
}

function validateFileUpload(array $uploadedFile, string $limitKey = 'file_upload_max_mb'): array
{
    $maxBytes = activeUploadLimitBytes($limitKey);
    if ((int) $uploadedFile['size_bytes'] > $maxBytes) {
        respond(413, ['error' => 'Dateien dürfen maximal ' . formatBytesForMessage($maxBytes) . ' groß sein.']);
    }

    $pathInfoExtension = pathinfo((string) $uploadedFile['original_name'], PATHINFO_EXTENSION);
    $extension = normalizeStoredExtension(is_string($pathInfoExtension) ? $pathInfoExtension : '');
    $mediaType = detectMimeType((string) $uploadedFile['tmp_name']);

    if ($extension === '') {
        $extension = normalizeStoredExtension(MIME_TYPE_EXTENSIONS[$mediaType] ?? '');
    }

    return [
        'media_type' => $mediaType,
        'stored_extension' => $extension,
    ];
}

function validateSsrfSafeUrl(string $url): void
{
    if ($url === '' || !isAllowedRemoteUrl($url)) {
        respond(422, ['error' => 'URL ist nicht erlaubt.']);
    }
}

function extractFilenameFromUrl(string $url): string
{
    $path = parse_url($url, PHP_URL_PATH);
    $filename = is_string($path) ? basename(rawurldecode($path)) : '';

    return normalizeOriginalFilename($filename);
}

function extractFilenameFromContentDisposition(string $header): string
{
    if (preg_match('/filename\*=UTF-8\'\'([^;]+)/i', $header, $matches) === 1) {
        return normalizeOriginalFilename(rawurldecode(trim($matches[1], " \t\"")));
    }

    if (preg_match('/filename="([^"]+)"/i', $header, $matches) === 1) {
        return normalizeOriginalFilename($matches[1]);
    }

    if (preg_match('/filename=([^;]+)/i', $header, $matches) === 1) {
        return normalizeOriginalFilename(trim($matches[1], " \t\""));
    }

    return '';
}

function downloadRemoteFile(string $url): array
{
    validateSsrfSafeUrl($url);

    $tmpPath = tempnam(sys_get_temp_dir(), 'ankerkladde-url-');
    if ($tmpPath === false) {
        return ['error' => 'Temporäre Datei konnte nicht angelegt werden.'];
    }

    $contentType = '';
    $originalName = extractFilenameFromUrl($url);
    $maxBytes = activeUploadLimitBytes('remote_file_import_max_mb');

    if (function_exists('curl_init')) {
        $handle = @fopen($tmpPath, 'wb');
        if ($handle === false) {
            @unlink($tmpPath);
            return ['error' => 'Temporäre Datei konnte nicht geöffnet werden.'];
        }

        $headers = [];
        $ch = curl_init($url);
        if ($ch === false) {
            fclose($handle);
            @unlink($tmpPath);
            return ['error' => 'Download konnte nicht gestartet werden.'];
        }

        curl_setopt_array($ch, [
            CURLOPT_FILE => $handle,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_NOPROGRESS => false,
            CURLOPT_PROGRESSFUNCTION => static function ($resource, float $downloadTotal, float $downloadNow) use ($maxBytes): int {
                return $downloadNow > $maxBytes || $downloadTotal > $maxBytes ? 1 : 0;
            },
            CURLOPT_HEADERFUNCTION => static function ($resource, string $headerLine) use (&$headers): int {
                $trimmed = trim($headerLine);
                if ($trimmed !== '' && str_contains($trimmed, ':')) {
                    [$name, $value] = explode(':', $trimmed, 2);
                    $headers[strtolower(trim($name))] = trim($value);
                }
                return strlen($headerLine);
            },
        ]);

        $ok = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        fclose($handle);

        $sizeBytes = filesize($tmpPath);
        $sizeBytes = $sizeBytes !== false ? $sizeBytes : 0;

        if ($ok === false || $status < 200 || $status >= 300) {
            @unlink($tmpPath);
            return ['error' => $error !== '' ? $error : 'Datei konnte nicht geladen werden.'];
        }
        if ($sizeBytes > $maxBytes) {
            @unlink($tmpPath);
            return ['error' => 'Dateien dürfen maximal ' . formatBytesForMessage($maxBytes) . ' groß sein.'];
        }

        $contentType = preg_replace('/;.*$/', '', (string) ($headers['content-type'] ?? '')) ?? '';
        if (isset($headers['content-disposition'])) {
            $headerName = extractFilenameFromContentDisposition((string) $headers['content-disposition']);
            if ($headerName !== '') {
                $originalName = $headerName;
            }
        }

        return [
            'tmp_path' => $tmpPath,
            'size_bytes' => $sizeBytes,
            'original_name' => $originalName,
            'content_type' => $contentType,
        ];
    }

    $source = @fopen($url, 'rb', false, stream_context_create([
        'http' => ['follow_location' => 1, 'max_redirects' => 5, 'timeout' => 120],
        'https' => ['follow_location' => 1, 'max_redirects' => 5, 'timeout' => 120],
    ]));
    $target = @fopen($tmpPath, 'wb');
    if ($source === false || $target === false) {
        if (is_resource($source)) fclose($source);
        if (is_resource($target)) fclose($target);
        @unlink($tmpPath);
        return ['error' => 'Datei konnte nicht geladen werden.'];
    }

    $sizeBytes = 0;
    while (!feof($source)) {
        $chunk = fread($source, 1048576);
        if ($chunk === false) break;
        $sizeBytes += strlen($chunk);
        if ($sizeBytes > $maxBytes) {
            fclose($source);
            fclose($target);
            @unlink($tmpPath);
            return ['error' => 'Dateien dürfen maximal ' . formatBytesForMessage($maxBytes) . ' groß sein.'];
        }
        fwrite($target, $chunk);
    }
    fclose($source);
    fclose($target);

    return [
        'tmp_path' => $tmpPath,
        'size_bytes' => $sizeBytes,
        'original_name' => $originalName,
        'content_type' => $contentType,
    ];
}

function buildStoredFilename(string $type, string $extension): string
{
    $randomName = bin2hex(random_bytes(16));
    $suffix = $extension !== '' ? '.' . $extension : '';

    return $type . '-' . $randomName . $suffix;
}

function resolveCategoryId(array $data, PDO $db, int $userId): int
{
    $categoryId = filter_var($_GET['category_id'] ?? ($data['category_id'] ?? null), FILTER_VALIDATE_INT, [
        'options' => ['min_range' => 1],
    ]);

    if (is_int($categoryId)) {
        return $categoryId;
    }

    $legacySection = $_GET['section'] ?? ($data['section'] ?? null);
    if (!is_string($legacySection) || trim($legacySection) === '') {
        $preferences = getExtendedUserPreferences($db, $userId);
        $preferredCategoryId = filter_var($preferences['last_category_id'] ?? null, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1],
        ]);

        if (is_int($preferredCategoryId) && loadUserCategory($db, $userId, $preferredCategoryId) !== null) {
            return $preferredCategoryId;
        }

        $categories = loadUserCategories($db, $userId, false);
        if ($categories !== []) {
            return (int) $categories[0]['id'];
        }

        respond(404, ['error' => 'Kategorie nicht gefunden.']);
    }

    $definition = legacyCategoryDefinition(trim($legacySection));
    if ($definition === null) {
        respond(422, ['error' => 'Ungültige Kategorie.']);
    }

    $stmt = $db->prepare(
        'SELECT id FROM categories
         WHERE user_id = :user_id AND legacy_key = :legacy_key
         ORDER BY id ASC
         LIMIT 1'
    );
    $stmt->execute([
        ':user_id' => $userId,
        ':legacy_key' => trim($legacySection),
    ]);
    $categoryId = $stmt->fetchColumn();

    if ($categoryId === false) {
        respond(404, ['error' => 'Kategorie nicht gefunden.']);
    }

    return (int) $categoryId;
}

function requireCategory(array $data, PDO $db, int $userId): array
{
    $categoryId = resolveCategoryId($data, $db, $userId);
    $category = loadUserCategory($db, $userId, $categoryId);

    if ($category === null) {
        respond(404, ['error' => 'Kategorie nicht gefunden.']);
    }

    return $category;
}

function validateCategoryType(array $category, array $allowedTypes, string $message): void
{
    if (!in_array((string) $category['type'], $allowedTypes, true)) {
        respond(422, ['error' => $message]);
    }
}

function buildAttachmentPayload(array $item): ?array
{
    $section = (string) ($item['attachment_storage_section'] ?? '');
    $hasAttachment = (int) ($item['has_attachment'] ?? 0) === 1;

    if (!$hasAttachment || !isAttachmentCategoryType($section)) {
        return null;
    }

    $baseUrl = requestPath('media.php?item_id=' . (int) $item['id']);
    $versionSource = '';

    if ($section === 'images' && !empty($item['attachment_stored_name'])) {
        $thumbnailPath = getAttachmentThumbnailAbsolutePath([
            'storage_section' => $section,
            'stored_name' => (string) $item['attachment_stored_name'],
        ]);
        $thumbnailMtime = is_file($thumbnailPath) ? @filemtime($thumbnailPath) : false;
        if (is_int($thumbnailMtime) && $thumbnailMtime > 0) {
            $versionSource = 'thumb-' . $thumbnailMtime;
        }
    }

    if ($versionSource === '') {
        $versionSource = (string) ($item['attachment_updated_at'] ?? '');
    }
    if ($versionSource === '') {
        $versionSource = (string) ($item['attachment_stored_name'] ?? '');
    }
    $versionQuery = $versionSource !== '' ? '&v=' . rawurlencode($versionSource) : '';

    return [
        'preview_url' => $section === 'images' ? $baseUrl . '&variant=thumb' . $versionQuery : null,
        'original_url' => $section === 'images' ? $baseUrl : $baseUrl . '&download=1' . $versionQuery,
        'download_url' => $baseUrl . '&download=1' . $versionQuery,
        'original_name' => (string) ($item['attachment_original_name'] ?? ''),
        'mime_type' => (string) ($item['attachment_media_type'] ?? 'application/octet-stream'),
        'size_bytes' => (int) ($item['attachment_size_bytes'] ?? 0),
    ];
}

function formatListItem(array $item): array
{
    $attachment = buildAttachmentPayload($item);

    return [
        'id' => (int) $item['id'],
        'category_id' => (int) ($item['category_id'] ?? 0),
        'category_name' => (string) ($item['category_name'] ?? ''),
        'category_type' => (string) ($item['category_type'] ?? ''),
        'name' => (string) ($item['name'] ?? ''),
        'barcode' => (string) ($item['barcode'] ?? ''),
        'quantity' => (string) ($item['quantity'] ?? ''),
        'due_date' => (string) ($item['due_date'] ?? ''),
        'is_pinned' => (int) ($item['is_pinned'] ?? 0),
        'status' => (string) ($item['status'] ?? ''),
        'content' => (string) ($item['content'] ?? ''),
        'done' => (int) ($item['done'] ?? 0),
        'sort_order' => (int) ($item['sort_order'] ?? 0),
        'created_at' => (string) ($item['created_at'] ?? ''),
        'updated_at' => (string) ($item['updated_at'] ?? ''),
        'has_attachment' => $attachment !== null ? 1 : 0,
        'attachment' => $attachment,
        'attachment_storage_section' => $attachment !== null ? (string) ($item['attachment_storage_section'] ?? '') : null,
        'attachment_original_name' => $attachment['original_name'] ?? null,
        'attachment_media_type' => $attachment['mime_type'] ?? null,
        'attachment_size_bytes' => $attachment['size_bytes'] ?? null,
        'attachment_url' => $attachment['preview_url'] ?? $attachment['download_url'] ?? null,
        'attachment_preview_url' => $attachment['preview_url'] ?? null,
        'attachment_original_url' => $attachment['original_url'] ?? null,
        'attachment_download_url' => $attachment['download_url'] ?? null,
    ];
}

function fetchItemForUser(PDO $db, int $userId, int $itemId): ?array
{
    $stmt = $db->prepare(
        'SELECT
            items.id,
            items.category_id,
            categories.name AS category_name,
            categories.type AS category_type,
            items.name,
            items.barcode,
            items.quantity,
            items.due_date,
            items.is_pinned,
            items.status,
            items.content,
            items.done,
            items.sort_order,
            items.created_at,
            items.updated_at,
            attachments.storage_section AS attachment_storage_section,
            attachments.stored_name AS attachment_stored_name,
            attachments.original_name AS attachment_original_name,
            attachments.media_type AS attachment_media_type,
            attachments.size_bytes AS attachment_size_bytes,
            attachments.updated_at AS attachment_updated_at,
            CASE WHEN attachments.id IS NULL THEN 0 ELSE 1 END AS has_attachment
         FROM items
         INNER JOIN categories ON categories.id = items.category_id
         LEFT JOIN attachments ON attachments.item_id = items.id
         WHERE items.id = :id AND items.user_id = :user_id
         LIMIT 1'
    );
    $stmt->execute([':id' => $itemId, ':user_id' => $userId]);
    $item = $stmt->fetch();

    return is_array($item) ? $item : null;
}

$action = $_GET['action'] ?? 'list';
$db = getDatabase();
$userId = requireApiAuthWithKey($db);

try {
    switch ($action) {
        case 'categories_list':
            requireMethod('GET');
            respond(200, [
                'categories' => loadUserCategories($db, $userId),
                'preferences' => getExtendedUserPreferences($db, $userId),
            ]);

        case 'categories_create':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $name = normalizeName($data['name'] ?? null);
            $type = trim((string) ($data['type'] ?? ''));

            if ($name === '') {
                respond(422, ['error' => 'Bitte gib einen Kategorienamen ein.']);
            }

            if (!in_array($type, CATEGORY_TYPES, true)) {
                respond(422, ['error' => 'Ungültiger Kategorietyp.']);
            }

            $icon = normalizeCategoryIcon($data['icon'] ?? null, $type);

            $stmt = $db->prepare(
                'INSERT INTO categories (user_id, name, type, icon, sort_order, is_hidden)
                 VALUES (:user_id, :name, :type, :icon, :sort_order, 0)'
            );
            $stmt->execute([
                ':user_id' => $userId,
                ':name' => $name,
                ':type' => $type,
                ':icon' => $icon,
                ':sort_order' => nextCategorySortOrder($db, $userId),
            ]);

            $categoryId = (int) $db->lastInsertId();
            updateExtendedUserPreferences($db, $userId, ['last_category_id' => $categoryId]);

            respond(201, [
                'message' => 'Kategorie erstellt.',
                'category' => loadUserCategory($db, $userId, $categoryId),
            ]);

        case 'categories_update':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $categoryId = filter_var($data['category_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if (!is_int($categoryId)) {
                respond(422, ['error' => 'Ungültige Kategorie.']);
            }

            $category = loadUserCategory($db, $userId, $categoryId);
            if ($category === null) {
                respond(404, ['error' => 'Kategorie nicht gefunden.']);
            }

            $patches = [];
            $params = [':id' => $categoryId, ':user_id' => $userId];

            if (array_key_exists('name', $data)) {
                $name = normalizeName($data['name'] ?? null);
                if ($name === '') {
                    respond(422, ['error' => 'Bitte gib einen Kategorienamen ein.']);
                }
                $patches[] = 'name = :name';
                $params[':name'] = $name;
            }

            if (array_key_exists('icon', $data)) {
                $patches[] = 'icon = :icon';
                $params[':icon'] = normalizeCategoryIcon((string) $data['icon'], (string) $category['type']);
            }

            if (array_key_exists('is_hidden', $data)) {
                $patches[] = 'is_hidden = :is_hidden';
                $params[':is_hidden'] = filter_var($data['is_hidden'], FILTER_VALIDATE_BOOL) ? 1 : 0;
            }

            if ($patches === []) {
                respond(422, ['error' => 'Keine Änderungen übergeben.']);
            }

            $stmt = $db->prepare(
                'UPDATE categories SET ' . implode(', ', $patches) . ', updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id AND user_id = :user_id'
            );
            $stmt->execute($params);

            respond(200, [
                'message' => 'Kategorie aktualisiert.',
                'category' => loadUserCategory($db, $userId, $categoryId),
            ]);

        case 'categories_reorder':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $ids = normalizeIdList($data['ids'] ?? ($data['ids[]'] ?? null));
            if ($ids === []) {
                respond(422, ['error' => 'Ungültige Reihenfolge.']);
            }

            $stmt = $db->prepare('SELECT id FROM categories WHERE user_id = :user_id ORDER BY sort_order ASC, id ASC');
            $stmt->execute([':user_id' => $userId]);
            $existingIds = array_map(static fn(mixed $id): int => (int) $id, $stmt->fetchAll(PDO::FETCH_COLUMN));

            $sortedIds = $ids;
            sort($sortedIds);
            $sortedExisting = $existingIds;
            sort($sortedExisting);

            if ($sortedIds !== $sortedExisting) {
                respond(422, ['error' => 'Reihenfolge passt nicht zu den vorhandenen Kategorien.']);
            }

            $stmt = $db->prepare(
                'UPDATE categories SET sort_order = :sort_order, updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id AND user_id = :user_id'
            );

            $db->beginTransaction();
            foreach ($ids as $index => $id) {
                $stmt->execute([
                    ':sort_order' => $index + 1,
                    ':id' => $id,
                    ':user_id' => $userId,
                ]);
            }
            $db->commit();

            respond(200, ['message' => 'Kategorien neu sortiert.']);

        case 'categories_delete':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $category = requireCategory($data, $db, $userId);

            $countStmt = $db->prepare('SELECT COUNT(*) FROM items WHERE user_id = :user_id AND category_id = :category_id');
            $countStmt->execute([':user_id' => $userId, ':category_id' => (int) $category['id']]);
            if ((int) $countStmt->fetchColumn() > 0) {
                respond(422, ['error' => 'Kategorie kann nur gelöscht werden, wenn sie leer ist.']);
            }

            $db->prepare('DELETE FROM categories WHERE id = :id AND user_id = :user_id')
                ->execute([':id' => (int) $category['id'], ':user_id' => $userId]);

            $preferences = getExtendedUserPreferences($db, $userId);
            if ((int) ($preferences['last_category_id'] ?? 0) === (int) $category['id']) {
                $fallback = loadUserCategories($db, $userId, false)[0]['id'] ?? null;
                updateExtendedUserPreferences($db, $userId, ['last_category_id' => $fallback]);
            }

            respond(200, ['message' => 'Kategorie gelöscht.']);

        case 'list':
            requireMethod('GET');
            $category = requireCategory([], $db, $userId);

            $stmt = $db->prepare(
                'SELECT
                    items.id,
                    items.category_id,
                    categories.name AS category_name,
                    categories.type AS category_type,
                    items.name,
                    items.barcode,
                    items.quantity,
                    items.due_date,
                    items.is_pinned,
                    items.status,
                    items.content,
                    items.done,
                    items.sort_order,
                    items.created_at,
                    items.updated_at,
                    attachments.storage_section AS attachment_storage_section,
                    attachments.stored_name AS attachment_stored_name,
                    attachments.original_name AS attachment_original_name,
                    attachments.media_type AS attachment_media_type,
                    attachments.size_bytes AS attachment_size_bytes,
                    attachments.updated_at AS attachment_updated_at,
                    CASE WHEN attachments.id IS NULL THEN 0 ELSE 1 END AS has_attachment
                 FROM items
                 INNER JOIN categories ON categories.id = items.category_id
                 LEFT JOIN attachments ON attachments.item_id = items.id
                 WHERE items.category_id = :category_id
                   AND items.user_id = :user_id
                 ORDER BY items.is_pinned DESC, items.sort_order ASC, items.id ASC'
            );
            $stmt->execute([':category_id' => (int) $category['id'], ':user_id' => $userId]);

            $items = array_map(static fn(array $item): array => formatListItem($item), $stmt->fetchAll());
            $response = ['items' => $items, 'category' => $category];

            if (isAttachmentCategoryType((string) $category['type'])) {
                $freeBytes = disk_free_space(getDataDirectory());
                if ($freeBytes !== false) {
                    $response['disk_free_bytes'] = (int) $freeBytes;
                }
            }

            respond(200, $response);

        case 'add':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $category = requireCategory($data, $db, $userId);
            $name = normalizeName($data['name'] ?? null);
            $barcode = preg_replace('/\D+/', '', (string) ($data['barcode'] ?? '')) ?? '';
            $barcode = truncateText($barcode, 64);
            $quantity = normalizeQuantity($data['quantity'] ?? null);
            $dueDate = normalizeDueDate($data['due_date'] ?? null);
            $content = normalizeContent($data['content'] ?? null);

            if ($name === '') {
                respond(422, ['error' => 'Bitte gib einen Artikelnamen ein.']);
            }

            $type = (string) $category['type'];

            if ($type === 'list_due_date') {
                $quantity = '';
                $barcode = '';
                $content = normalizePlainTextContent($data['content'] ?? null);
            } elseif ($type === 'list_quantity') {
                $dueDate = '';
                $content = '';
            } elseif ($type === 'notes') {
                $quantity = '';
                $dueDate = '';
                $barcode = '';
            } elseif ($type === 'links') {
                $quantity = '';
                $dueDate = '';
                $barcode = '';
            } else {
                $quantity = '';
                $dueDate = '';
                $content = '';
                $barcode = '';
            }

            $stmt = $db->prepare(
                'INSERT INTO items (name, barcode, quantity, due_date, content, section, category_id, sort_order, user_id)
                 VALUES (:name, :barcode, :quantity, :due_date, :content, :section, :category_id, :sort_order, :user_id)'
            );
            $stmt->execute([
                ':name' => $name,
                ':barcode' => $barcode,
                ':quantity' => $quantity,
                ':due_date' => $dueDate,
                ':content' => $content,
                ':section' => '',
                ':category_id' => (int) $category['id'],
                ':sort_order' => prependItemSortOrder($db, $userId, (int) $category['id']),
                ':user_id' => $userId,
            ]);

            if ($barcode !== '') {
                $db->prepare(
                    'UPDATE scanned_products
                     SET scan_count = scan_count + 1, updated_at = CURRENT_TIMESTAMP
                     WHERE barcode = :barcode'
                )->execute([':barcode' => $barcode]);
            }

            respond(201, [
                'message' => 'Artikel hinzugefügt.',
                'id' => (int) $db->lastInsertId(),
            ]);

        case 'upload':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $category = requireCategory($data, $db, $userId);
            validateCategoryType($category, ['images', 'files'], 'Uploads sind nur in Kategorien vom Typ Bilder oder Dateien erlaubt.');

            $uploadedFile = getSingleUploadedFile();
            $uploadMeta = $category['type'] === 'images'
                ? validateImageUpload($uploadedFile)
                : validateFileUpload($uploadedFile);

            $name = normalizeName($data['name'] ?? null);
            if ($name === '') {
                $name = normalizeName((string) $uploadedFile['original_name']);
            }

            $replaceItemId = filter_var($data['item_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

            if (is_int($replaceItemId)) {
                $existingItem = fetchItemForUser($db, $userId, $replaceItemId);
                if ($existingItem === null || (int) $existingItem['category_id'] !== (int) $category['id']) {
                    respond(404, ['error' => 'Artikel nicht gefunden.']);
                }

                $storedName = buildStoredFilename((string) $category['type'], (string) $uploadMeta['stored_extension']);
                $targetPath = getAttachmentStorageDirectory((string) $category['type']) . '/' . $storedName;
                $storedFileMoved = false;

                $db->beginTransaction();
                try {
                    if ($name !== '') {
                        $db->prepare('UPDATE items SET name = :name, updated_at = CURRENT_TIMESTAMP WHERE id = :id')
                            ->execute([':name' => $name, ':id' => $replaceItemId]);
                    }

                    if (!move_uploaded_file((string) $uploadedFile['tmp_name'], $targetPath)) {
                        throw new RuntimeException('Upload-Datei konnte nicht verschoben werden.');
                    }
                    $storedFileMoved = true;

                    if ((string) $category['type'] === 'images') {
                        @generateImageThumbnailFile($targetPath, getAttachmentThumbnailAbsolutePath([
                            'storage_section' => (string) $category['type'],
                            'stored_name' => $storedName,
                        ]));
                    }

                    $oldAttachment = findAttachmentByItemId($db, $replaceItemId);
                    $db->prepare(
                        'INSERT INTO attachments (item_id, storage_section, stored_name, original_name, media_type, size_bytes)
                         VALUES (:item_id, :storage_section, :stored_name, :original_name, :media_type, :size_bytes)
                         ON CONFLICT(item_id) DO UPDATE SET
                            storage_section = excluded.storage_section,
                            stored_name = excluded.stored_name,
                            original_name = excluded.original_name,
                            media_type = excluded.media_type,
                            size_bytes = excluded.size_bytes,
                            updated_at = CURRENT_TIMESTAMP'
                    )->execute([
                        ':item_id' => $replaceItemId,
                        ':storage_section' => (string) $category['type'],
                        ':stored_name' => $storedName,
                        ':original_name' => (string) $uploadedFile['original_name'],
                        ':media_type' => (string) $uploadMeta['media_type'],
                        ':size_bytes' => (int) $uploadedFile['size_bytes'],
                    ]);

                    $db->commit();

                    if ($oldAttachment !== null) {
                        try {
                            deleteAttachmentStorageFile($oldAttachment);
                        } catch (Throwable $cleanupException) {
                            error_log(sprintf('Einkauf attachment cleanup error [replace:%d]: %s', $replaceItemId, $cleanupException->getMessage()));
                        }
                    }
                } catch (Throwable $exception) {
                    if ($db->inTransaction()) {
                        $db->rollBack();
                    }
                    if ($storedFileMoved && is_file($targetPath)) {
                        @unlink($targetPath);
                    }
                    throw $exception;
                }

                respond(200, ['message' => 'Anhang ersetzt.', 'id' => $replaceItemId]);
            }

            if ($name === '') {
                respond(422, ['error' => 'Bitte gib einen Artikelnamen ein.']);
            }

            $storedName = buildStoredFilename((string) $category['type'], (string) $uploadMeta['stored_extension']);
            $targetPath = getAttachmentStorageDirectory((string) $category['type']) . '/' . $storedName;
            $storedFileMoved = false;
            $itemId = null;

            $db->beginTransaction();
            try {
                $db->prepare(
                    'INSERT INTO items (name, quantity, due_date, content, section, category_id, sort_order, user_id)
                     VALUES (:name, \'\', \'\', \'\', \'\', :category_id, :sort_order, :user_id)'
                )->execute([
                    ':name' => $name,
                    ':category_id' => (int) $category['id'],
                    ':sort_order' => prependItemSortOrder($db, $userId, (int) $category['id']),
                    ':user_id' => $userId,
                ]);
                $itemId = (int) $db->lastInsertId();

                if (!move_uploaded_file((string) $uploadedFile['tmp_name'], $targetPath)) {
                    throw new RuntimeException('Upload-Datei konnte nicht verschoben werden.');
                }
                $storedFileMoved = true;

                if ((string) $category['type'] === 'images') {
                    @generateImageThumbnailFile($targetPath, getAttachmentThumbnailAbsolutePath([
                        'storage_section' => (string) $category['type'],
                        'stored_name' => $storedName,
                    ]));
                }

                $db->prepare(
                    'INSERT INTO attachments (item_id, storage_section, stored_name, original_name, media_type, size_bytes)
                     VALUES (:item_id, :storage_section, :stored_name, :original_name, :media_type, :size_bytes)'
                )->execute([
                    ':item_id' => $itemId,
                    ':storage_section' => (string) $category['type'],
                    ':stored_name' => $storedName,
                    ':original_name' => (string) $uploadedFile['original_name'],
                    ':media_type' => (string) $uploadMeta['media_type'],
                    ':size_bytes' => (int) $uploadedFile['size_bytes'],
                ]);

                $db->commit();
            } catch (Throwable $exception) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                if ($storedFileMoved && is_file($targetPath)) {
                    @unlink($targetPath);
                }
                throw $exception;
            }

            respond(201, ['message' => 'Upload gespeichert.', 'id' => $itemId]);

        case 'import_url':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $category = requireCategory($data, $db, $userId);
            validateCategoryType($category, ['files'], 'URL-Import nur in Dateien-Kategorien.');

            $importUrl = trim((string) ($data['url'] ?? ''));
            validateSsrfSafeUrl($importUrl);

            $downloaded = downloadRemoteFile($importUrl);
            if (isset($downloaded['error'])) {
                respond(422, ['error' => (string) $downloaded['error']]);
            }

            $uploadedFile = [
                'tmp_name' => (string) $downloaded['tmp_path'],
                'size_bytes' => (int) $downloaded['size_bytes'],
                'original_name' => (string) $downloaded['original_name'],
            ];
            $uploadMeta = validateFileUpload($uploadedFile, 'remote_file_import_max_mb');
            $name = normalizeName($data['name'] ?? null);
            if ($name === '') {
                $name = normalizeName((string) $uploadedFile['original_name']);
            }
            if ($name === '') {
                $name = 'Datei';
            }

            $storedName = buildStoredFilename('files', (string) $uploadMeta['stored_extension']);
            $targetPath = getAttachmentStorageDirectory('files') . '/' . $storedName;
            $storedFileMoved = false;
            $itemId = null;

            $db->beginTransaction();
            try {
                $db->prepare(
                    'INSERT INTO items (name, quantity, due_date, content, section, category_id, sort_order, user_id)
                     VALUES (:name, \'\', \'\', \'\', \'\', :category_id, :sort_order, :user_id)'
                )->execute([
                    ':name' => $name,
                    ':category_id' => (int) $category['id'],
                    ':sort_order' => prependItemSortOrder($db, $userId, (int) $category['id']),
                    ':user_id' => $userId,
                ]);
                $itemId = (int) $db->lastInsertId();

                if (!@rename((string) $downloaded['tmp_path'], $targetPath)) {
                    throw new RuntimeException('Importierte Datei konnte nicht gespeichert werden.');
                }
                $storedFileMoved = true;

                $db->prepare(
                    'INSERT INTO attachments (item_id, storage_section, stored_name, original_name, media_type, size_bytes)
                     VALUES (:item_id, :storage_section, :stored_name, :original_name, :media_type, :size_bytes)'
                )->execute([
                    ':item_id' => $itemId,
                    ':storage_section' => 'files',
                    ':stored_name' => $storedName,
                    ':original_name' => (string) $uploadedFile['original_name'],
                    ':media_type' => (string) $uploadMeta['media_type'],
                    ':size_bytes' => (int) $uploadedFile['size_bytes'],
                ]);

                $db->commit();
            } catch (Throwable $exception) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                if ($storedFileMoved && is_file($targetPath)) {
                    @unlink($targetPath);
                }
                @unlink((string) $downloaded['tmp_path']);
                throw $exception;
            }

            respond(201, ['message' => 'Datei importiert.', 'id' => $itemId]);

        case 'toggle':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $done = filter_var($data['done'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 1]]);

            if (!is_int($id) || !is_int($done)) {
                respond(422, ['error' => 'Ungültige Parameter für den Statuswechsel.']);
            }

            $stmt = $db->prepare('UPDATE items SET done = :done, updated_at = CURRENT_TIMESTAMP WHERE id = :id AND user_id = :user_id');
            $stmt->execute([':done' => $done, ':id' => $id, ':user_id' => $userId]);

            if ($stmt->rowCount() === 0) {
                respond(404, ['error' => 'Artikel nicht gefunden.']);
            }

            respond(200, ['message' => 'Status aktualisiert.']);

        case 'update':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if (!is_int($id)) {
                respond(422, ['error' => 'Ungültige ID.']);
            }

            $item = fetchItemForUser($db, $userId, $id);
            if ($item === null) {
                respond(404, ['error' => 'Artikel nicht gefunden.']);
            }

            $type = (string) $item['category_type'];
            $name = normalizeName($data['name'] ?? null);
            $barcode = preg_replace('/\D+/', '', (string) ($data['barcode'] ?? ($item['barcode'] ?? ''))) ?? '';
            $barcode = truncateText($barcode, 64);
            $quantity = normalizeQuantity($data['quantity'] ?? null);
            $dueDate = normalizeDueDate($data['due_date'] ?? null);
            $content = normalizeContent($data['content'] ?? null);

            if ($name === '') {
                respond(422, ['error' => 'Bitte gib einen Artikelnamen ein.']);
            }

            if ($type !== 'list_quantity') {
                $quantity = '';
                $barcode = '';
            }
            if ($type !== 'list_due_date') {
                $dueDate = '';
            }
            if ($type === 'list_due_date') {
                $content = normalizePlainTextContent($data['content'] ?? null);
            } elseif ($type === 'notes' || $type === 'links') {
                // content already normalized above via normalizeContent
            } else {
                $content = '';
            }

            $status = null;
            if ($type === 'list_due_date') {
                $statusRaw = $data['status'] ?? null;
                $status = in_array($statusRaw, ['', 'in_progress', 'waiting'], true) ? $statusRaw : null;
            }

            if ($status !== null) {
                $stmt = $db->prepare(
                    'UPDATE items
                     SET name = :name, barcode = :barcode, quantity = :quantity, due_date = :due_date, content = :content, status = :status, updated_at = CURRENT_TIMESTAMP
                     WHERE id = :id AND user_id = :user_id'
                );
                $stmt->execute([
                    ':id' => $id,
                    ':name' => $name,
                    ':barcode' => $barcode,
                    ':quantity' => $quantity,
                    ':due_date' => $dueDate,
                    ':content' => $content,
                    ':status' => $status,
                    ':user_id' => $userId,
                ]);
            } else {
                $stmt = $db->prepare(
                    'UPDATE items
                     SET name = :name, barcode = :barcode, quantity = :quantity, due_date = :due_date, content = :content, updated_at = CURRENT_TIMESTAMP
                     WHERE id = :id AND user_id = :user_id'
                );
                $stmt->execute([
                    ':id' => $id,
                    ':name' => $name,
                    ':barcode' => $barcode,
                    ':quantity' => $quantity,
                    ':due_date' => $dueDate,
                    ':content' => $content,
                    ':user_id' => $userId,
                ]);
            }

            if ($barcode !== '') {
                $db->prepare(
                    'INSERT INTO scanned_products (barcode, product_name, quantity, confirmed, scan_count, updated_at)
                     VALUES (:barcode, :product_name, :quantity, 1, 0, CURRENT_TIMESTAMP)
                     ON CONFLICT(barcode) DO UPDATE SET
                         product_name = excluded.product_name,
                         quantity     = excluded.quantity,
                         confirmed    = 1,
                         updated_at   = CURRENT_TIMESTAMP'
                )->execute([
                    ':barcode'      => $barcode,
                    ':product_name' => $name,
                    ':quantity'     => $quantity,
                ]);
            }

            respond(200, ['message' => 'Artikel aktualisiert.']);

        case 'delete':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if (!is_int($id)) {
                respond(422, ['error' => 'Ungültige ID.']);
            }

            $attachment = findAttachmentByItemId($db, $id);
            $db->beginTransaction();
            $stmt = $db->prepare('DELETE FROM items WHERE id = :id AND user_id = :user_id');
            $stmt->execute([':id' => $id, ':user_id' => $userId]);

            if ($stmt->rowCount() === 0) {
                $db->rollBack();
                respond(404, ['error' => 'Artikel nicht gefunden.']);
            }
            $db->commit();

            if ($attachment !== null) {
                try {
                    deleteAttachmentStorageFile($attachment);
                } catch (Throwable $cleanupException) {
                    error_log(sprintf('Einkauf attachment cleanup error [delete:%d]: %s', $id, $cleanupException->getMessage()));
                }
            }

            respond(200, ['message' => 'Artikel gelöscht.']);

        case 'clear':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $category = requireCategory($data, $db, $userId);

            $attachmentStmt = $db->prepare(
                'SELECT attachments.id, attachments.item_id, attachments.storage_section, attachments.stored_name
                 FROM attachments
                 INNER JOIN items ON items.id = attachments.item_id
                 WHERE items.done = 1 AND items.category_id = :category_id AND items.user_id = :user_id'
            );
            $attachmentStmt->execute([':category_id' => (int) $category['id'], ':user_id' => $userId]);
            $attachments = $attachmentStmt->fetchAll();

            $db->beginTransaction();
            $stmt = $db->prepare('DELETE FROM items WHERE done = 1 AND category_id = :category_id AND user_id = :user_id');
            $stmt->execute([':category_id' => (int) $category['id'], ':user_id' => $userId]);
            $deletedCount = (int) $stmt->rowCount();
            $db->commit();

            foreach ($attachments as $attachment) {
                try {
                    deleteAttachmentStorageFile($attachment);
                } catch (Throwable $cleanupException) {
                    error_log(sprintf('Einkauf attachment cleanup error [clear:%d:%d]: %s', (int) $category['id'], (int) ($attachment['item_id'] ?? 0), $cleanupException->getMessage()));
                }
            }

            respond(200, ['message' => 'Erledigte Artikel gelöscht.', 'deleted' => $deletedCount]);

        case 'reorder':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $category = requireCategory($data, $db, $userId);
            $orderedIds = normalizeIdList($data['ids'] ?? ($data['ids[]'] ?? null));
            if ($orderedIds === []) {
                respond(422, ['error' => 'Ungültige Reihenfolge.']);
            }

            $existingStmt = $db->prepare(
                'SELECT id FROM items WHERE category_id = :category_id AND user_id = :user_id ORDER BY sort_order ASC, id ASC'
            );
            $existingStmt->execute([':category_id' => (int) $category['id'], ':user_id' => $userId]);
            $existingIds = array_map(static fn(mixed $id): int => (int) $id, $existingStmt->fetchAll(PDO::FETCH_COLUMN));

            $sortedIds = $orderedIds;
            sort($sortedIds);
            $sortedExistingIds = $existingIds;
            sort($sortedExistingIds);

            if ($sortedIds !== $sortedExistingIds) {
                respond(422, ['error' => 'Reihenfolge passt nicht zur aktuellen Liste.']);
            }

            $stmt = $db->prepare(
                'UPDATE items SET sort_order = :sort_order, updated_at = CURRENT_TIMESTAMP WHERE id = :id AND user_id = :user_id'
            );

            $db->beginTransaction();
            foreach ($orderedIds as $index => $id) {
                $stmt->execute([
                    ':sort_order' => $index + 1,
                    ':id' => $id,
                    ':user_id' => $userId,
                ]);
            }
            $db->commit();

            respond(200, ['message' => 'Reihenfolge aktualisiert.']);

        case 'pin':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $isPinned = filter_var($data['is_pinned'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 1]]);

            if (!is_int($id) || !is_int($isPinned)) {
                respond(422, ['error' => 'Ungültige Parameter.']);
            }

            $stmt = $db->prepare('UPDATE items SET is_pinned = :is_pinned, updated_at = CURRENT_TIMESTAMP WHERE id = :id AND user_id = :user_id');
            $stmt->execute([':is_pinned' => $isPinned, ':id' => $id, ':user_id' => $userId]);

            if ($stmt->rowCount() === 0) {
                respond(404, ['error' => 'Artikel nicht gefunden.']);
            }

            respond(200, ['message' => 'Pinned-Status aktualisiert.']);

        case 'status':
            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $status = $data['status'] ?? null;

            if (!is_int($id) || !in_array($status, ['', 'in_progress', 'waiting'], true)) {
                respond(422, ['error' => 'Ungültige Parameter.']);
            }

            $stmt = $db->prepare('UPDATE items SET status = :status, updated_at = CURRENT_TIMESTAMP WHERE id = :id AND user_id = :user_id');
            $stmt->execute([':status' => $status, ':id' => $id, ':user_id' => $userId]);

            if ($stmt->rowCount() === 0) {
                respond(404, ['error' => 'Artikel nicht gefunden.']);
            }

            respond(200, ['message' => 'Status aktualisiert.']);

        case 'search':
            requireMethod('GET');
            $q = trim((string) ($_GET['q'] ?? ''));
            if (strlen($q) < 2) {
                respond(200, ['items' => []]);
            }

            $ftsQuery = sanitizeFtsQuery($q);
            if ($ftsQuery === '') {
                respond(200, ['items' => []]);
            }

            $stmt = $db->prepare(
                'SELECT
                    items.id,
                    items.category_id,
                    categories.name AS category_name,
                    categories.type AS category_type,
                    items.name,
                    items.barcode,
                    items.quantity,
                    items.due_date,
                    items.is_pinned,
                    items.status,
                    items.content,
                    items.done,
                    items.sort_order,
                    items.created_at,
                    items.updated_at,
                    attachments.storage_section AS attachment_storage_section,
                    attachments.stored_name AS attachment_stored_name,
                    attachments.original_name AS attachment_original_name,
                    attachments.media_type AS attachment_media_type,
                    attachments.size_bytes AS attachment_size_bytes,
                    attachments.updated_at AS attachment_updated_at,
                    CASE WHEN attachments.id IS NULL THEN 0 ELSE 1 END AS has_attachment
                 FROM items_fts
                 INNER JOIN items ON items.id = items_fts.rowid
                 INNER JOIN categories ON categories.id = items.category_id
                 LEFT JOIN attachments ON attachments.item_id = items.id
                 WHERE items_fts MATCH :q AND items.user_id = :user_id
                 ORDER BY rank
                 LIMIT 50'
            );
            $stmt->execute([':q' => $ftsQuery, ':user_id' => $userId]);

            $items = array_map(static fn(array $item): array => formatListItem($item), $stmt->fetchAll());
            respond(200, ['items' => $items]);

        case 'product_lookup':
            requireMethod('GET');
            $barcode = preg_replace('/\D+/', '', (string) ($_GET['barcode'] ?? '')) ?? '';
            $barcode = truncateText($barcode, 64);

            if ($barcode === '') {
                respond(422, ['error' => 'Ungültiger Barcode.']);
            }

            // 1. scanned_products — Single Point of Truth
            $stmt = $db->prepare(
                'SELECT barcode, product_name, brands, quantity
                 FROM scanned_products
                 WHERE barcode = :barcode
                 LIMIT 1'
            );
            $stmt->execute([':barcode' => $barcode]);
            $scanned = $stmt->fetch();

            if (is_array($scanned)) {
                respond(200, [
                    'product' => [
                        'barcode'      => (string) ($scanned['barcode'] ?? ''),
                        'product_name' => (string) ($scanned['product_name'] ?? ''),
                        'brands'       => (string) ($scanned['brands'] ?? ''),
                        'quantity'     => (string) ($scanned['quantity'] ?? ''),
                        'source'       => 'local',
                    ],
                ]);
            }

            // 2. product_catalog — OpenFoodFacts-Fallback
            $productDb = getProductDatabase();
            $stmt = $productDb->prepare(
                'SELECT barcode, product_name, brands, quantity
                 FROM product_catalog
                 WHERE barcode = :barcode
                 LIMIT 1'
            );
            $stmt->execute([':barcode' => $barcode]);
            $catalog = $stmt->fetch();

            if (is_array($catalog)) {
                $preferences = getExtendedUserPreferences($db, $userId);
                $usedAiNormalization = trim((string) ($preferences['gemini_api_key'] ?? '')) !== '';
                $normalizedCatalog = normalizeOpenFoodFactsProductWithAi([
                    'product_name' => (string) ($catalog['product_name'] ?? ''),
                    'brands' => (string) ($catalog['brands'] ?? ''),
                    'quantity' => (string) ($catalog['quantity'] ?? ''),
                ], $preferences);

                upsertScannedProduct($db, $barcode, $normalizedCatalog, false);

                respond(200, [
                    'product' => [
                        'barcode'      => (string) ($catalog['barcode'] ?? ''),
                        'product_name' => (string) ($normalizedCatalog['product_name'] ?? ''),
                        'brands'       => (string) ($normalizedCatalog['brands'] ?? ''),
                        'quantity'     => (string) ($normalizedCatalog['quantity'] ?? ''),
                        'source'       => $usedAiNormalization ? 'catalog_ai' : 'catalog',
                    ],
                ]);
            }


            respond(404, ['error' => 'Produkt nicht gefunden.']);

        case 'product_normalize_debug':
            requireMethod('GET');
            $barcode = preg_replace('/\D+/', '', (string) ($_GET['barcode'] ?? '')) ?? '';
            $barcode = truncateText($barcode, 64);

            if ($barcode === '') {
                respond(422, ['error' => 'Ungültiger Barcode.']);
            }

            $productDb = getProductDatabase();
            $stmt = $productDb->prepare(
                'SELECT barcode, product_name, brands, quantity, source
                 FROM product_catalog
                 WHERE barcode = :barcode
                 LIMIT 1'
            );
            $stmt->execute([':barcode' => $barcode]);
            $catalog = $stmt->fetch();

            if (!is_array($catalog)) {
                respond(404, ['error' => 'Produkt nicht gefunden.']);
            }

            $rawProduct = [
                'barcode' => (string) ($catalog['barcode'] ?? ''),
                'product_name' => (string) ($catalog['product_name'] ?? ''),
                'brands' => (string) ($catalog['brands'] ?? ''),
                'quantity' => (string) ($catalog['quantity'] ?? ''),
                'source' => (string) ($catalog['source'] ?? ''),
            ];
            $heuristicProduct = heuristicNormalizeProductData($rawProduct);
            $preferences = getExtendedUserPreferences($db, $userId);
            $aiProduct = normalizeOpenFoodFactsProductWithAi($rawProduct, $preferences);

            respond(200, [
                'barcode' => $barcode,
                'raw' => $rawProduct,
                'heuristic' => $heuristicProduct,
                'ai' => $aiProduct,
                'ai_enabled' => trim((string) ($preferences['gemini_api_key'] ?? '')) !== '',
            ]);

        case 'fetch_metadata':
            requireMethod('GET');
            $url = trim((string) ($_GET['url'] ?? ''));
            if ($url === '' || !filter_var($url, FILTER_VALIDATE_URL)) {
                respond(422, ['error' => 'Ungültige URL.']);
            }

            if (!isAllowedRemoteUrl($url)) {
                respond(422, ['error' => 'Nur externe HTTP(S)-Links sind erlaubt.']);
            }

            $remote = fetchRemoteHtml($url);
            if (!is_string($remote['html'] ?? null)) {
                respond(200, [
                    'title' => '',
                    'description' => '',
                    'image' => '',
                    'error' => (string) ($remote['error'] ?? 'Seite nicht abrufbar.'),
                ]);
            }

            $html = (string) $remote['html'];
            $title = extractMetaContent($html, 'property', 'og:title');
            if ($title === '') {
                $title = extractMetaContent($html, 'name', 'twitter:title');
            }
            if ($title === '' && preg_match('/<title[^>]*>(.*?)<\/title>/is', $html, $m) === 1) {
                $title = normalizeWhitespace(html_entity_decode((string) ($m[1] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
            }

            $description = extractMetaContent($html, 'property', 'og:description');
            if ($description === '') {
                $description = extractMetaContent($html, 'name', 'description');
            }
            if ($description === '') {
                $description = extractMetaContent($html, 'name', 'twitter:description');
            }

            $image = extractMetaContent($html, 'property', 'og:image');
            if ($image === '') {
                $image = extractMetaContent($html, 'name', 'twitter:image');
            }
            $image = absolutizeUrl($url, $image);

            if ($image !== '' && !filter_var($image, FILTER_VALIDATE_URL)) {
                $image = '';
            }

            respond(200, [
                'title' => truncateText($title, 200),
                'description' => truncateText($description, 500),
                'image' => $image,
            ]);

        case 'product_details':
            requireMethod('GET');
            $barcode = preg_replace('/\D+/', '', (string) ($_GET['barcode'] ?? '')) ?? '';
            $barcode = truncateText($barcode, 64);

            if ($barcode === '') {
                respond(422, ['error' => 'Ungültiger Barcode.']);
            }

            $productDb = getProductDatabase();
            $summaryStmt = $productDb->prepare(
                'SELECT barcode, product_name, brands, quantity, source
                 FROM product_catalog
                 WHERE barcode = :barcode
                 LIMIT 1'
            );
            $summaryStmt->execute([':barcode' => $barcode]);
            $summary = $summaryStmt->fetch();

            if (!is_array($summary)) {
                respond(404, ['error' => 'Produkt nicht gefunden.']);
            }

            $sources = [];
            $sourceNames = array_values(array_filter(array_map('trim', explode(',', (string) ($summary['source'] ?? '')))));

            foreach ($sourceNames as $dataset) {
                try {
                    $tableName = getProductCatalogTableName($dataset);
                } catch (InvalidArgumentException) {
                    continue;
                }

                $tableIdentifier = quoteSqlIdentifier($tableName);
                $exists = (bool) $productDb->query(
                    "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = " . $productDb->quote($tableName)
                )->fetchColumn();

                if (!$exists) {
                    continue;
                }

                $stmt = $productDb->prepare("SELECT * FROM {$tableIdentifier} WHERE code = :barcode LIMIT 1");
                $stmt->execute([':barcode' => $barcode]);
                $row = $stmt->fetch();

                if (!is_array($row)) {
                    continue;
                }

                $sources[] = [
                    'dataset' => $dataset,
                    'fields' => $row,
                ];
            }

            respond(200, [
                'product' => [
                    'barcode' => (string) ($summary['barcode'] ?? ''),
                    'product_name' => (string) ($summary['product_name'] ?? ''),
                    'brands' => (string) ($summary['brands'] ?? ''),
                    'quantity' => (string) ($summary['quantity'] ?? ''),
                    'source' => (string) ($summary['source'] ?? ''),
                ],
                'sources' => $sources,
            ]);

        case 'preferences':
            if ($_SERVER['REQUEST_METHOD'] === 'GET') {
                respond(200, ['preferences' => getExtendedUserPreferences($db, $userId)]);
            }

            requireMethod('POST');
            $data = requestData();
            if (!isApiKeyAuthRequest()) {
                requireCsrfToken($data);
            }

            $patch = [];

            if (array_key_exists('mode', $data) && is_string($data['mode'])) {
                $patch['mode'] = $data['mode'];
            }

            if (array_key_exists('tabs_hidden', $data)) {
                $patch['tabs_hidden'] = filter_var($data['tabs_hidden'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
            }

            if (array_key_exists('category_swipe_enabled', $data)) {
                $patch['category_swipe_enabled'] = filter_var($data['category_swipe_enabled'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
            }

            if (array_key_exists('product_scanner_enabled', $data)) {
                $patch['product_scanner_enabled'] = filter_var($data['product_scanner_enabled'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
            }

            if (array_key_exists('shopping_list_scanner_enabled', $data)) {
                $patch['shopping_list_scanner_enabled'] = filter_var($data['shopping_list_scanner_enabled'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
            }

            if (array_key_exists('magic_button_enabled', $data)) {
                $patch['magic_button_enabled'] = filter_var($data['magic_button_enabled'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
            }

            if (array_key_exists('install_banner_dismissed', $data)) {
                $patch['install_banner_dismissed'] = filter_var($data['install_banner_dismissed'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
            }

            if (array_key_exists('theme_mode', $data) && is_string($data['theme_mode'])) {
                $patch['theme_mode'] = $data['theme_mode'];
            }

            if (array_key_exists('last_category_id', $data)) {
                $lastCategoryId = filter_var($data['last_category_id'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
                if (is_int($lastCategoryId) && loadUserCategory($db, $userId, $lastCategoryId) !== null) {
                    $patch['last_category_id'] = $lastCategoryId;
                }
            }

            $preferences = updateExtendedUserPreferences($db, $userId, $patch);
            respond(200, ['preferences' => $preferences]);

        default:
            respond(404, ['error' => 'Unbekannte Aktion.']);
    }
} catch (Throwable $exception) {
    if ($db instanceof PDO && $db->inTransaction()) {
        $db->rollBack();
    }

    error_log(sprintf(
        'Einkauf API error [action=%s method=%s ip=%s]: %s',
        (string) $action,
        (string) ($_SERVER['REQUEST_METHOD'] ?? ''),
        (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
        (string) $exception
    ));
    respond(500, ['error' => 'Serverfehler.']);
}
