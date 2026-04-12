<?php
declare(strict_types=1);

$path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

if (
    $path === '/data' || str_starts_with($path, '/data/')
    || $path === '/.git' || str_starts_with($path, '/.git/')
) {
    http_response_code(404);
    exit;
}

return false;
