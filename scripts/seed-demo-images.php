#!/usr/bin/env php
<?php
declare(strict_types=1);

require dirname(__DIR__) . '/security.php';
require dirname(__DIR__) . '/db.php';

$db = getDatabase();
$userId = (int) ($db->query("SELECT id FROM users WHERE username = 'tester' LIMIT 1")->fetchColumn());
$catId  = (int) ($db->query("SELECT id FROM categories WHERE user_id = $userId AND type = 'images' LIMIT 1")->fetchColumn());

ensureUploadDirectories();
$imgDir = getAttachmentStorageDirectory('images');

// Einfache Demo-Bilder als farbige JPEG erzeugen
$images = [
    ['name' => 'Hauseingang Renovierung', 'color' => [120, 160, 200], 'label' => 'Eingang'],
    ['name' => 'Garten Planung',          'color' => [80,  160,  80], 'label' => 'Garten'],
    ['name' => 'Küchenregal Idee',        'color' => [200, 160,  80], 'label' => 'Küche'],
    ['name' => 'Urlaubsfoto Karte',       'color' => [60,  140, 200], 'label' => 'Urlaub'],
];

// Vorhandene Items+Attachments für Bilder-Kategorie löschen
$existingItems = $db->query("SELECT id FROM items WHERE category_id = $catId")->fetchAll(PDO::FETCH_COLUMN);
foreach ($existingItems as $iid) {
    $att = findAttachmentByItemId($db, (int)$iid);
    if ($att) {
        try { deleteAttachmentStorageFile($att); } catch (Throwable) {}
        $db->prepare('DELETE FROM attachments WHERE item_id = :id')->execute([':id' => $iid]);
    }
}
$db->exec("DELETE FROM items WHERE category_id = $catId");

foreach ($images as $idx => $img) {
    // JPEG erzeugen (300×300 mit Farbe + Text)
    $w = 400; $h = 300;
    $gd = imagecreatetruecolor($w, $h);
    $bg   = imagecolorallocate($gd, ...$img['color']);
    $dark = imagecolorallocate($gd, 20, 20, 20);
    $white = imagecolorallocate($gd, 255, 255, 255);
    imagefill($gd, 0, 0, $bg);
    // Gradient-Illusion: untere Hälfte dunkler
    $darker = imagecolorallocate($gd, (int)($img['color'][0]*0.7), (int)($img['color'][1]*0.7), (int)($img['color'][2]*0.7));
    $halfH = (int)($h/2);
    imagefilledrectangle($gd, 0, $halfH, $w, $h, $darker);
    // Text
    imagestring($gd, 5, 20, $h/2 - 10, $img['label'], $white);

    $storedName = 'demo_' . ($idx+1) . '_' . time() . '.jpg';
    $fullPath   = $imgDir . '/' . $storedName;
    imagejpeg($gd, $fullPath, 85);
    imagedestroy($gd);

    // Thumbnail
    $thumbPath = $imgDir . '/thumb-demo_' . ($idx+1) . '_' . time() . '.jpg';
    generateImageThumbnailFile($fullPath, $thumbPath, 200, 200);

    // Item eintragen
    $stmt = $db->prepare(
        'INSERT INTO items (user_id, name, quantity, content, done, category_id, due_date, is_pinned, sort_order, created_at, updated_at)
         VALUES (:user_id, :name, \'\', \'\', 0, :cat, \'\', 0, :sort, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
    );
    $stmt->execute([':user_id' => $userId, ':name' => $img['name'], ':cat' => $catId, ':sort' => $idx + 1]);
    $itemId = (int) $db->lastInsertId();

    // Attachment
    $aStmt = $db->prepare(
        'INSERT INTO attachments (item_id, storage_section, stored_name, original_name, media_type, size_bytes, created_at, updated_at)
         VALUES (:item_id, \'images\', :stored_name, :original_name, \'image/jpeg\', :size, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
    );
    $aStmt->execute([
        ':item_id'       => $itemId,
        ':stored_name'   => $storedName,
        ':original_name' => $img['label'] . '.jpg',
        ':size'          => filesize($fullPath),
    ]);

    $num = $idx + 1;
    echo "Bild {$num}: {$img['name']} → {$storedName}\n";
}

echo "\nDemo-Bilder erfolgreich angelegt.\n";
