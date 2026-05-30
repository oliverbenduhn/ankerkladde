<?php
declare(strict_types=1);

function getAvailableProviders(): array
{
    return [
        'gemini' => 'Google Gemini',
        'openrouter' => 'OpenRouter',
    ];
}

function getAvailableAiModels(string $provider): array
{
    if ($provider === 'openrouter') {
        return [
            'google/gemini-2.5-flash' => 'Gemini 2.5 Flash',
            'google/gemini-2.5-pro' => 'Gemini 2.5 Pro',
            'openai/gpt-4o-mini' => 'GPT-4o Mini',
            'anthropic/claude-sonnet-4' => 'Claude Sonnet 4',
            'meta-llama/llama-4-maverick' => 'Llama 4 Maverick',
            'mimo/mimo-v2.5' => 'MiMo v2.5',
            'mimo/mimo-v2.5-pro' => 'MiMo v2.5 Pro',
        ];
    }

    return [
        'gemini-2.5-flash' => 'Gemini 2.5 Flash',
        'gemini-3-flash-preview' => 'Gemini 3 Flash Preview',
    ];
}

function getActiveAiConfig(array $preferences): array
{
    $provider = (string) ($preferences['ai_provider'] ?? 'gemini');
    $validProviders = array_keys(getAvailableProviders());
    if (!in_array($provider, $validProviders, true)) {
        $provider = 'gemini';
    }

    $availableModels = getAvailableAiModels($provider);

    if ($provider === 'openrouter') {
        $key = trim((string) ($preferences['openrouter_api_key'] ?? ''));
        $model = (string) ($preferences['openrouter_model'] ?? '');
        if (!array_key_exists($model, $availableModels)) {
            $model = array_key_first($availableModels);
        }
    } else {
        $key = trim((string) ($preferences['gemini_api_key'] ?? ''));
        $model = (string) ($preferences['gemini_model'] ?? 'gemini-2.5-flash');
        if (!array_key_exists($model, $availableModels)) {
            $model = 'gemini-2.5-flash';
        }
    }

    return [
        'provider' => $provider,
        'key' => $key,
        'model' => $model,
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

    if ($provider === 'openrouter') {
        return callOpenRouter($apiKey, $model, $prompt, $timeout, $connectTimeout, $jsonMode, $temperature);
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
            'x-goog-api-key: ' . $apiKey,
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

function callOpenRouter(string $apiKey, string $model, string $prompt, int $timeout, int $connectTimeout, bool $jsonMode, $temperature): array
{
    $url = 'https://openrouter.ai/api/v1/chat/completions';

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
            'Authorization: Bearer ' . $apiKey,
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
