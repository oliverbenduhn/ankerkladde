<?php
declare(strict_types=1);

require __DIR__ . '/build-lib.php';

$baseDir = __DIR__;
$outputZip = $baseDir . '/' . getVersionedExtensionZipFilename($baseDir);

try {
    runExtensionBuildPreparation($baseDir);
    writeExtensionZipFile($baseDir, $outputZip);
    fwrite(STDOUT, "ZIP erstellt: {$outputZip}\n");
} catch (Throwable $exception) {
    fwrite(STDERR, $exception->getMessage() . "\n");
    exit(1);
}
