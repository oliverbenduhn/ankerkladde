<?php
declare(strict_types=1);

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
        return false;
    }

    return str_contains($contentType, 'text/html') || str_contains($contentType, 'application/xhtml+xml');
}

function fetchWithCurl(string $url, int $connectTimeoutSeconds, int $requestTimeoutSeconds, int $maxRedirects, array $headers): array
{
    $ch = curl_init($url);
    if ($ch === false) {
        return ['html' => null, 'error' => t('error.curl_init_failed'), 'error_key' => 'error.curl_init_failed'];
    }

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        // Do not auto-follow redirects: each target must pass the SSRF allow-check.
        CURLOPT_FOLLOWLOCATION => false,
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

    if (!is_string($body) || $body === '') {
        return ['html' => null, 'error' => $error !== '' ? $error : t('error.page_unreachable'), 'error_key' => 'error.page_unreachable'];
    }

    if ($status >= 400) {
        return ['html' => null, 'error' => 'HTTP ' . $status];
    }

    if (!isHtmlContentType($contentType)) {
        return ['html' => null, 'error' => t('error.not_html'), 'error_key' => 'error.not_html'];
    }

    return ['html' => truncateText($body, 512000), 'error' => null];
}

function fetchWithStream(string $url, int $requestTimeoutSeconds, int $maxRedirects, array $headers): array
{
    $context = stream_context_create([
        'http' => [
            'timeout' => $requestTimeoutSeconds,
            'follow_location' => 0,
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
        return ['html' => null, 'error' => is_array($error) ? (string) ($error['message'] ?? t('error.page_unreachable')) : t('error.page_unreachable'), 'error_key' => 'error.page_unreachable'];
    }

    if (($responseHeaders['status'] ?? 0) >= 400) {
        return ['html' => null, 'error' => 'HTTP ' . $responseHeaders['status']];
    }

    if (!isHtmlContentType((string) ($responseHeaders['content_type'] ?? ''))) {
        return ['html' => null, 'error' => t('error.not_html'), 'error_key' => 'error.not_html'];
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
