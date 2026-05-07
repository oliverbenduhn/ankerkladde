<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require __DIR__ . '/theme.php';

enforceCanonicalRequest();
sendHtmlPageSecurityHeaders();
$currentUserId = requireAdmin();

$db = getDatabase();
$adminPreferences = getExtendedUserPreferences($db, $currentUserId);

$flash      = null;
$flashType  = 'ok';

const PRODUCT_FACTS_DATASETS = [
    'food' => [
        'label' => 'Open Food Facts',
        'url' => 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz',
        'file' => 'en.openfoodfacts.org.products.csv.gz',
    ],
    'beauty' => [
        'label' => 'Open Beauty Facts',
        'url' => 'https://static.openbeautyfacts.org/data/en.openbeautyfacts.org.products.csv.gz',
        'file' => 'en.openbeautyfacts.org.products.csv.gz',
    ],
    'petfood' => [
        'label' => 'Open Pet Food Facts',
        'url' => 'https://static.openpetfoodfacts.org/data/en.openpetfoodfacts.org.products.csv.gz',
        'file' => 'en.openpetfoodfacts.org.products.csv.gz',
    ],
    'products' => [
        'label' => 'Open Products Facts',
        'url' => 'https://static.openproductsfacts.org/data/en.openproductsfacts.org.products.csv.gz',
        'file' => 'en.openproductsfacts.org.products.csv.gz',
    ],
];

function validateNewPassword(string $password): ?string
{
    if (strlen($password) < 8) {
        return t('admin.flash.password_too_short');
    }
    return null;
}

function setPasswordChangeRequired(PDO $db, int $userId, bool $required): void
{
    $db->prepare('UPDATE users SET must_change_password = :required WHERE id = :id')
        ->execute([
            ':required' => $required ? 1 : 0,
            ':id' => $userId,
        ]);
}

function quoteAdminIdentifier(string $identifier): string
{
    return '"' . str_replace('"', '""', $identifier) . '"';
}

function datasetTableNameAdmin(string $dataset): string
{
    return 'product_catalog_' . $dataset;
}

function getOpenFactsDataDirectory(): string
{
    $dir = getDataDirectory() . '/openfoodfacts';
    ensureDirectoryExists($dir);
    return $dir;
}

function downloadFileToPath(string $url, string $targetPath): void
{
    $directory = dirname($targetPath);
    ensureDirectoryExists($directory);

    $tmpPath = $targetPath . '.tmp';
    $fp = fopen($tmpPath, 'wb');
    if ($fp === false) {
        throw new RuntimeException('Temporäre Datei konnte nicht erstellt werden.');
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_FILE => $fp,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_FAILONERROR => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 0,
        CURLOPT_USERAGENT => 'Ankerkladde Admin Import',
    ]);

    $ok = curl_exec($ch);
    $error = $ok === false ? curl_error($ch) : null;
    fclose($fp);

    if ($ok === false) {
        @unlink($tmpPath);
        throw new RuntimeException('Download fehlgeschlagen: ' . ($error ?: 'Unbekannter Fehler'));
    }

    if (!rename($tmpPath, $targetPath)) {
        @unlink($tmpPath);
        throw new RuntimeException('Download konnte nicht final gespeichert werden.');
    }
}

function runOpenFactsImport(string $dataset, string $sourcePath, bool $truncate = false): void
{
    $rootDir = dirname(__DIR__);
    $command = 'php ' . escapeshellarg($rootDir . '/scripts/import-openfoodfacts.php') . ' ';
    if ($truncate) {
        $command .= '--truncate ';
    }
    $command .= '--dataset=' . escapeshellarg($dataset) . ' ' . escapeshellarg($sourcePath) . ' 2>&1';

    exec($command, $output, $exitCode);
    if ($exitCode !== 0) {
        throw new RuntimeException(trim(implode("\n", $output)) ?: 'Import fehlgeschlagen.');
    }
}

