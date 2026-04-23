<?php
declare(strict_types=1);

$outputDir = __DIR__ . '/icons';
$sizes = [16, 32, 48, 128];
$sourceIconPath = dirname(__DIR__) . '/public/icons/icon-512.png';
$popupIconPath = __DIR__ . '/icon.png';

if (!extension_loaded('gd')) {
    fwrite(STDERR, "GD extension fehlt.\n");
    exit(1);
}

if (!is_file($sourceIconPath)) {
    fwrite(STDERR, "Quell-Icon fehlt: {$sourceIconPath}\n");
    exit(1);
}

if (!is_dir($outputDir) && !mkdir($outputDir, 0777, true) && !is_dir($outputDir)) {
    fwrite(STDERR, "Icons-Ordner konnte nicht erstellt werden.\n");
    exit(1);
}

$source = imagecreatefrompng($sourceIconPath);
if ($source === false) {
    fwrite(STDERR, "Quell-Icon konnte nicht geladen werden.\n");
    exit(1);
}

imagesavealpha($source, true);

foreach (array_merge($sizes, ['popup' => 128]) as $key => $size) {
    $image = imagecreatetruecolor($size, $size);
    if (!$image instanceof GdImage) {
        fwrite(STDERR, "Konnte Bild fuer {$size}px nicht erstellen.\n");
        exit(1);
    }

    imagealphablending($image, false);
    imagesavealpha($image, true);

    $transparent = imagecolorallocatealpha($image, 0, 0, 0, 127);
    imagefill($image, 0, 0, $transparent);
    imagecopyresampled(
        $image,
        $source,
        0,
        0,
        0,
        0,
        $size,
        $size,
        imagesx($source),
        imagesy($source)
    );

    $path = $key === 'popup'
        ? $popupIconPath
        : sprintf('%s/icon%d.png', $outputDir, $size);

    imagepng($image, $path);
    imagedestroy($image);
    fwrite(STDOUT, basename($path) . " erstellt\n");
}
imagedestroy($source);
