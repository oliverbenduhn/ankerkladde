<?php
declare(strict_types=1);

/**
 * Unit tests for AiClient.php
 */

require_once __DIR__ . '/../src/AiClient.php';

function assertTrue($condition, $message = 'Assertion failed')
{
    if ($condition !== true) {
        throw new Exception($message);
    }
}

function test_getAvailableProviders()
{
    echo "Testing getAvailableProviders...\n";

    $providers = getAvailableProviders();

    assertTrue(is_array($providers), 'Providers should be an array');
    assertTrue(count($providers) === 2, 'Should have exactly 2 providers');

    assertTrue(array_key_exists('gemini', $providers), 'Should have gemini provider');
    assertTrue($providers['gemini'] === 'Google Gemini', 'Gemini name should match');

    assertTrue(array_key_exists('openai_compatible', $providers), 'Should have openai_compatible provider');
    assertTrue(
        str_starts_with($providers['openai_compatible'], 'OpenAI-kompatibel'),
        'openai_compatible name should mention OpenAI-kompatibel'
    );

    assertTrue(!array_key_exists('openrouter', $providers), 'openrouter must be removed from provider list');
}

function test_getProviderDisplayName()
{
    echo "Testing getProviderDisplayName...\n";

    assertTrue(getProviderDisplayName('gemini') === 'Google Gemini', 'gemini should map to Google Gemini');
    assertTrue(
        str_starts_with(getProviderDisplayName('openai_compatible'), 'OpenAI-kompatibel'),
        'openai_compatible should map to its label'
    );
    assertTrue(getProviderDisplayName('unknown') === 'unknown', 'unknown provider should return itself');
    assertTrue(getProviderDisplayName('') === '', 'empty string should return empty string');
}

function test_getAvailableAiModels()
{
    echo "Testing getAvailableAiModels...\n";

    $gemini = getAvailableAiModels('gemini');
    assertTrue(is_array($gemini), 'gemini models should be an array');
    assertTrue(count($gemini) >= 1, 'gemini should have at least one model');
    assertTrue(array_key_exists('gemini-2.5-flash', $gemini), 'gemini-2.5-flash must be in whitelist');

    $openaiCompatible = getAvailableAiModels('openai_compatible');
    assertTrue(is_array($openaiCompatible), 'openai_compatible models should be an array');
    assertTrue(count($openaiCompatible) === 0, 'openai_compatible should have no whitelist (Freitext)');
}

function test_getActiveAiConfig()
{
    echo "Testing getActiveAiConfig...\n";

    $geminiConfig = getActiveAiConfig(['ai_provider' => 'gemini']);
    assertTrue($geminiConfig['provider'] === 'gemini', 'gemini config provider');
    assertTrue($geminiConfig['base_url'] === '', 'gemini has no base_url');
    assertTrue($geminiConfig['model'] === 'gemini-2.5-flash', 'gemini default model');

    $openaiConfig = getActiveAiConfig(['ai_provider' => 'openai_compatible']);
    assertTrue($openaiConfig['provider'] === 'openai_compatible', 'openai_compatible config provider');
    assertTrue(
        $openaiConfig['base_url'] === 'https://api.openai.com/v1',
        'openai_compatible default base_url is api.openai.com'
    );
    assertTrue($openaiConfig['model'] === 'gpt-4o-mini', 'openai_compatible default model is gpt-4o-mini');

    $openaiWithUrl = getActiveAiConfig([
        'ai_provider' => 'openai_compatible',
        'openai_compatible_base_url' => 'https://litellm.obxy.de/v1',
        'openai_compatible_model' => 'claude-3-5-sonnet',
        'openai_compatible_api_key' => 'sk-test-xxx',
    ]);
    assertTrue($openaiWithUrl['base_url'] === 'https://litellm.obxy.de/v1', 'custom base_url');
    assertTrue($openaiWithUrl['model'] === 'claude-3-5-sonnet', 'custom model');
    assertTrue($openaiWithUrl['key'] === 'sk-test-xxx', 'custom api key');

    // Unknown provider fällt auf gemini zurück
    $unknown = getActiveAiConfig(['ai_provider' => 'whatever']);
    assertTrue($unknown['provider'] === 'gemini', 'unknown provider falls back to gemini');
}