function getProductDatabaseStatus(PDO $db, PDO $productDb): array
{
    $summaryCount = (int) $productDb->query('SELECT COUNT(*) FROM product_catalog')->fetchColumn();
    $summaryUpdated = $productDb->query('SELECT MAX(updated_at) FROM product_catalog')->fetchColumn() ?: null;
    $datasets = [];
    foreach (PRODUCT_FACTS_DATASETS as $datasetKey => $config) {
        $tableName = datasetTableNameAdmin($datasetKey);
        $exists = (bool) $productDb->query(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = " . $productDb->quote($tableName)
        )->fetchColumn();

        $rowCount = 0;
        $updatedAt = getAdminMetaValue($db, importMetaKeyForDataset($datasetKey));
        if ($exists) {
            $rowCount = (int) $productDb->query('SELECT COUNT(*) FROM ' . quoteAdminIdentifier($tableName))->fetchColumn();
        }

        $filePath = getOpenFactsDataDirectory() . '/' . $config['file'];
        if ($updatedAt === null && $rowCount > 0 && is_file($filePath)) {
            $mtime = filemtime($filePath);
            if (is_int($mtime) && $mtime > 0) {
                $updatedAt = date('Y-m-d H:i:s', $mtime);
            }
        }

        // Backward compatibility: older installs may only have the summary catalog populated.
        if ($datasetKey === 'food' && $rowCount === 0 && $summaryCount > 0) {
            $rowCount = $summaryCount;
            if ($updatedAt === null && is_string($summaryUpdated) && $summaryUpdated !== '') {
                $updatedAt = $summaryUpdated;
            }
        }

        $datasets[] = [
            'key' => $datasetKey,
            'label' => $config['label'],
            'row_count' => $rowCount,
            'updated_at' => is_string($updatedAt) ? $updatedAt : null,
            'file_exists' => is_file($filePath),
            'file_size' => is_file($filePath) ? (int) filesize($filePath) : 0,
        ];
    }

    $dbFile = getDataDirectory() . '/products.db';

    return [
        'summary_count' => $summaryCount,
        'summary_updated_at' => is_string($summaryUpdated) ? $summaryUpdated : null,
        'db_file_size' => is_file($dbFile) ? (int) filesize($dbFile) : 0,
        'datasets' => $datasets,
    ];
}

function formatBytesAdmin(int $bytes): string
{
    if ($bytes <= 0) {
        return '0 B';
    }

    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $value = (float) $bytes;
    $unitIndex = 0;
    while ($value >= 1024 && $unitIndex < count($units) - 1) {
        $value /= 1024;
        $unitIndex++;
    }

    return number_format($value, $unitIndex === 0 ? 0 : 1, ',', '.') . ' ' . $units[$unitIndex];
}

function getAdminMetaValue(PDO $db, string $key): ?string
{
    $stmt = $db->prepare('SELECT meta_value FROM database_meta WHERE meta_key = :meta_key LIMIT 1');
    $stmt->execute([':meta_key' => $key]);
    $value = $stmt->fetchColumn();

    return is_string($value) && $value !== '' ? $value : null;
}

function setAdminMetaValue(PDO $db, string $key, string $value): void
{
    $stmt = $db->prepare(
        'INSERT INTO database_meta (meta_key, meta_value, updated_at)
         VALUES (:meta_key, :meta_value, CURRENT_TIMESTAMP)
         ON CONFLICT(meta_key) DO UPDATE SET
            meta_value = excluded.meta_value,
            updated_at = CURRENT_TIMESTAMP'
    );
    $stmt->execute([
        ':meta_key' => $key,
        ':meta_value' => $value,
    ]);
}

