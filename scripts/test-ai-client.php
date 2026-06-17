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

function test_getProviderDisplayName()
{
    echo "Testing getProviderDisplayName...\n";

    assertTrue(getProviderDisplayName('gemini') === 'Google Gemini', 'gemini should map to Google Gemini');
    assertTrue(getProviderDisplayName('openrouter') === 'OpenRouter', 'openrouter should map to OpenRouter');
    assertTrue(getProviderDisplayName('unknown') === 'unknown', 'unknown provider should return itself');
    assertTrue(getProviderDisplayName('') === '', 'empty string should return empty string');
}

// Run tests
try {
    test_getProviderDisplayName();
    echo "\nAll AiClient tests passed!\n";
} catch (Throwable $t) {
    echo "\nTest failed: " . $t->getMessage() . "\n";
    exit(1);
}
