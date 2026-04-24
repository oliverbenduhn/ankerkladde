<?php
declare(strict_types=1);

function canGenerateImageThumbnail(): bool
{
    return function_exists('imagecreatefromstring')
        && function_exists('imagecreatetruecolor')
        && function_exists('imagecopyresampled')
        && function_exists('imagejpeg');
}

function applyImageExifOrientation($image, string $sourcePath)
{
    if (!function_exists('exif_read_data') || !function_exists('imagerotate') || !is_file($sourcePath)) {
        return $image;
    }

    $exif = @exif_read_data($sourcePath);
    $orientation = (int) ($exif['Orientation'] ?? 1);

    $angle = match ($orientation) {
        3 => 180,
        6 => -90,
        8 => 90,
        default => 0,
    };

    if ($angle === 0) {
        return $image;
    }

    $rotated = @imagerotate($image, $angle, 0);
    if ($rotated === false) {
        return $image;
    }

    return $rotated;
}

function generateImageThumbnailFile(
    string $sourcePath,
    string $targetPath,
    int $maxWidth = 480,
    int $maxHeight = 480,
    int $jpegQuality = 82
): bool {
    if (!canGenerateImageThumbnail() || !is_file($sourcePath)) {
        return false;
    }

    $sourceBytes = @file_get_contents($sourcePath);
    if (!is_string($sourceBytes) || $sourceBytes === '') {
        return false;
    }

    $sourceImage = @imagecreatefromstring($sourceBytes);
    unset($sourceBytes);
    if ($sourceImage === false) {
        return false;
    }

    $sourceWidth = imagesx($sourceImage);
    $sourceHeight = imagesy($sourceImage);
    if ($sourceWidth < 1 || $sourceHeight < 1) {
        return false;
    }

    $scale = min($maxWidth / $sourceWidth, $maxHeight / $sourceHeight, 1);
    $targetWidth = max(1, (int) round($sourceWidth * $scale));
    $targetHeight = max(1, (int) round($sourceHeight * $scale));

    $thumbnail = imagecreatetruecolor($targetWidth, $targetHeight);
    if ($thumbnail === false) {
        return false;
    }

    $background = imagecolorallocate($thumbnail, 255, 255, 255);
    imagefill($thumbnail, 0, 0, $background);

    $copied = imagecopyresampled(
        $thumbnail,
        $sourceImage,
        0,
        0,
        0,
        0,
        $targetWidth,
        $targetHeight,
        $sourceWidth,
        $sourceHeight
    );

    if ($copied === false) {
        return false;
    }

    // Rotate only the small thumbnail — avoids memory exhaustion on large originals
    $thumbnail = applyImageExifOrientation($thumbnail, $sourcePath);

    $saved = imagejpeg($thumbnail, $targetPath, $jpegQuality);

    return $saved;
}
