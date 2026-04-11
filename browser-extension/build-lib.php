<?php
declare(strict_types=1);

function getExtensionManifestVersion(string $baseDir): string
{
    $manifestPath = $baseDir . '/manifest.json';
    $contents = file_get_contents($manifestPath);
    if (!is_string($contents)) {
        throw new RuntimeException('Manifest konnte nicht gelesen werden.');
    }

    $manifest = json_decode($contents, true);
    if (!is_array($manifest) || !is_string($manifest['version'] ?? null) || trim($manifest['version']) === '') {
        throw new RuntimeException('Manifest-Version fehlt.');
    }

    return trim($manifest['version']);
}

function getVersionedExtensionZipFilename(string $baseDir): string
{
    $version = preg_replace('/[^0-9A-Za-z._-]+/', '-', getExtensionManifestVersion($baseDir)) ?? 'unknown';
    return sprintf('ankerkladde-extension-v%s.zip', $version);
}

function getExtensionArchiveEntries(bool $isFirefox = false): array
{
    return [
        $isFirefox ? 'manifest-firefox.json' : 'manifest.json',
        'popup.html',
        'popup.js',
        'background.js',
        'icon.png',
        'icons/icon16.png',
        'icons/icon32.png',
        'icons/icon48.png',
        'icons/icon128.png',
    ];
}

function getVersionedExtensionZipFilename(string $baseDir, bool $isFirefox = false): string
{
    $version = preg_replace('/[^0-9A-Za-z._-]+/', '-', getExtensionManifestVersion($baseDir)) ?? 'unknown';
    $browser = $isFirefox ? '-firefox' : '';
    return sprintf('ankerkladde-extension-v%s%s.zip', $version, $browser);
}

function buildExtensionZipData(string $baseDir, bool $isFirefox = false): string
{
    $entries = getExtensionArchiveEntries($isFirefox);
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
