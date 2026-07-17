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

    preg_match_all('/(?:from\s+|import\s*)[\'\"]\.\/[^\'\"]+\?v=([^\'\"]+)[\'\"]/', $source, $matches, PREG_SET_ORDER);
    foreach ($matches as $match) {
        if (($match[1] ?? '') !== $expected) {
            $errors[] = basename($file) . ': v=' . ($match[1] ?? '<leer>') . ' statt v=' . $expected;
        }
    }
}

if ($errors !== []) {
    fwrite(STDERR, "Inkonsistente JS-Cache-Versionen:\n- " . implode("\n- ", $errors) . "\n");
    exit(1);
}

echo "JS-Cache-Versionen konsistent: v={$expected}\n";
