<?php
declare(strict_types=1);

$outputDir = __DIR__ . '/icons';
$sizes = [16, 32, 48, 128];

if (!extension_loaded('gd')) {
    fwrite(STDERR, "GD extension fehlt.\n");
    exit(1);
}

if (!is_dir($outputDir) && !mkdir($outputDir, 0777, true) && !is_dir($outputDir)) {
    fwrite(STDERR, "Icons-Ordner konnte nicht erstellt werden.\n");
    exit(1);
}

foreach ($sizes as $size) {
    $image = imagecreatetruecolor($size, $size);
    if ($image === false) {
        fwrite(STDERR, "Konnte Bild fuer {$size}px nicht erstellen.\n");
        exit(1);
    }

    imagealphablending($image, true);
    imagesavealpha($image, true);

    $transparent = imagecolorallocatealpha($image, 0, 0, 0, 127);
    imagefill($image, 0, 0, $transparent);

    $bg = imagecolorallocate($image, 23, 50, 77);
    $paper = imagecolorallocate($image, 255, 247, 237);
    $ink = imagecolorallocate($image, 23, 50, 77);
    $accent = imagecolorallocate($image, 204, 75, 44);

    $radius = max(2, (int) round($size * 0.22));
    drawRoundedRect($image, 0, 0, $size - 1, $size - 1, $radius, $bg);

    $pad = (int) round($size * 0.23);
    $paperX1 = $pad;
    $paperY1 = (int) round($size * 0.18);
    $paperX2 = $size - $pad;
    $paperY2 = $size - (int) round($size * 0.2);
    $paperRadius = max(2, (int) round($size * 0.08));
    drawRoundedRect($image, $paperX1, $paperY1, $paperX2, $paperY2, $paperRadius, $paper);

    $fold = (int) round($size * 0.17);
    imagefilledpolygon(
        $image,
        [
            $paperX2 - $fold, $paperY1,
            $paperX2, $paperY1,
            $paperX2, $paperY1 + $fold,
        ],
        3,
        $bg
    );

    imagesetthickness($image, max(1, (int) round($size * 0.07)));
    imageline(
        $image,
        $paperX2 - $fold,
        $paperY1,
        $paperX2 - $fold,
        $paperY1 + $fold,
        $ink
    );
    imageline(
        $image,
        $paperX2 - $fold,
        $paperY1 + $fold,
        $paperX2,
        $paperY1 + $fold,
        $ink
    );

    $cloudY = (int) round($size * 0.5);
    imagearc($image, (int) round($size * 0.44), $cloudY, (int) round($size * 0.18), (int) round($size * 0.18), 180, 360, $ink);
    imagearc($image, (int) round($size * 0.56), (int) round($size * 0.46), (int) round($size * 0.22), (int) round($size * 0.22), 180, 360, $ink);
    imagearc($image, (int) round($size * 0.69), $cloudY, (int) round($size * 0.18), (int) round($size * 0.18), 180, 360, $ink);
    imageline($image, (int) round($size * 0.35), $cloudY, (int) round($size * 0.77), $cloudY, $ink);

    imagesetthickness($image, max(1, (int) round($size * 0.08)));
    $arrowCenterX = (int) round($size * 0.5);
    $arrowTopY = (int) round($size * 0.55);
    $arrowBottomY = (int) round($size * 0.79);
    imageline($image, $arrowCenterX, $arrowTopY, $arrowCenterX, $arrowBottomY, $accent);
    imageline($image, $arrowCenterX, $arrowBottomY, (int) round($size * 0.41), (int) round($size * 0.69), $accent);
    imageline($image, $arrowCenterX, $arrowBottomY, (int) round($size * 0.59), (int) round($size * 0.69), $accent);

    $path = sprintf('%s/icon%d.png', $outputDir, $size);
    imagepng($image, $path);
    imagedestroy($image);
    fwrite(STDOUT, basename($path) . " erstellt\n");
}

function drawRoundedRect(GdImage $image, int $x1, int $y1, int $x2, int $y2, int $radius, int $color): void
{
    imagefilledrectangle($image, $x1 + $radius, $y1, $x2 - $radius, $y2, $color);
    imagefilledrectangle($image, $x1, $y1 + $radius, $x2, $y2 - $radius, $color);
    imagefilledellipse($image, $x1 + $radius, $y1 + $radius, $radius * 2, $radius * 2, $color);
    imagefilledellipse($image, $x2 - $radius, $y1 + $radius, $radius * 2, $radius * 2, $color);
    imagefilledellipse($image, $x1 + $radius, $y2 - $radius, $radius * 2, $radius * 2, $color);
    imagefilledellipse($image, $x2 - $radius, $y2 - $radius, $radius * 2, $radius * 2, $color);
}
