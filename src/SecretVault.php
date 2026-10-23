<?php
declare(strict_types=1);

const SECRET_VAULT_PREFIX = 'enc:v1:';

function getSecretVaultKeyPath(): string
{
    return getDataDirectory() . '/.secret-key';
}

function getSecretVaultKey(bool $create = false): ?string
{
    static $cachedKey = null;
    if (is_string($cachedKey)) {
        return $cachedKey;
    }

    $configured = trim((string) (getenv('ANKERKLADDE_SECRET_KEY') ?: ''));
    if ($configured !== '') {
        $decoded = base64_decode($configured, true);
        $cachedKey = is_string($decoded) && strlen($decoded) === SODIUM_CRYPTO_SECRETBOX_KEYBYTES
            ? $decoded
            : hash('sha256', $configured, true);
        return $cachedKey;
    }

    $path = getSecretVaultKeyPath();
    if (is_file($path)) {
        $encoded = trim((string) file_get_contents($path));
        $decoded = base64_decode($encoded, true);
        if (!is_string($decoded) || strlen($decoded) !== SODIUM_CRYPTO_SECRETBOX_KEYBYTES) {
            throw new RuntimeException('Invalid Ankerkladde secret-vault key file.');
        }
        $cachedKey = $decoded;
        return $cachedKey;
    }

    if (!$create) {
        return null;
    }
    if (!function_exists('sodium_crypto_secretbox')) {
        throw new RuntimeException('PHP sodium extension is required to protect provider secrets.');
    }

    $key = random_bytes(SODIUM_CRYPTO_SECRETBOX_KEYBYTES);
    $temporaryPath = $path . '.tmp-' . bin2hex(random_bytes(6));
    if (file_put_contents($temporaryPath, base64_encode($key), LOCK_EX) === false) {
        throw new RuntimeException('Could not create the Ankerkladde secret-vault key.');
    }
    chmod($temporaryPath, 0600);
    if (!rename($temporaryPath, $path)) {
        throw new RuntimeException('Could not activate the Ankerkladde secret-vault key.');
    }
    $cachedKey = $key;
    return $cachedKey;
}

function encryptStoredSecret(string $plaintext): string
{
    if ($plaintext === '' || str_starts_with($plaintext, SECRET_VAULT_PREFIX)) {
        return $plaintext;
    }
    $key = getSecretVaultKey(true);
    $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    $ciphertext = sodium_crypto_secretbox($plaintext, $nonce, $key);
    return SECRET_VAULT_PREFIX . base64_encode($nonce . $ciphertext);
}

function decryptStoredSecret(string $stored): string
{
    if ($stored === '' || !str_starts_with($stored, SECRET_VAULT_PREFIX)) {
        return $stored;
    }
    $key = getSecretVaultKey(false);
    if ($key === null) {
        throw new RuntimeException('Ankerkladde secret-vault key is missing.');
    }
    $payload = base64_decode(substr($stored, strlen(SECRET_VAULT_PREFIX)), true);
    if (!is_string($payload) || strlen($payload) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) {
        throw new RuntimeException('Stored provider secret is malformed.');
    }
    $nonce = substr($payload, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    $plaintext = sodium_crypto_secretbox_open(substr($payload, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $nonce, $key);
    if (!is_string($plaintext)) {
        throw new RuntimeException('Stored provider secret could not be decrypted.');
    }
    return $plaintext;
}

function protectPreferenceSecrets(array $preferences): array
{
    foreach (['gemini_api_key', 'openai_compatible_api_key', 'openrouter_api_key'] as $key) {
        if (isset($preferences[$key]) && is_string($preferences[$key]) && $preferences[$key] !== '') {
            $preferences[$key] = encryptStoredSecret($preferences[$key]);
        }
    }
    return $preferences;
}

function revealPreferenceSecrets(array $preferences): array
{
    foreach (['gemini_api_key', 'openai_compatible_api_key', 'openrouter_api_key'] as $key) {
        if (isset($preferences[$key]) && is_string($preferences[$key])) {
            $preferences[$key] = decryptStoredSecret($preferences[$key]);
        }
    }
    return $preferences;
}
