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

// Run tests
try {
    test_getAvailableProviders();
    test_getProviderDisplayName();
    test_getAvailableAiModels();
    test_getActiveAiConfig();
    test_validateAiBaseUrl();
    echo "\nAll AiClient tests passed!\n";
} catch (Throwable $t) {
    echo "\nTest failed: " . $t->getMessage() . "\n";
    exit(1);
}
