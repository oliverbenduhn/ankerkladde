<?php
declare(strict_types=1);

require dirname(__DIR__) . '/security.php';

enforceCanonicalRequest();

const BRAND_LOGO_PATH = '/public/branding/ankerkladde-logo.png';
const ICON_FALLBACK_MAP = [
    64 => '/public/icons/icon-192.png',
    96 => '/public/icons/icon-192.png',
    128 => '/public/icons/icon-192.png',
    192 => '/public/icons/icon-192.png',
    512 => '/public/icons/icon-512.png',
];

function iconFail(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo $message;
    exit;
}

function requestedIconSize(): int
{
    $size = filter_input(INPUT_GET, 'size', FILTER_VALIDATE_INT, [
        'options' => ['min_range' => 32, 'max_range' => 1024],
    ]);

    if (!is_int($size)) {
        return 192;
    }

    return in_array($size, array_keys(ICON_FALLBACK_MAP), true) ? $size : 192;
}

function fallbackIconPath(int $size): ?string
{
    $relative = ICON_FALLBACK_MAP[$size] ?? null;
    if (!is_string($relative)) {
        return null;
    }

    $absolute = dirname(__DIR__) . $relative;
    return is_file($absolute) ? $absolute : null;
}

function brandLogoPath(): ?string
{
    $absolute = dirname(__DIR__) . BRAND_LOGO_PATH;
    return is_file($absolute) ? $absolute : null;
}

function outputPngFile(string $path): never
{
    header('Content-Type: image/png');
    header('Cache-Control: public, max-age=86400');
    header('X-Content-Type-Options: nosniff');
    header('Content-Length: ' . (string) filesize($path));
    readfile($path);
    exit;
}

function outputResizedBrandLogo(string $path, int $size): never
{
    if (
        !function_exists('imagecreatefrompng')
        || !function_exists('imagecreatetruecolor')
        || !function_exists('imagecopyresampled')
        || !function_exists('imagepng')
    ) {
        iconFail(500, 'GD image functions are unavailable.');
    }

    $sourceImage = @imagecreatefrompng($path);
    if ($sourceImage === false) {
        iconFail(500, 'Brand icon could not be rendered.');
    }

    $sourceWidth = imagesx($sourceImage);
    $sourceHeight = imagesy($sourceImage);
    if ($sourceWidth <= 0 || $sourceHeight <= 0) {
        imagedestroy($sourceImage);
        iconFail(500, 'Brand icon has invalid dimensions.');
    }

    $cropSize = min($sourceWidth, $sourceHeight);
    $srcX = max(0, (int) floor(($sourceWidth - $cropSize) / 2));
    $srcY = max(0, (int) floor(($sourceHeight - $cropSize) / 2));

    $targetImage = imagecreatetruecolor($size, $size);
    if ($targetImage === false) {
        imagedestroy($sourceImage);
        iconFail(500, 'Brand icon could not be allocated.');
    }

    imagealphablending($targetImage, false);
    imagesavealpha($targetImage, true);
    $transparent = imagecolorallocatealpha($targetImage, 0, 0, 0, 127);
    imagefill($targetImage, 0, 0, $transparent);

    imagecopyresampled(
        $targetImage,
        $sourceImage,
        0,
        0,
        $srcX,
        $srcY,
        $size,
        $size,
        $cropSize,
        $cropSize
    );

    imagedestroy($sourceImage);

    header('Content-Type: image/png');
    header('Cache-Control: public, max-age=86400');
    header('X-Content-Type-Options: nosniff');
    imagepng($targetImage);
    imagedestroy($targetImage);
    exit;
}

$size = requestedIconSize();
$brandLogoPath = brandLogoPath();

if (is_string($brandLogoPath) && is_file($brandLogoPath)) {
    outputResizedBrandLogo($brandLogoPath, $size);
}

$fallbackPath = fallbackIconPath($size);
if (!is_string($fallbackPath)) {
    iconFail(404, 'Icon not found.');
}

outputPngFile($fallbackPath);
