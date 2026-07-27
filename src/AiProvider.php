<?php
declare(strict_types=1);

/**
 * Tiefes Modul für KI-Provider-Resolution und Calls.
 *
 * Vier Funktionen, eine Verzweigung pro Provider, eine Validierungs-Stelle.
 * Caller (ai.php, ai-models.php) sehen nur resolveConfig() + call()/listModels().
 *
 * ponytail: keine Adapter-Klasse — switch auf zwei Strings ist billiger als
 * ein Interface mit zwei Implementierungen, solange kein dritter Provider
 * dazukommt. Bei drei Providern: echtes Adapter-Modul ziehen.
 */

/**
 * Löst die Provider-Konfiguration aus Prefs und Request auf.
 * Reihenfolge: Request-Override > Preferences > Built-in-Defaults.
 *
 * @return array{0: ?array, 1: ?array} [config, error]
 */
function aiProviderResolve(array $preferences, array $request): array
{
    $provider = (string) ($request['ai_provider'] ?? $preferences['ai_provider'] ?? 'gemini');
    $valid = array_keys(getAvailableProviders());
    if (!in_array($provider, $valid, true)) {
        $provider = 'gemini';
    }

    if ($provider === 'openai_compatible') {
        $key = trim((string) ($request['openai_compatible_api_key'] ?? $preferences['openai_compatible_api_key'] ?? ''));
        $model = trim((string) ($request['openai_compatible_model'] ?? $preferences['openai_compatible_model'] ?? ''));
        if ($model === '') $model = 'gpt-4o-mini';
        $baseUrl = trim((string) ($request['openai_compatible_base_url'] ?? $preferences['openai_compatible_base_url'] ?? ''));
        if ($baseUrl === '') $baseUrl = 'https://api.openai.com/v1';

        $urlError = aiProviderValidateBaseUrl($baseUrl);
        if ($urlError !== null) {
            return [null, ['status' => 422, 'message' => $urlError]];
        }

        return [[
            'provider' => 'openai_compatible',
            'key' => $key,
            'model' => $model,
            'base_url' => $baseUrl,
            'whitelist' => [],
        ], null];
    }

    // gemini
    $key = trim((string) ($request['gemini_api_key'] ?? $preferences['gemini_api_key'] ?? ''));
    $whitelist = getAvailableAiModels('gemini');
    $model = (string) ($request['gemini_model'] ?? $preferences['gemini_model'] ?? '');
    if ($model === '' || !array_key_exists($model, $whitelist)) {
        $model = array_key_first($whitelist) ?: 'gemini-2.5-flash';
    }

    return [[
        'provider' => 'gemini',
        'key' => $key,
        'model' => $model,
        'base_url' => '',
        'whitelist' => $whitelist,
    ], null];
}

/**
 * SSRF-Guard für vom Nutzer konfigurierte Basis-URL.
 * Erlaubt nur https:// oder http://localhost bzw. http://127.0.0.1.
 * ponytail: blockiert Cloud-Metadata-Endpoints. Upgrade wenn Multi-Tenant.
 */
function aiProviderValidateBaseUrl(string $baseUrl): ?string
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

/**
 * Callt den Provider und liefert strukturiertes Ergebnis.
 *
 * @return array{ok: bool, text: string, error: string, http_code: int}
 */
function aiProviderCall(array $config, string $prompt, array $opts = []): array
{
    return callAiProvider(
        $config['key'],
        $config['provider'],
        $config['model'],
        $prompt,
        $opts + ['base_url' => $config['base_url']]
    );
}

/**
 * Listet Modelle vom Provider.
 *
 * @return array{ok: bool, models: array, error: string}
 */
function aiProviderListModels(array $config): array
{
    if ($config['provider'] === 'gemini') {
        return listGeminiModels($config['key']);
    }
    return listOpenAiCompatibleModels($config['key'], $config['base_url']);
}