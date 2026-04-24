<?php
declare(strict_types=1);

require_once __DIR__ . '/Constants.php';

function getUploadsDirectory(): string
{
    return getDataDirectory() . '/uploads';
}

function isAttachmentCategoryType(string $type): bool
{
    return in_array($type, ATTACHMENT_CATEGORY_TYPES, true);
}

function getAttachmentStorageDirectory(string $section): string
{
    if (!isAttachmentCategoryType($section)) {
        throw new InvalidArgumentException('Ungültige Attachment-Sektion.');
    }

    return getUploadsDirectory() . '/' . $section;
}

function ensureUploadDirectories(): void
{
    ensureDirectoryExists(getDataDirectory());
    ensureDirectoryExists(getUploadsDirectory());

    foreach (ATTACHMENT_CATEGORY_TYPES as $section) {
        ensureDirectoryExists(getAttachmentStorageDirectory($section));
    }
}

function normalizeAttachmentStoredName(string $storedName): string
{
    $storedName = trim($storedName);

    if ($storedName === '' || !preg_match('/\A[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}\z/', $storedName)) {
        throw new RuntimeException('Ungültiger gespeicherter Dateiname.');
    }

    return $storedName;
}

function getAttachmentStorageRelativePath(array $attachment): string
{
    $section = (string) ($attachment['storage_section'] ?? '');
    $storedName = normalizeAttachmentStoredName((string) ($attachment['stored_name'] ?? ''));

    if (!isAttachmentCategoryType($section)) {
        throw new RuntimeException('Ungültige Attachment-Sektion.');
    }

    return $section . '/' . $storedName;
}

function getAttachmentAbsolutePath(array $attachment): string
{
    $section = (string) ($attachment['storage_section'] ?? '');
    $storedName = normalizeAttachmentStoredName((string) ($attachment['stored_name'] ?? ''));

    return getAttachmentStorageDirectory($section) . '/' . $storedName;
}

function getAttachmentThumbnailAbsolutePath(array $attachment): string
{
    $section = (string) ($attachment['storage_section'] ?? '');
    if ($section !== 'images') {
        return getAttachmentAbsolutePath($attachment);
    }

    $storedName = normalizeAttachmentStoredName((string) ($attachment['stored_name'] ?? ''));
    $baseName = pathinfo($storedName, PATHINFO_FILENAME);

    return getAttachmentStorageDirectory($section) . '/thumb-' . $baseName . '.jpg';
}

function deleteAttachmentStorageFile(array $attachment): void
{
    $absolutePath = getAttachmentAbsolutePath($attachment);
    $thumbnailPath = getAttachmentThumbnailAbsolutePath($attachment);

    if (is_file($absolutePath) && !unlink($absolutePath)) {
        throw new RuntimeException(sprintf('Attachment-Datei konnte nicht gelöscht werden: %s', $absolutePath));
    }

    if ($thumbnailPath !== $absolutePath && is_file($thumbnailPath) && !unlink($thumbnailPath)) {
        throw new RuntimeException(sprintf('Thumbnail-Datei konnte nicht gelöscht werden: %s', $thumbnailPath));
    }
}
