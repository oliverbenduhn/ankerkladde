<?php
declare(strict_types=1);

$root = dirname(__DIR__);
$expected = (string) require $root . '/public/version.php';
$errors = [];

foreach (glob($root . '/public/js/*.js') ?: [] as $file) {
    $source = file_get_contents($file);
    if (!is_string($source)) {
        $errors[] = basename($file) . ': nicht lesbar';
        continue;
    }

    preg_match_all('/(?:from\s+|import\s*)[\'"]\.\/[^\'"]+\?v=([^\'"]+)[\'"]/', $source, $matches, PREG_SET_ORDER);
    foreach ($matches as $match) {
        $errors[] = basename($file) . ': hat ?v=' . ($match[1] ?? '<leer>') . ' — interne JS-Imports sollen keine Version mehr enthalten (Service Worker versieht sie selbst)';
    }
}

if ($errors !== []) {
    fwrite(STDERR, "Veraltete JS-Cache-Versionen gefunden:\n- " . implode("\n- ", $errors) . "\n");
    exit(1);
}

echo "JS-Cache-Versionen konsistent: keine hardcodierten ?v= in internen Imports (Service Worker versieht sie selbst, aktuell v={$expected})\n";
