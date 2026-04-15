<?php
declare(strict_types=1);

/**
 * Unit tests for security.php
 */

require_once __DIR__ . '/../security.php';

function assertTrue($condition, $message = 'Assertion failed')
{
    if ($condition !== true) {
        throw new Exception($message);
    }
}

function test_getEnvBool()
{
    echo "Testing getEnvBool...\n";

    putenv('TEST_VAR=true');
    assertTrue(getEnvBool('TEST_VAR') === true, 'true should be true');

    putenv('TEST_VAR=1');
    assertTrue(getEnvBool('TEST_VAR') === true, '1 should be true');

    putenv('TEST_VAR=yes');
    assertTrue(getEnvBool('TEST_VAR') === true, 'yes should be true');

    putenv('TEST_VAR=on');
    assertTrue(getEnvBool('TEST_VAR') === true, 'on should be true');

    putenv('TEST_VAR=false');
    assertTrue(getEnvBool('TEST_VAR') === false, 'false should be false');

    putenv('TEST_VAR=0');
    assertTrue(getEnvBool('TEST_VAR') === false, '0 should be false');

    putenv('TEST_VAR=no');
    assertTrue(getEnvBool('TEST_VAR') === false, 'no should be false');

    putenv('TEST_VAR=off');
    assertTrue(getEnvBool('TEST_VAR') === false, 'off should be false');

    putenv('TEST_VAR=maybe');
    assertTrue(getEnvBool('TEST_VAR') === null, 'maybe should be null');

    putenv('TEST_VAR=');
    assertTrue(getEnvBool('TEST_VAR') === null, 'empty should be null');

    putenv('TEST_VAR'); // Unset
}

function test_isTrustedProxyPeer()
{
    echo "Testing isTrustedProxyPeer...\n";

    assertTrue(isTrustedProxyPeer('127.0.0.1') === true, '127.0.0.1 should be trusted');
    assertTrue(isTrustedProxyPeer('::1') === true, '::1 should be trusted');
    assertTrue(isTrustedProxyPeer('192.168.1.1') === false, '192.168.1.1 should not be trusted');
    assertTrue(isTrustedProxyPeer('8.8.8.8') === false, '8.8.8.8 should not be trusted');
    assertTrue(isTrustedProxyPeer('not-an-ip') === false, 'invalid IP should not be trusted');
    assertTrue(isTrustedProxyPeer('') === false, 'empty IP should not be trusted');
    assertTrue(isTrustedProxyPeer(null) === false, 'null IP should not be trusted');
    assertTrue(isTrustedProxyPeer(' 127.0.0.1 ') === true, 'trimmed 127.0.0.1 should be trusted');
}

function test_isLocalDevelopmentHost()
{
    echo "Testing isLocalDevelopmentHost...\n";

    assertTrue(isLocalDevelopmentHost('localhost') === true, 'localhost should be local');
    assertTrue(isLocalDevelopmentHost('127.0.0.1') === true, '127.0.0.1 should be local');
    assertTrue(isLocalDevelopmentHost('[::1]') === true, '[::1] should be local');
    assertTrue(isLocalDevelopmentHost('test.localhost') === true, 'test.localhost should be local');
    assertTrue(isLocalDevelopmentHost('') === true, 'empty host should be local');
    assertTrue(isLocalDevelopmentHost('ankerkladde.benduhn.de') === false, 'prod host should not be local');
    assertTrue(isLocalDevelopmentHost('google.com') === false, 'google.com should not be local');
}

function test_appPath()
{
    echo "Testing appPath...\n";

    $originalServer = $_SERVER;

    // Root path
    $_SERVER['SCRIPT_NAME'] = '/index.php';
    assertTrue(appPath() === '/', 'root appPath() should be /');
    assertTrue(appPath('api.php') === '/api.php', 'root appPath(api.php) should be /api.php');
    assertTrue(appPath('/api.php') === '/api.php', 'root appPath(/api.php) should be /api.php');

    // Subpath
    $_SERVER['SCRIPT_NAME'] = '/sub/index.php';
    assertTrue(appPath() === '/sub/', 'sub appPath() should be /sub/');
    assertTrue(appPath('api.php') === '/sub/api.php', 'sub appPath(api.php) should be /sub/api.php');
    assertTrue(appPath('/api.php') === '/sub/api.php', 'sub appPath(/api.php) should be /sub/api.php');

    // Deep subpath
    $_SERVER['SCRIPT_NAME'] = '/a/b/c/index.php';
    assertTrue(appPath() === '/a/b/c/', 'deep appPath() should be /a/b/c/');
    assertTrue(appPath('test') === '/a/b/c/test', 'deep appPath(test) should be /a/b/c/test');

    $_SERVER = $originalServer;
}

// Run tests
try {
    test_getEnvBool();
    test_isTrustedProxyPeer();
    test_isLocalDevelopmentHost();
    test_appPath();
    echo "\nAll security tests passed!\n";
} catch (Throwable $t) {
    echo "\nTest failed: " . $t->getMessage() . "\n";
    exit(1);
}
