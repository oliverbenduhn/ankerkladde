#!/usr/bin/env php
<?php
declare(strict_types=1);

// Kopiert den unveränderlichen Playwright-Demo-Bestand auf genau einen
// Worker-Nutzer. Das Skript wird vor dem ersten login() eines Tests ausgeführt:
// pro Worker seriell, zwischen Workern auf getrennten Nutzer-IDs.

require dirname(__DIR__) . '/security.php';
require dirname(__DIR__) . '/db.php';

$targetUsername = trim((string) getenv('EINKAUF_UI_TEST_USER'));
if ($targetUsername === '') {
    fwrite(STDERR, "EINKAUF_UI_TEST_USER fehlt.\n");
    exit(1);
}

// Playwright starts several workers at once. Their fixtures are separate, but
// SQLite still permits exactly one writer; serialize only the short fixture
// copy so normal browser requests never race a reset transaction.
$dataDir = (string) getenv('EINKAUF_DATA_DIR');
$lockPath = rtrim($dataDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'reset-ui-test-user.lock';
$lockHandle = @fopen($lockPath, 'c');
if ($lockHandle === false || !flock($lockHandle, LOCK_EX)) {
    fwrite(STDERR, "Playwright-Fixture-Lock konnte nicht reserviert werden.\n");
    exit(1);
}
register_shutdown_function(static function () use ($lockHandle): void {
    flock($lockHandle, LOCK_UN);
    fclose($lockHandle);
});

$db = getDatabase();
$findUser = $db->prepare('SELECT id, preferences_json FROM users WHERE username = :username LIMIT 1');
$findUser->execute([':username' => 'playwright-template']);
$template = $findUser->fetch();
if (!is_array($template)) {
    fwrite(STDERR, "Playwright-Template fehlt.\n");
    exit(1);
}
$findUser->execute([':username' => $targetUsername]);
$target = $findUser->fetch();
if (!is_array($target)) {
    fwrite(STDERR, "Playwright-Testnutzer fehlt: {$targetUsername}\n");
    exit(1);
}

$templateUserId = (int) $template['id'];
$targetUserId = (int) $target['id'];
$oldAttachments = [];
$cleanupService = new DeletionTombstoneService($db);

$db->beginTransaction();
try {
    $attachmentStmt = $db->prepare(
        'SELECT attachments.*
         FROM attachments
         INNER JOIN items ON items.id = attachments.item_id
         WHERE items.user_id = :user_id'
    );
    $attachmentStmt->execute([':user_id' => $targetUserId]);
    $oldAttachments = array_merge(
        $attachmentStmt->fetchAll(),
        $cleanupService->attachmentPayloadsForUserDeletion($targetUserId)
    );
    $cleanupService->enqueueDetachedAttachmentCleanup($oldAttachments);

    // Ein Vortest darf keinen reversiblen Löschvorgang in die neue Fixture
    // tragen. Die Payload-Referenzen werden zuerst entfernt, damit Kategorien
    // wieder vollständig ausgetauscht werden können.
    $db->prepare('DELETE FROM deletion_tombstones WHERE user_id = :user_id')->execute([':user_id' => $targetUserId]);
    $db->prepare('DELETE FROM items WHERE user_id = :user_id')->execute([':user_id' => $targetUserId]);
    $db->prepare('DELETE FROM categories WHERE user_id = :user_id')->execute([':user_id' => $targetUserId]);
    $db->prepare('UPDATE users SET preferences_json = :preferences_json WHERE id = :id')->execute([
        ':preferences_json' => (string) $template['preferences_json'],
        ':id' => $targetUserId,
    ]);

    $categoryRows = $db->prepare(
        'SELECT id, name, type, icon, legacy_key, sort_order, is_hidden, created_at, updated_at
         FROM categories WHERE user_id = :user_id ORDER BY sort_order, id'
    );
    $categoryRows->execute([':user_id' => $templateUserId]);
    $copyCategory = $db->prepare(
        'INSERT INTO categories (user_id, name, type, icon, legacy_key, sort_order, is_hidden, created_at, updated_at)
         VALUES (:user_id, :name, :type, :icon, :legacy_key, :sort_order, :is_hidden, :created_at, :updated_at)'
    );
    $categoryMap = [];
    foreach ($categoryRows->fetchAll() as $category) {
        $copyCategory->execute([
            ':user_id' => $targetUserId,
            ':name' => $category['name'],
            ':type' => $category['type'],
            ':icon' => $category['icon'],
            ':legacy_key' => $category['legacy_key'],
            ':sort_order' => $category['sort_order'],
            ':is_hidden' => $category['is_hidden'],
            ':created_at' => $category['created_at'],
            ':updated_at' => $category['updated_at'],
        ]);
        $categoryMap[(int) $category['id']] = (int) $db->lastInsertId();
    }

    $itemRows = $db->prepare(
        'SELECT name, done, section, created_at, updated_at, quantity, sort_order, content, due_date,
                is_pinned, barcode, status, category_id, due_time, priority, sketch_json, revision
         FROM items WHERE user_id = :user_id ORDER BY id'
    );
    $itemRows->execute([':user_id' => $templateUserId]);
    $copyItem = $db->prepare(
        'INSERT INTO items
            (name, done, section, created_at, updated_at, quantity, sort_order, content, due_date,
             is_pinned, barcode, status, user_id, category_id, due_time, priority, sketch_json, revision)
         VALUES
            (:name, :done, :section, :created_at, :updated_at, :quantity, :sort_order, :content, :due_date,
             :is_pinned, :barcode, :status, :user_id, :category_id, :due_time, :priority, :sketch_json, :revision)'
    );
    foreach ($itemRows->fetchAll() as $item) {
        $copyItem->execute([
            ':name' => $item['name'],
            ':done' => $item['done'],
            ':section' => $item['section'],
            ':created_at' => $item['created_at'],
            ':updated_at' => $item['updated_at'],
            ':quantity' => $item['quantity'],
            ':sort_order' => $item['sort_order'],
            ':content' => $item['content'],
            ':due_date' => $item['due_date'],
            ':is_pinned' => $item['is_pinned'],
            ':barcode' => $item['barcode'],
            ':status' => $item['status'],
            ':user_id' => $targetUserId,
            ':category_id' => $categoryMap[(int) $item['category_id']],
            ':due_time' => $item['due_time'],
            ':priority' => $item['priority'],
            ':sketch_json' => $item['sketch_json'],
            ':revision' => $item['revision'],
        ]);
    }
    $db->commit();
} catch (Throwable $error) {
    if ($db->inTransaction()) $db->rollBack();
    throw $error;
}

$cleanupService->garbageCollectDetachedAttachments(max(10, count($oldAttachments)));
