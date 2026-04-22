#!/usr/bin/env php
<?php
require dirname(__DIR__) . '/security.php';
require dirname(__DIR__) . '/db.php';
$db = getDatabase();
$db->exec("UPDATE users SET preferences_json = json_patch(preferences_json, '{\"mode\":\"liste\",\"last_category_id\":1}') WHERE username='tester'");
echo "Preferences zurückgesetzt.\n";
