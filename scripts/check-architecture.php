<?php
declare(strict_types=1);
$root = dirname(__DIR__);
$api = (string) file_get_contents($root . '/public/api.php');
if (preg_match('/\bfunction\s+\w+\s*\(|\$db->(?:prepare|query|exec)\s*\(|\bcase\s+[\'"]/', $api)) {
    throw new RuntimeException('API entrypoint owns transport wiring only. Put actions and SQL in src/Api use-case modules.');
}
$css = preg_replace('~/\*.*?\*/~s', '', (string) file_get_contents($root . '/public/style.css'));
$css = preg_replace('/@import\s+url\([^;]+;/', '', $css);
if (trim($css) !== '') throw new RuntimeException('style.css owns import order only. Put component rules in public/styles.');
echo "Architecture ownership checks passed.\n";
