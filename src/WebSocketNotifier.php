<?php
declare(strict_types=1);

/**
 * Best-effort notification boundary for the optional WebSocket process.
 * Authentication and transport details stay out of controllers/API handlers.
 */
function notifyWebSocketUser(int $userId, string $action = 'update', int $timeoutMs = 150): void
{
    $secret = getWebSocketSharedSecret();
    if ($secret === '') {
        return;
    }

    $configuredUrl = trim((string) (getenv('WS_NOTIFY_URL') ?: ''));
    if ($configuredUrl !== '') {
        $url = $configuredUrl;
    } else {
        $host = (string) (getenv('WS_HOST') ?: '127.0.0.1');
        $port = (string) (getenv('WS_PORT') ?: '3000');
        $url = "http://{$host}:{$port}/notify";
    }

    $body = json_encode([
        'action' => $action,
        'user_id' => $userId,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($body)) {
        return;
    }

    $headers = [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $secret,
    ];

    if (function_exists('curl_init')) {
        $handle = curl_init($url);
        if ($handle === false) {
            return;
        }
        try {
            curl_setopt_array($handle, [
                CURLOPT_CUSTOMREQUEST => 'POST',
                CURLOPT_POSTFIELDS => $body,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CONNECTTIMEOUT_MS => $timeoutMs,
                CURLOPT_TIMEOUT_MS => $timeoutMs,
                CURLOPT_NOSIGNAL => true,
                CURLOPT_HTTPHEADER => $headers,
            ]);
            if (curl_exec($handle) === false) {
                error_log('[WS] Notification failed: ' . curl_error($handle));
            }
        } finally {
            curl_close($handle);
        }
        return;
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => implode("\r\n", $headers),
            'content' => $body,
            'timeout' => max(0.05, $timeoutMs / 1000),
            'ignore_errors' => true,
        ],
    ]);
    @file_get_contents($url, false, $context);
}