function importMetaKeyForDataset(string $dataset): string
{
    return 'product_catalog_imported_at_' . $dataset;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $providedToken = $_POST['csrf_token'] ?? null;

    if (!hasValidCsrfToken(is_string($providedToken) ? $providedToken : null)) {
        $flash     = t('error.invalid_csrf');
        $flashType = 'err';
    } else {
        $postAction = (string) ($_POST['action'] ?? '');

        if ($postAction === 'create') {
            $newUsername = normalizeUsername((string) ($_POST['username'] ?? ''));
            $newPassword = (string) ($_POST['password'] ?? '');
            $mustChangePassword = isset($_POST['must_change_password']);

            if ($newUsername === '') {
                $flash = t('admin.flash.username_required');
                $flashType = 'err';
            } elseif (($pwErr = validateNewPassword($newPassword)) !== null) {
                $flash = $pwErr;
                $flashType = 'err';
            } else {
                try {
                    $stmt = $db->prepare(
                        'INSERT INTO users (username, password_hash, is_admin, must_change_password)
                         VALUES (:username, :password_hash, 0, :must_change_password)'
                    );
                    $stmt->execute([
                        ':username'      => $newUsername,
                        ':password_hash' => password_hash($newPassword, PASSWORD_BCRYPT),
                        ':must_change_password' => $mustChangePassword ? 1 : 0,
                    ]);
                    $newUserId = (int) $db->lastInsertId();
                    createDefaultCategoriesForUser($db, $newUserId);
                    $flash = t('admin.flash.user_created', ['username' => $newUsername])
                        . ($mustChangePassword ? ' ' . t('admin.flash.password_change_forced') : '');
                } catch (PDOException $e) {
                    if (str_contains($e->getMessage(), 'UNIQUE')) {
                        $flash = t('admin.flash.username_taken', ['username' => $newUsername]);
                    } else {
                        $flash = t('admin.flash.user_create_failed');
                    }
                    $flashType = 'err';
                }
            }

        } elseif ($postAction === 'save_upload_limits') {
            $imageLimit = filter_var($_POST['image_upload_max_mb'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 1, 'max_range' => 10240],
            ]);
            $fileLimit = filter_var($_POST['file_upload_max_mb'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 1, 'max_range' => 10240],
            ]);
            $remoteLimit = filter_var($_POST['remote_file_import_max_mb'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 1, 'max_range' => 10240],
            ]);

            if (!is_int($imageLimit) || !is_int($fileLimit) || !is_int($remoteLimit)) {
                $flash = t('admin.flash.upload_limits_invalid');
                $flashType = 'err';
            } else {
                updateUploadLimitSettings($db, [
                    'image_upload_max_mb' => $imageLimit,
                    'file_upload_max_mb' => $fileLimit,
                    'remote_file_import_max_mb' => $remoteLimit,
                ]);
                $flash = t('admin.flash.upload_limits_saved');
            }

        } elseif ($postAction === 'delete') {
            $targetId = filter_var($_POST['user_id'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 1],
            ]);

            if (!$targetId) {
                $flash = t('admin.flash.invalid_user_id');
                $flashType = 'err';
            } else {
                // Prevent deleting admin accounts
                $targetStmt = $db->prepare('SELECT username, is_admin FROM users WHERE id = :id LIMIT 1');
                $targetStmt->execute([':id' => $targetId]);
                $targetUser = $targetStmt->fetch();

                if (!is_array($targetUser)) {
                    $flash = t('admin.flash.user_not_found');
                    $flashType = 'err';
                } elseif ((bool) $targetUser['is_admin']) {
                    $flash = t('admin.flash.admin_cannot_delete');
                    $flashType = 'err';
                } elseif ($targetId === $currentUserId) {
                    $flash = t('admin.flash.cannot_delete_self');
                    $flashType = 'err';
                } else {
                    // Collect attachment file paths for physical deletion
                    $attStmt = $db->prepare(
                        'SELECT attachments.storage_section, attachments.stored_name
                         FROM attachments
                         INNER JOIN items ON items.id = attachments.item_id
                         WHERE items.user_id = :user_id'
                    );
                    $attStmt->execute([':user_id' => $targetId]);
                    $attachments = $attStmt->fetchAll();

                    $db->beginTransaction();
                    $db->prepare('DELETE FROM items WHERE user_id = :user_id')
                       ->execute([':user_id' => $targetId]);
                    $db->prepare('DELETE FROM users WHERE id = :id')
                       ->execute([':id' => $targetId]);
                    $db->commit();

                    foreach ($attachments as $att) {
                        try {
                            deleteAttachmentStorageFile($att);
                        } catch (Throwable $e) {
                            error_log(sprintf('Einkauf attachment cleanup error [user_delete:%d]: %s', $targetId, $e->getMessage()));
                        }
                    }

                    $flash = t('admin.flash.user_deleted', ['username' => $targetUser['username']]);
                }
            }

        } elseif ($postAction === 'reset_password') {
            $targetId    = filter_var($_POST['user_id'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 1],
            ]);
            $newPassword = (string) ($_POST['new_password'] ?? '');

            if (!$targetId) {
                $flash = t('admin.flash.invalid_user_id');
                $flashType = 'err';
            } elseif (($pwErr = validateNewPassword($newPassword)) !== null) {
                $flash = $pwErr;
                $flashType = 'err';
            } else {
                $targetStmt = $db->prepare(
                    'SELECT username, is_admin FROM users WHERE id = :id LIMIT 1'
                );
                $targetStmt->execute([':id' => $targetId]);
                $targetUser = $targetStmt->fetch();

                if (!is_array($targetUser)) {
                    $flash = t('admin.flash.user_not_found');
                    $flashType = 'err';
                } elseif ((bool) $targetUser['is_admin']) {
                    $flash = t('admin.flash.admin_password_readonly');
                    $flashType = 'err';
                } elseif ($targetId === $currentUserId) {
                    $flash = t('admin.flash.cannot_reset_own_password');
                    $flashType = 'err';
                } else {
                    $db->prepare(
                        'UPDATE users SET password_hash = :hash, must_change_password = 1 WHERE id = :id'
                    )->execute([
                        ':hash' => password_hash($newPassword, PASSWORD_BCRYPT),
                        ':id'   => $targetId,
                    ]);
                    $flash = t('admin.flash.password_reset', ['username' => $targetUser['username']]);
                }
            }
        } elseif ($postAction === 'toggle_password_change') {
            $targetId = filter_var($_POST['user_id'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 1],
            ]);
            $required = isset($_POST['required']);

            if (!$targetId) {
                $flash = t('admin.flash.invalid_user_id');
                $flashType = 'err';
            } else {
                $targetStmt = $db->prepare('SELECT username, is_admin FROM users WHERE id = :id LIMIT 1');
                $targetStmt->execute([':id' => $targetId]);
                $targetUser = $targetStmt->fetch();

                if (!is_array($targetUser)) {
                    $flash = t('admin.flash.user_not_found');
                    $flashType = 'err';
                } elseif ((bool) $targetUser['is_admin']) {
                    $flash = t('admin.flash.admin_use_settings');
                    $flashType = 'err';
                } else {
                    setPasswordChangeRequired($db, $targetId, $required);
                    $flash = $required
                        ? t('admin.flash.password_change_enabled', ['username' => $targetUser['username']])
                        : t('admin.flash.password_change_disabled', ['username' => $targetUser['username']]);
                }
            }
        } elseif ($postAction === 'refresh_product_dataset') {
            $dataset = (string) ($_POST['dataset'] ?? '');

            if (!array_key_exists($dataset, PRODUCT_FACTS_DATASETS)) {
                $flash = t('admin.flash.invalid_dataset');
                $flashType = 'err';
            } else {
                $config = PRODUCT_FACTS_DATASETS[$dataset];
                $targetFile = getOpenFactsDataDirectory() . '/' . $config['file'];
                $truncate = $dataset === 'food';

                try {
                    @set_time_limit(0);
                    downloadFileToPath($config['url'], $targetFile);
                    runOpenFactsImport($dataset, $targetFile, $truncate);
                    setAdminMetaValue($db, importMetaKeyForDataset($dataset), date('Y-m-d H:i:s'));
                    $flash = t('admin.flash.dataset_imported', ['label' => $config['label']]);
                } catch (Throwable $e) {
                    $flash = t('admin.flash.product_db_update_failed', ['error' => $e->getMessage()]);
                    $flashType = 'err';
                }
            }
        } elseif ($postAction === 'clear_product_database') {
            try {
                $productDb = getProductDatabase();
                $productDb->beginTransaction();
                $productDb->exec('DELETE FROM product_catalog');
                foreach (array_keys(PRODUCT_FACTS_DATASETS) as $dataset) {
                    $tableName = datasetTableNameAdmin($dataset);
                    $exists = (bool) $productDb->query(
                        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = " . $productDb->quote($tableName)
                    )->fetchColumn();
                    if ($exists) {
                        $productDb->exec('DELETE FROM ' . quoteAdminIdentifier($tableName));
                    }
                }
                $productDb->commit();
                $flash = t('admin.flash.product_db_cleared');
            } catch (Throwable $e) {
                if (isset($productDb) && $productDb instanceof PDO && $productDb->inTransaction()) {
                    $productDb->rollBack();
                }
                $flash = t('admin.flash.product_db_clear_failed', ['error' => $e->getMessage()]);
                $flashType = 'err';
            }
        }
    }
}

