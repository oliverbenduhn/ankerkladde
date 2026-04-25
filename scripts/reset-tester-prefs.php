#!/usr/bin/env php
<?php
require dirname(__DIR__) . '/security.php';
require dirname(__DIR__) . '/db.php';
$db = getDatabase();
$username = getenv('EINKAUF_REGULAR_USER') ?: 'playwright-user';
$stmt = $db->prepare("UPDATE users SET preferences_json = json_patch(preferences_json, '{\"mode\":\"liste\",\"last_category_id\":1}') WHERE username = ?");
$stmt->execute([$username]);
echo "Preferences zurückgesetzt.\n";