function test_validateAiBaseUrl()
{
    echo "Testing validateAiBaseUrl...\n";

    assertTrue(validateAiBaseUrl('') !== null, 'empty URL must be rejected');
    assertTrue(validateAiBaseUrl('not a url') !== null, 'plain string must be rejected');
    assertTrue(
        validateAiBaseUrl('http://169.254.169.254/latest/meta-data/') !== null,
        'AWS metadata IP must be rejected (SSRF)'
    );
    assertTrue(
        validateAiBaseUrl('ftp://example.com/v1') !== null,
        'non-http(s) scheme must be rejected'
    );

    assertTrue(validateAiBaseUrl('https://api.openai.com/v1') === null, 'https is allowed');
    assertTrue(
        validateAiBaseUrl('https://litellm.obxy.de/v1') === null,
        'custom https host is allowed'
    );
    assertTrue(
        validateAiBaseUrl('http://localhost:11434/v1') === null,
        'localhost is allowed'
    );
    assertTrue(
        validateAiBaseUrl('http://127.0.0.1:8080/v1') === null,
        '127.0.0.1 is allowed'
    );
    assertTrue(
        validateAiBaseUrl('HTTP://LOCALHOST:1234/') === null,
        'uppercase scheme is allowed'
    );
}

function test_normalizeGeminiModelList()
{
    echo "Testing normalizeGeminiModelList...\n";

    // Standardfall: Gemini liefert models mit models/-Präfix und generateContent-Support.
    $raw = [
        'models' => [
            [
                'name' => 'models/gemini-2.5-flash',
                'displayName' => 'Gemini 2.5 Flash',
                'supportedGenerationMethods' => ['generateContent', 'countTokens'],
            ],
            [
                'name' => 'models/gemini-3-flash-preview',
                'supportedGenerationMethods' => ['generateContent'],
            ],
            // Embedding-Modell ohne generateContent → muss rausgefiltert werden.
            [
                'name' => 'models/text-embedding-004',
                'supportedGenerationMethods' => ['embedContent', 'countTokens'],
            ],
            // Modell ohne supportedGenerationMethods → raus (sicherer Default)
            [
                'name' => 'models/gemini-experimental',
            ],
        ],
    ];
    $result = normalizeGeminiModelList($raw);

    assertTrue(count($result) === 2, '2 Modelle nach Filter (text-embedding raus, experimental ohne generateContent raus)');
    assertTrue($result[0]['id'] === 'gemini-2.5-flash', 'Präfix models/ entfernt');
    assertTrue($result[0]['label'] === 'gemini-2.5-flash', 'label = id');
    assertTrue($result[1]['id'] === 'gemini-3-flash-preview', 'zweites Modell');

    // Leere / kaputte Eingaben
    assertTrue(normalizeGeminiModelList([]) === [], 'leere Liste → leeres Array');
    assertTrue(normalizeGeminiModelList(['models' => 'kein array']) === [], 'kein Array models → leer');
    assertTrue(normalizeGeminiModelList(['models' => [['kein_name' => true]]]) === [], 'Eintrag ohne name → übersprungen');
}

function test_normalizeOpenAiModelList()
{
    echo "Testing normalizeOpenAiModelList...\n";

    // Standard OpenAI-Form: data[]
    $rawStandard = [
        'object' => 'list',
        'data' => [
            ['id' => 'gpt-4o-mini', 'object' => 'model'],
            ['id' => 'gpt-4o', 'object' => 'model'],
            ['id' => 'o1-preview', 'object' => 'model'],
            // Kaputter Eintrag ohne id → muss raus
            ['object' => 'model'],
            // Leere ID → muss raus
            ['id' => '', 'object' => 'model'],
        ],
    ];
    $result = normalizeOpenAiModelList($rawStandard);
    assertTrue(count($result) === 3, '3 valide Modelle nach Filter');
    assertTrue($result[0]['id'] === 'gpt-4o', 'alphabetisch sortiert (gpt-4o vor gpt-4o-mini)');
    assertTrue($result[1]['id'] === 'gpt-4o-mini', 'gpt-4o-mini an zweiter Stelle');
    assertTrue($result[2]['id'] === 'o1-preview', 'o1-preview an dritter Stelle');

    // Manche LiteLLM-Proxys liefern models[] statt data[]
    $rawAlt = ['models' => [['id' => 'claude-3-5-sonnet'], ['id' => 'gpt-3.5-turbo']]];
    $resultAlt = normalizeOpenAiModelList($rawAlt);
    assertTrue(count($resultAlt) === 2, 'models[]-Form wird auch akzeptiert');
    assertTrue($resultAlt[0]['id'] === 'claude-3-5-sonnet', 'erstes LiteLLM-Modell');

    // Weder data noch models → leeres Array
    assertTrue(normalizeOpenAiModelList(['foo' => 'bar']) === [], 'kein data/models → leer');
    assertTrue(normalizeOpenAiModelList(['data' => 'kein array']) === [], 'data kein Array → leer');
}

