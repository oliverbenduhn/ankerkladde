<?php
declare(strict_types=1);

$root = dirname(__DIR__) . '/public';
$errors = [];
foreach (array_merge([$root . '/style.css'], glob($root . '/styles/*.css') ?: []) as $file) {
    $css = preg_replace('~/\*.*?\*/~s', '', (string) file_get_contents($file));
    foreach (explode("\n", $css) as $lineNumber => $line) {
        if (basename($file) === 'roles.css' && preg_match('/^\s*--[\w-]+\s*:/', $line)) continue;
        if (preg_match('/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb)\s*\(|:\s*(?:white|black|red|blue|green|gray|grey|yellow|orange|purple)\b/i', $line)) {
            $errors[] = basename($file) . ':' . ($lineNumber + 1) . ': component colour must use a semantic token';
        }
    }
}
if ($errors) {
    fwrite(STDERR, implode("\n", $errors) . "\n");
    exit(1);
}
echo "Design tokens: no component colour literals outside styles/roles.css.\n";