$csrfToken = getCsrfToken();

// Load all non-admin users
$users = $db->query(
    "SELECT
        u.id,
        u.username,
        u.created_at,
        u.must_change_password,
        COUNT(DISTINCT c.id) AS category_count,
        COUNT(DISTINCT i.id) AS item_count
     FROM users u
     LEFT JOIN categories c ON c.user_id = u.id
     LEFT JOIN items i ON i.user_id = u.id
     WHERE u.is_admin = 0
     GROUP BY u.id, u.username, u.created_at, u.must_change_password
     ORDER BY u.created_at ASC"
)->fetchAll();
$productDb = getProductDatabase();
$productStatus = getProductDatabaseStatus($db, $productDb);
$uploadLimits = getUploadLimitSettings($db);
?>
<!DOCTYPE html>
<html lang="<?= htmlspecialchars(getCurrentLanguage(), ENT_QUOTES, 'UTF-8') ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
<?php
$effectiveTheme = resolveEffectiveTheme($adminPreferences);
$themeColor = getThemeColor($effectiveTheme);
$assetVersion = require __DIR__ . '/version.php';
$brandMarkSrc = appPath('icon.php?size=96&theme=' . rawurlencode($effectiveTheme) . '&v=' . rawurlencode($assetVersion));
?>
    <meta name="theme-color" content="<?= htmlspecialchars($themeColor, ENT_QUOTES, 'UTF-8') ?>">
    <?= renderThemeBootScript($adminPreferences) ?>
    <title><?= htmlspecialchars(t('admin.page_title'), ENT_QUOTES, 'UTF-8') ?></title>
    <link rel="icon" type="image/png" href="<?= htmlspecialchars(appPath('icon.php?size=96&v=' . rawurlencode($assetVersion)), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="apple-touch-icon" href="<?= htmlspecialchars(appPath('icon.php?size=180&v=' . rawurlencode($assetVersion)), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('theme-css.php'), ENT_QUOTES, 'UTF-8') ?>">
    <link rel="stylesheet" href="<?= htmlspecialchars(appPath('style.css?v=' . rawurlencode($assetVersion)), ENT_QUOTES, 'UTF-8') ?>">
