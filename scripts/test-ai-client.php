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

    assertTrue(array_key_exists('openrouter', $providers), 'Should have openrouter provider');
    assertTrue($providers['openrouter'] === 'OpenRouter (verschiedene Modelle)', 'OpenRouter name should match');
}

function test_getProviderDisplayName()
{
    echo "Testing getProviderDisplayName...\n";

    assertTrue(getProviderDisplayName('gemini') === 'Google Gemini', 'gemini should map to Google Gemini');
    assertTrue(getProviderDisplayName('openrouter') === 'OpenRouter (verschiedene Modelle)', 'openrouter should map to OpenRouter (verschiedene Modelle)');
    assertTrue(getProviderDisplayName('unknown') === 'unknown', 'unknown provider should return itself');
    assertTrue(getProviderDisplayName('') === '', 'empty string should return empty string');
}

// Run tests
try {
    test_getAvailableProviders();
    test_getProviderDisplayName();
    echo "\nAll AiClient tests passed!\n";
} catch (Throwable $t) {
    echo "\nTest failed: " . $t->getMessage() . "\n";
    exit(1);
}
