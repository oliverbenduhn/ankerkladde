<?php
declare(strict_types=1);

function getAvailableProviders(): array
{
    return [
        'gemini' => 'Google Gemini',
        'openai_compatible' => 'OpenAI-kompatibel (z.B. OpenAI, OpenRouter, LiteLLM)',
    ];
}

/**
 * Whitelist modelle für Provider mit hartcodierter API-Form.
 * openai_compatibel hat keine Whitelist — Modell ist Freitext.
 */
function getAvailableAiModels(string $provider): array
{
    if ($provider === 'gemini') {
        return [
            'gemini-2.5-flash' => 'Gemini 2.5 Flash',
            'gemini-3-flash-preview' => 'Gemini 3 Flash Preview',
        ];
    }

    return [];
}

function getActiveAiConfig(array $preferences): array
{
    $provider = (string) ($preferences['ai_provider'] ?? 'gemini');
    $validProviders = array_keys(getAvailableProviders());
    if (!in_array($provider, $validProviders, true)) {
        $provider = 'gemini';
    }

    $availableModels = getAvailableAiModels($provider);

    if ($provider === 'openai_compatible') {
        $key = trim((string) ($preferences['openai_compatible_api_key'] ?? ''));
        $model = trim((string) ($preferences['openai_compatible_model'] ?? 'gpt-4o-mini'));
        $baseUrl = trim((string) ($preferences['openai_compatible_base_url'] ?? 'https://api.openai.com/v1'));
    } else {
        $key = trim((string) ($preferences['gemini_api_key'] ?? ''));
        $model = (string) ($preferences['gemini_model'] ?? 'gemini-2.5-flash');
        $baseUrl = '';
        if (!array_key_exists($model, $availableModels)) {
            $model = 'gemini-2.5-flash';
        }
    }

    return [
        'provider' => $provider,
        'key' => $key,
        'model' => $model,
        'base_url' => $baseUrl,
        'available_models' => $availableModels,
    ];
}

/**
 * Call an AI provider with a prompt and return structured result.
 *
 * @return array{ok: bool, text: string, error: string, http_code: int}
 */
function callAiProvider(string $apiKey, string $provider, string $model, string $prompt, array $options = []): array
{
    $timeout = (int) ($options['timeout'] ?? 20);
    $connectTimeout = (int) ($options['connect_timeout'] ?? 5);
    $jsonMode = (bool) ($options['json_mode'] ?? false);
    $temperature = $options['temperature'] ?? null;
    $baseUrl = (string) ($options['base_url'] ?? '');

    if ($provider === 'openai_compatible') {
        return callOpenAiCompatible($apiKey, $baseUrl, $model, $prompt, $timeout, $connectTimeout, $jsonMode, $temperature);
    }

    return callGemini($apiKey, $model, $prompt, $timeout, $connectTimeout, $jsonMode, $temperature);
}

function callGemini(string $apiKey, string $model, string $prompt, int $timeout, int $connectTimeout, bool $jsonMode, $temperature): array
{
    $url = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent';

    $payload = [
        'contents' => [[
            'parts' => [['text' => $prompt]],
        ]],
    ];

    if ($jsonMode) {
        $payload['generationConfig']['response_mime_type'] = 'application/json';
    }
    if ($temperature !== null) {
        $payload['generationConfig']['temperature'] = $temperature;
    }

    $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $apiKeyHeader = 'x-goog-api-key: ' . $apiKey;

    $ch = curl_init($url);
    if ($ch === false) {
        return ['ok' => false, 'text' => '', 'error' => 'cURL init failed', 'http_code' => 0];
    }

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $encoded === false ? '{}' : $encoded,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => $connectTimeout,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: application/json',
            $apiKeyHeader,
        ],
    ]);

    $response = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($response === false) {
        return ['ok' => false, 'text' => '', 'error' => $curlError, 'http_code' => 0];
    }

    if ($httpCode !== 200) {
        $decoded = json_decode($response, true);
        $apiMessage = trim((string) (($decoded['error']['message'] ?? '')));
        return ['ok' => false, 'text' => '', 'error' => $apiMessage, 'http_code' => $httpCode];
    }

    $result = json_decode($response, true);
    $text = trim((string) ($result['candidates'][0]['content']['parts'][0]['text'] ?? ''));

    return ['ok' => true, 'text' => $text, 'error' => '', 'http_code' => $httpCode];
}

/**
 * SSRF-Guard für vom Nutzer konfigurierte Basis-URL.
 * Erlaubt nur https:// oder http://localhost bzw. http://127.0.0.1.
 * ponytail: blockiert Cloud-Metadata-Endpoints. Upgrade wenn Multi-Tenant.
 */
function validateAiBaseUrl(string $baseUrl): ?string
{
    $baseUrl = trim($baseUrl);
    if ($baseUrl === '') {
        return 'Bitte eine Basis-URL angeben.';
    }
    if (!preg_match('#^https://#i', $baseUrl)
        && !preg_match('#^http://(localhost|127\.0\.0\.1)(:\d+)?(/|$)#i', $baseUrl)) {
        return 'Nur https:// oder http://localhost (http://127.0.0.1) erlaubt.';
    }
    return null;
}

function callOpenAiCompatible(string $apiKey, string $baseUrl, string $model, string $prompt, int $timeout, int $connectTimeout, bool $jsonMode, $temperature): array
{
    $baseUrl = rtrim($baseUrl, '/');
    $url = $baseUrl . '/chat/completions';

    $payload = [
        'model' => $model,
        'messages' => [
            ['role' => 'user', 'content' => $prompt],
        ],
    ];

    if ($jsonMode) {
        $payload['response_format'] = ['type' => 'json_object'];
    }
    if ($temperature !== null) {
        $payload['temperature'] = $temperature;
    }

    $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $headers = [
        'Content-Type: application/json',
        'Accept: application/json',
    ];
    if ($apiKey !== '') {
        $headers[] = 'Authorization: Bearer *** ' . $apiKey;
    }

    $ch = curl_init($url);
    if ($ch === false) {
        return ['ok' => false, 'text' => '', 'error' => 'cURL init failed', 'http_code' => 0];
    }

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $encoded === false ? '{}' : $encoded,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => $connectTimeout,
        CURLOPT_HTTPHEADER => $headers,
    ]);

    $response = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($response === false) {
        return ['ok' => false, 'text' => '', 'error' => $curlError, 'http_code' => 0];
    }

    if ($httpCode !== 200) {
        $decoded = json_decode($response, true);
        $apiMessage = trim((string) (
            $decoded['error']['message']
            ?? $decoded['error']
            ?? ''
        ));
        return ['ok' => false, 'text' => '', 'error' => $apiMessage, 'http_code' => $httpCode];
    }

    $result = json_decode($response, true);
    $text = trim((string) ($result['choices'][0]['message']['content'] ?? ''));

    return ['ok' => true, 'text' => $text, 'error' => '', 'http_code' => $httpCode];
}

function getProviderDisplayName(string $provider): string
{
    $providers = getAvailableProviders();
    return $providers[$provider] ?? $provider;
}
