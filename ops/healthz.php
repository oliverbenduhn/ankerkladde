<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

try {
    $db = getDatabase();
    $itemCount = (int) $db->query('SELECT COUNT(*) FROM items')->fetchColumn();

    http_response_code(200);
    echo json_encode([
        'status' => 'ok',
        'service' => 'einkauf',
        'items' => $itemCount,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $exception) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'service' => 'einkauf',
        'message' => $exception->getMessage(),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
