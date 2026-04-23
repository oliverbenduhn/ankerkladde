<?php
declare(strict_types=1);

require __DIR__ . '/build-lib.php';

$baseDir = __DIR__;
$outputZip = $baseDir . '/' . getVersionedExtensionZipFilename($baseDir, true);

try {
    runExtensionBuildPreparation($baseDir);
    writeExtensionZipFile($baseDir, $outputZip, true);
    fwrite(STDOUT, "Firefox-ZIP erstellt: {$outputZip}\n");
} catch (Throwable $exception) {
    fwrite(STDERR, $exception->getMessage() . "\n");
    exit(1);
}
