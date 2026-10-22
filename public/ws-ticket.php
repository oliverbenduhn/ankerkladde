<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';

enforceCanonicalRequest();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed.']);
    exit;
}

$userId = requireApiAuth();
try {
    echo json_encode(['ticket' => createWebSocketTicket($userId)], JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    error_log('WebSocket ticket error: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['error' => 'Live synchronization is not configured.']);
}
