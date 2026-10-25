<?php
declare(strict_types=1);

$root = dirname(__DIR__) . '/public';
$expected = [];
foreach (['js/*.js', 'styles/*.css'] as $pattern) {
    foreach (glob($root . '/' . $pattern) ?: [] as $file) $expected[] = substr($file, strlen($root) + 1);
}
sort($expected);
$actual = json_decode((string) file_get_contents($root . '/app-shell-assets.json'), true, 512, JSON_THROW_ON_ERROR);
if ($actual !== $expected) {
    fwrite(STDERR, "App-shell manifest is stale. Expected content:\n" . json_encode($expected, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
    exit(1);
}
$style = (string) file_get_contents($root . '/style.css');
preg_match_all('/@import url\("([^"?]+)"\);/', $style, $imports);
$imported = array_values(array_filter($imports[1], static fn(string $path): bool => str_starts_with($path, 'styles/')));
$styles = array_values(array_filter($expected, static fn(string $path): bool => str_ends_with($path, '.css')));
sort($imported);
if ($styles !== $imported) throw new RuntimeException('Every component stylesheet must be imported and precached.');
echo 'App-shell manifest covers all ' . count($expected) . " JS/CSS modules.\n";