</head>
<body data-theme="<?= htmlspecialchars($effectiveTheme, ENT_QUOTES, 'UTF-8') ?>">
<div class="admin-page">

    <div class="admin-header">
        <div class="admin-title-group">
            <img src="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>" alt="" class="brand-mark brand-mark-admin" aria-hidden="true">
            <h1><?= htmlspecialchars(t('admin.title'), ENT_QUOTES, 'UTF-8') ?></h1>
        </div>
        <a href="<?= htmlspecialchars(appPath('logout.php'), ENT_QUOTES, 'UTF-8') ?>" class="admin-logout"><?= htmlspecialchars(t('settings.action.logout'), ENT_QUOTES, 'UTF-8') ?></a>
    </div>

    <?php if ($flash !== null): ?>
        <div class="admin-flash admin-flash-<?= htmlspecialchars($flashType, ENT_QUOTES, 'UTF-8') ?>">
            <?= htmlspecialchars($flash, ENT_QUOTES, 'UTF-8') ?>
        </div>
    <?php endif; ?>

    <div class="admin-section">
        <h2><?= htmlspecialchars(t('admin.section.upload_limits'), ENT_QUOTES, 'UTF-8') ?></h2>
        <form method="post" action="<?= htmlspecialchars(appPath('admin.php'), ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="save_upload_limits">
            <div class="admin-limit-grid">
                <label class="admin-limit-field">
                    <span><?= htmlspecialchars(t('admin.upload.images'), ENT_QUOTES, 'UTF-8') ?></span>
                    <input type="number" name="image_upload_max_mb" min="1" max="10240" step="1" required
                           value="<?= (int) $uploadLimits['image_upload_max_mb'] ?>"
                           aria-label="<?= htmlspecialchars(t('admin.upload.images_label'), ENT_QUOTES, 'UTF-8') ?>">
                    <small><?= htmlspecialchars(t('admin.upload.images_hint'), ENT_QUOTES, 'UTF-8') ?></small>
                </label>
                <label class="admin-limit-field">
                    <span><?= htmlspecialchars(t('admin.upload.files'), ENT_QUOTES, 'UTF-8') ?></span>
                    <input type="number" name="file_upload_max_mb" min="1" max="10240" step="1" required
                           value="<?= (int) $uploadLimits['file_upload_max_mb'] ?>"
                           aria-label="<?= htmlspecialchars(t('admin.upload.files_label'), ENT_QUOTES, 'UTF-8') ?>">
                    <small><?= htmlspecialchars(t('admin.upload.files_hint'), ENT_QUOTES, 'UTF-8') ?></small>
                </label>
                <label class="admin-limit-field">
                    <span><?= htmlspecialchars(t('admin.upload.url_import'), ENT_QUOTES, 'UTF-8') ?></span>
                    <input type="number" name="remote_file_import_max_mb" min="1" max="10240" step="1" required
                           value="<?= (int) $uploadLimits['remote_file_import_max_mb'] ?>"
                           aria-label="<?= htmlspecialchars(t('admin.upload.url_import_label'), ENT_QUOTES, 'UTF-8') ?>">
                    <small><?= htmlspecialchars(t('admin.upload.url_import_hint'), ENT_QUOTES, 'UTF-8') ?></small>
                </label>
            </div>
            <p class="admin-notice"><?= htmlspecialchars(t('admin.upload.notice'), ENT_QUOTES, 'UTF-8') ?></p>
            <div class="admin-actions">
                <button type="submit" class="admin-btn"><?= htmlspecialchars(t('admin.action.save'), ENT_QUOTES, 'UTF-8') ?></button>
            </div>
        </form>
    </div>

    <div class="admin-section">
        <h2><?= htmlspecialchars(t('admin.section.create_user'), ENT_QUOTES, 'UTF-8') ?></h2>
        <form method="post" action="<?= htmlspecialchars(appPath('admin.php'), ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="create">
            <div class="admin-form-row">
                <input type="text" name="username" placeholder="<?= htmlspecialchars(t('login.username'), ENT_QUOTES, 'UTF-8') ?>" required autocomplete="off" aria-label="<?= htmlspecialchars(t('login.username'), ENT_QUOTES, 'UTF-8') ?>">
                <input type="password" name="password" placeholder="<?= htmlspecialchars(t('admin.create.password_placeholder'), ENT_QUOTES, 'UTF-8') ?>" required aria-label="<?= htmlspecialchars(t('admin.create.password_label'), ENT_QUOTES, 'UTF-8') ?>">
                <label class="admin-inline-check">
                    <input type="checkbox" name="must_change_password" checked>
                    <span><?= htmlspecialchars(t('admin.create.force_change'), ENT_QUOTES, 'UTF-8') ?></span>
                </label>
                <button type="submit" class="admin-btn"><?= htmlspecialchars(t('admin.action.create'), ENT_QUOTES, 'UTF-8') ?></button>
            </div>
        </form>
    </div>

    <div class="admin-section">
        <h2><?= htmlspecialchars(t('admin.section.users'), ENT_QUOTES, 'UTF-8') ?></h2>
        <?php if ($users === []): ?>
            <p class="admin-notice"><?= htmlspecialchars(t('admin.users.empty'), ENT_QUOTES, 'UTF-8') ?></p>
        <?php else: ?>
            <ul class="admin-user-list">
            <?php foreach ($users as $user): ?>
                <li class="admin-user-item">
                    <span class="admin-user-name"><?= htmlspecialchars((string) $user['username'], ENT_QUOTES, 'UTF-8') ?></span>
                    <span class="admin-user-date"><?= htmlspecialchars(substr((string) $user['created_at'], 0, 10), ENT_QUOTES, 'UTF-8') ?></span>
                    <span class="admin-user-date"><?= (int) $user['category_count'] ?> <?= htmlspecialchars(t('admin.users.categories'), ENT_QUOTES, 'UTF-8') ?></span>
                    <span class="admin-user-date"><?= (int) $user['item_count'] ?> <?= htmlspecialchars(t('admin.users.items'), ENT_QUOTES, 'UTF-8') ?></span>
                    <?php if (!empty($user['must_change_password'])): ?>
                        <span class="admin-user-date"><?= htmlspecialchars(t('admin.users.password_change_pending'), ENT_QUOTES, 'UTF-8') ?></span>
                    <?php endif; ?>

                    <form method="post" action="<?= htmlspecialchars(appPath('admin.php'), ENT_QUOTES, 'UTF-8') ?>" class="admin-inline-form">
                        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
                        <input type="hidden" name="action" value="reset_password">
                        <input type="hidden" name="user_id" value="<?= (int) $user['id'] ?>">
                        <input type="password" name="new_password" placeholder="<?= htmlspecialchars(t('admin.users.new_password_placeholder'), ENT_QUOTES, 'UTF-8') ?>" required aria-label="<?= htmlspecialchars(t('admin.users.new_password_label', ['username' => (string) $user['username']]), ENT_QUOTES, 'UTF-8') ?>">
                        <button type="submit" class="admin-btn-sm"><?= htmlspecialchars(t('admin.action.set_password'), ENT_QUOTES, 'UTF-8') ?></button>
                    </form>

                    <form method="post" action="<?= htmlspecialchars(appPath('admin.php'), ENT_QUOTES, 'UTF-8') ?>" class="admin-inline-form">
                        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
                        <input type="hidden" name="action" value="toggle_password_change">
                        <input type="hidden" name="user_id" value="<?= (int) $user['id'] ?>">
                        <?php if (empty($user['must_change_password'])): ?>
                            <input type="hidden" name="required" value="1">
                            <button type="submit" class="admin-btn-sm"><?= htmlspecialchars(t('admin.action.force_change'), ENT_QUOTES, 'UTF-8') ?></button>
                        <?php else: ?>
                            <button type="submit" class="admin-btn-sm"><?= htmlspecialchars(t('admin.action.release'), ENT_QUOTES, 'UTF-8') ?></button>
                        <?php endif; ?>
                    </form>

                    <form method="post" action="<?= htmlspecialchars(appPath('admin.php'), ENT_QUOTES, 'UTF-8') ?>" class="admin-inline-form"
                          onsubmit="return confirm(<?= htmlspecialchars(json_encode(t('admin.confirm.delete_user', ['username' => $user['username']])), ENT_QUOTES, 'UTF-8') ?>)">
                        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
                        <input type="hidden" name="action" value="delete">
                        <input type="hidden" name="user_id" value="<?= (int) $user['id'] ?>">
                        <button type="submit" class="admin-btn-sm admin-btn-sm-danger"><?= htmlspecialchars(t('admin.action.delete'), ENT_QUOTES, 'UTF-8') ?></button>
                    </form>
                </li>
            <?php endforeach; ?>
            </ul>
        <?php endif; ?>
    </div>

    <div class="admin-section">
        <h2><?= htmlspecialchars(t('admin.section.product_db'), ENT_QUOTES, 'UTF-8') ?></h2>
        <div class="admin-product-summary">
            <div class="admin-product-stat">
                <span class="admin-product-stat-label"><?= htmlspecialchars(t('admin.product.total'), ENT_QUOTES, 'UTF-8') ?></span>
                <strong class="admin-product-stat-value"><?= number_format((int) $productStatus['summary_count'], 0, ',', '.') ?></strong>
            </div>
            <div class="admin-product-stat">
                <span class="admin-product-stat-label"><?= htmlspecialchars(t('admin.product.last_update'), ENT_QUOTES, 'UTF-8') ?></span>
                <strong class="admin-product-stat-value"><?= $productStatus['summary_updated_at'] !== null ? htmlspecialchars(substr((string) $productStatus['summary_updated_at'], 0, 16), ENT_QUOTES, 'UTF-8') : htmlspecialchars(t('admin.product.unknown'), ENT_QUOTES, 'UTF-8') ?></strong>
            </div>
            <div class="admin-product-stat">
                <span class="admin-product-stat-label"><?= htmlspecialchars(t('admin.product.db_size'), ENT_QUOTES, 'UTF-8') ?></span>
                <strong class="admin-product-stat-value"><?= htmlspecialchars(formatBytesAdmin((int) $productStatus['db_file_size']), ENT_QUOTES, 'UTF-8') ?></strong>
            </div>
        </div>

        <div class="admin-product-grid">
            <?php foreach ($productStatus['datasets'] as $dataset): ?>
                <section class="admin-product-card">
                    <div class="admin-product-card-head">
                        <h3><?= htmlspecialchars((string) $dataset['label'], ENT_QUOTES, 'UTF-8') ?></h3>
                        <span class="admin-product-badge<?= (int) $dataset['row_count'] > 0 ? ' is-ready' : '' ?>">
                            <?= (int) $dataset['row_count'] > 0 ? htmlspecialchars(t('admin.product.imported'), ENT_QUOTES, 'UTF-8') : htmlspecialchars(t('admin.product.empty'), ENT_QUOTES, 'UTF-8') ?>
                        </span>
                    </div>
                    <div class="admin-product-meta">
                        <span><?= number_format((int) $dataset['row_count'], 0, ',', '.') ?> <?= htmlspecialchars(t('admin.product.records'), ENT_QUOTES, 'UTF-8') ?></span>
                        <span><?= htmlspecialchars(t('admin.product.file'), ENT_QUOTES, 'UTF-8') ?>: <?= !empty($dataset['file_exists']) ? htmlspecialchars(formatBytesAdmin((int) $dataset['file_size']), ENT_QUOTES, 'UTF-8') : htmlspecialchars(t('admin.product.file_missing'), ENT_QUOTES, 'UTF-8') ?></span>
                        <span><?= $dataset['updated_at'] !== null ? htmlspecialchars(t('admin.product.import_date'), ENT_QUOTES, 'UTF-8') . ': ' . htmlspecialchars(substr((string) $dataset['updated_at'], 0, 16), ENT_QUOTES, 'UTF-8') : htmlspecialchars(t('admin.product.import_unknown'), ENT_QUOTES, 'UTF-8') ?></span>
                    </div>
                    <form method="post" action="<?= htmlspecialchars(appPath('admin.php'), ENT_QUOTES, 'UTF-8') ?>" class="admin-product-actions">
                        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
                        <input type="hidden" name="action" value="refresh_product_dataset">
                        <input type="hidden" name="dataset" value="<?= htmlspecialchars((string) $dataset['key'], ENT_QUOTES, 'UTF-8') ?>">
                        <button type="submit" class="admin-btn-sm"><?= htmlspecialchars(t('admin.action.download_import'), ENT_QUOTES, 'UTF-8') ?></button>
                    </form>
                </section>
            <?php endforeach; ?>
        </div>

        <form method="post" action="<?= htmlspecialchars(appPath('admin.php'), ENT_QUOTES, 'UTF-8') ?>" class="admin-inline-form"
              onsubmit="return confirm('<?= htmlspecialchars(t('admin.confirm.clear_product_db'), ENT_QUOTES, 'UTF-8') ?>')">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="clear_product_database">
            <button type="submit" class="admin-btn-sm admin-btn-sm-danger"><?= htmlspecialchars(t('admin.action.clear_product_db'), ENT_QUOTES, 'UTF-8') ?></button>
        </form>
    </div>

</div>
</body>
</html>
