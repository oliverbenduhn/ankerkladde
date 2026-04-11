<?php
declare(strict_types=1);

function getExtensionArchiveEntries(): array
{
    return [
        'manifest.json',
        'popup.html',
        'popup.js',
        'background.js',
        'icons/icon16.png',
        'icons/icon32.png',
        'icons/icon48.png',
        'icons/icon128.png',
    ];
}

function buildExtensionZipData(string $baseDir): string
{
    $entries = getExtensionArchiveEntries();
    $zipData = '';
    $centralDirectory = '';
    $offset = 0;

    foreach ($entries as $relativePath) {
        $absolutePath = $baseDir . '/' . $relativePath;
        if (!is_file($absolutePath)) {
            throw new RuntimeException(sprintf('Datei fehlt: %s', $relativePath));
        }

        $contents = file_get_contents($absolutePath);
        if (!is_string($contents)) {
            throw new RuntimeException(sprintf('Datei konnte nicht gelesen werden: %s', $relativePath));
        }

        $normalizedPath = str_replace('\\', '/', $relativePath);
        $nameLength = strlen($normalizedPath);
        $size = strlen($contents);
        $crc = crc32($contents);
        if ($crc < 0) {
            $crc += 4294967296;
        }

        $localHeader = pack(
            'VvvvvvVVVvv',
            0x04034b50,
            20,
            0,
            0,
            0,
            0,
            $crc,
            $size,
            $size,
            $nameLength,
            0
        ) . $normalizedPath;

        $zipData .= $localHeader . $contents;

        $centralDirectory .= pack(
            'VvvvvvvVVVvvvvvVV',
            0x02014b50,
            20,
            20,
            0,
            0,
            0,
            0,
            $crc,
            $size,
            $size,
            $nameLength,
            0,
            0,
            0,
            0,
            32,
            $offset
        ) . $normalizedPath;

        $offset += strlen($localHeader) + $size;
    }

    $endOfCentralDirectory = pack(
        'VvvvvVVv',
        0x06054b50,
        0,
        0,
        count($entries),
        count($entries),
        strlen($centralDirectory),
        $offset,
        0
    );

    return $zipData . $centralDirectory . $endOfCentralDirectory;
}

function writeExtensionZipFile(string $baseDir, string $outputPath): void
{
    $zipData = buildExtensionZipData($baseDir);
    if (file_put_contents($outputPath, $zipData) === false) {
        throw new RuntimeException('ZIP konnte nicht geschrieben werden.');
    }
}
