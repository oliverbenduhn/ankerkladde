<?php
declare(strict_types=1);

$outputDir = __DIR__ . '/icons';
$sizes = [16, 32, 48, 128];

$existingPngs = [];
foreach ($sizes as $size) {
    $path = sprintf('%s/icon%d.png', $outputDir, $size);
    if (is_file($path)) {
        $existingPngs[$size] = file_get_contents($path);
    }
}

require __DIR__ . '/build-icons.php';

foreach ($existingPngs as $size => $contents) {
    $path = sprintf('%s/icon%d.png', $outputDir, $size);
    file_put_contents($path, $contents);
}