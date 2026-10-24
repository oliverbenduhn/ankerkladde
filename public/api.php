<?php
declare(strict_types=1);

ini_set('default_charset', 'UTF-8');

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';
require dirname(__DIR__) . '/src/QuickAddParser.php';
require dirname(__DIR__) . '/src/QuickAddHandler.php';
require dirname(__DIR__) . '/src/AddItemHandler.php';
require dirname(__DIR__) . '/src/WebSocketNotifier.php';
require __DIR__ . '/theme.php';
require dirname(__DIR__) . '/src/Api/Idempotency.php';
require dirname(__DIR__) . '/src/Api/RemoteFetch.php';
require dirname(__DIR__) . '/src/Api/ProductNormalization.php';
require dirname(__DIR__) . '/src/Api/ContentSanitizer.php';
require dirname(__DIR__) . '/src/Api/AttachmentSupport.php';
require dirname(__DIR__) . '/src/Api/ItemSupport.php';
require dirname(__DIR__) . '/src/Api/Http.php';
require dirname(__DIR__) . '/src/Api/CategoryController.php';
require dirname(__DIR__) . '/src/Api/JournalController.php';
require dirname(__DIR__) . '/src/Api/ItemController.php';
require dirname(__DIR__) . '/src/Api/AttachmentController.php';
require dirname(__DIR__) . '/src/Api/ProductController.php';
require dirname(__DIR__) . '/src/Api/PreferencesController.php';
require dirname(__DIR__) . '/src/Api/SketchController.php';

enforceCanonicalRequest();
startAppSession();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$action = $_GET['action'] ?? 'list';
$GLOBALS['current_action'] = $action;
$db = getDatabase();
$GLOBALS['db'] = $db;
$userId = requireApiAuthWithKey($db);
// Make userId available to respond() for user-scoped WS notifications.
$GLOBALS['current_user_id'] = $userId;

try {
    // Opportunistic, user-scoped GC keeps staged payloads/files bounded even if
    // a client never gets to send its scheduled finalize request.
    try {
        (new DeletionTombstoneService($db))->garbageCollectExpired($userId);
    } catch (Throwable $gcError) {
        error_log(sprintf('Deletion tombstone GC error [user:%d]: %s', $userId, $gcError->getMessage()));
    }

    $handlers = [
        'categories_list' => 'handleCategoryApiAction',
        'categories_create' => 'handleCategoryApiAction',
        'categories_update' => 'handleCategoryApiAction',
        'categories_reorder' => 'handleCategoryApiAction',
        'categories_delete' => 'handleCategoryApiAction',
        'today' => 'handleJournalApiAction',
        'journal' => 'handleJournalApiAction',
        'journal_save' => 'handleJournalApiAction',
        'list' => 'handleItemApiAction',
        'quick_add' => 'handleItemApiAction',
        'add' => 'handleItemApiAction',
        'upload' => 'handleAttachmentApiAction',
        'import_url' => 'handleAttachmentApiAction',
        'toggle' => 'handleItemApiAction',
        'update' => 'handleItemApiAction',
        'delete' => 'handleItemApiAction',
        'undo_delete' => 'handleItemApiAction',
        'finalize_delete' => 'handleItemApiAction',
        'move' => 'handleItemApiAction',
        'clear' => 'handleItemApiAction',
        'reorder' => 'handleItemApiAction',
        'pin' => 'handleItemApiAction',
        'status' => 'handleItemApiAction',
        'search' => 'handleItemApiAction',
        'product_lookup' => 'handleProductApiAction',
        'product_normalize_debug' => 'handleProductApiAction',
        'fetch_metadata' => 'handleProductApiAction',
        'product_details' => 'handleProductApiAction',
        'preferences' => 'handlePreferencesApiAction',
        'sketch_save' => 'handleSketchApiAction',
        'sketch_save_daily' => 'handleSketchApiAction',
        'sketch' => 'handleSketchApiAction',
        'sketch_load' => 'handleSketchApiAction',
    ];
    if (!isset($handlers[$action])) {
        respond(404, ['error' => t('error.unknown_action'), 'error_key' => 'error.unknown_action']);
    }
    $handlers[$action]($db, $userId, $action);
} catch (Throwable $exception) {
    if ($db instanceof PDO && $db->inTransaction()) {
        $db->rollBack();
    }

    error_log(sprintf(
        'Einkauf API error [action=%s method=%s ip=%s]: %s',
        (string) $action,
        (string) ($_SERVER['REQUEST_METHOD'] ?? ''),
        (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
        (string) $exception
    ));
    respond(500, ['error' => t('error.server_error'), 'error_key' => 'error.server_error']);
}