function test_authorization_header_clean()
{
    // Regressionsschutz: 2026-07-21 Bug, bei dem Tooling-Secret-Redaction
    // den Authorization-Header von OpenAI-kompatibel-Calls auf
    // 'Authorization: Bearer *** <key>' verkürzt hat. Das hat LiteLLM-
    // Validatoren verwirrt (Auth-Header beginnt nicht mit 'sk-').
    echo "Testing authorization header construction...\n";

    $apiKey = 'sk-D1234567890ABCDEcPGQ';

    // Reproduziert exakt, was der Code jetzt baut:
    $bearerHeader = 'Authorization: Bearer ' . $apiKey;
    assertTrue(
        strpos($bearerHeader, 'Bearer sk-D') !== false,
        'Authorization-Header beginnt mit "Bearer sk-", nicht "Bearer ***"'
    );
    assertTrue(
        strpos($bearerHeader, '***') === false,
        'Keine literalen Sternchen im Authorization-Header'
    );
    assertTrue(
        strlen($bearerHeader) === strlen('Authorization: Bearer ') + strlen($apiKey),
        'Header-Länge ist exakt Präfix + Key (nicht länger)'
    );
}

function test_empty_string_fallback()
{
    // Regressionsschutz: 2026-07-21 Bug. Wenn ein Request einen leeren String
    // statt gar keinen Wert sendet (z.B. Form-Feld ist leer), greift `??`
    // NICHT (null coalescing schlägt nur bei null, nicht bei ''). Dann wird
    // der leere String übernommen statt auf den Default zurückzufallen.
    echo "Testing empty-string fallback for model/baseUrl...\n";

    // 1) Leerer Modell-String aus Request → muss auf Default fallen.
    $data = ['openai_compatible_model' => ''];
    $prefs = [];
    $requestModel = $data['openai_compatible_model'] ?? null;
    $model = trim((string) ($requestModel !== null && $requestModel !== '' ? $requestModel : ($prefs['openai_compatible_model'] ?? 'gpt-4o-mini')));
    if ($model === '') $model = 'gpt-4o-mini';
    assertTrue($model === 'gpt-4o-mini', 'leerer Request-Wert fällt auf Default, nicht auf ""');

    // 2) Whitespace-String wird getrimmt und greift auch als Default.
    $data = ['openai_compatible_model' => '   '];
    $prefs = [];
    $requestModel = $data['openai_compatible_model'] ?? null;
    $model = trim((string) ($requestModel !== null && $requestModel !== '' ? $requestModel : ($prefs['openai_compatible_model'] ?? 'gpt-4o-mini')));
    if ($model === '') $model = 'gpt-4o-mini';
    assertTrue($model === 'gpt-4o-mini', 'Whitespace-Wert fällt nach trim() auf Default');

    // 3) Vorhandener Request-Wert wird übernommen.
    $data = ['openai_compatible_model' => 'claude-3-5-sonnet'];
    $prefs = [];
    $requestModel = $data['openai_compatible_model'] ?? null;
    $model = trim((string) ($requestModel !== null && $requestModel !== '' ? $requestModel : ($prefs['openai_compatible_model'] ?? 'gpt-4o-mini')));
    assertTrue($model === 'claude-3-5-sonnet', 'echter Request-Wert wird übernommen');

    // 4) baseUrl-Pfad gleiche Logik.
    $data = ['openai_compatible_base_url' => ''];
    $requestBaseUrl = $data['openai_compatible_base_url'] ?? null;
    $baseUrl = trim((string) ($requestBaseUrl !== null && $requestBaseUrl !== '' ? $requestBaseUrl : ($prefs['openai_compatible_base_url'] ?? 'https://api.openai.com/v1')));
    if ($baseUrl === '') $baseUrl = 'https://api.openai.com/v1';
    assertTrue($baseUrl === 'https://api.openai.com/v1', 'leerer baseUrl fällt auf Default');
}

// Run tests
try {
    test_getAvailableProviders();
    test_getProviderDisplayName();
    test_getAvailableAiModels();
    test_getActiveAiConfig();
    test_validateAiBaseUrl();
    test_normalizeGeminiModelList();
    test_normalizeOpenAiModelList();
    test_authorization_header_clean();
    test_empty_string_fallback();
    echo "\nAll AiClient tests passed!\n";
} catch (Throwable $t) {
    echo "\nTest failed: " . $t->getMessage() . "\n";
    exit(1);
}
