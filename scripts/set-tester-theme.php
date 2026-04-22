#!/usr/bin/env php
<?php
require dirname(__DIR__) . '/security.php';
require dirname(__DIR__) . '/db.php';
$mode  = $argv[1] ?? 'light';
$theme = $argv[2] ?? 'hafenblau';
$key   = $mode === 'dark' ? 'dark_theme' : 'light_theme';
$db    = getDatabase();
$db->exec("UPDATE users SET preferences_json=json_patch(COALESCE(preferences_json,'{}'),json_object('theme_mode'," . $db->quote($mode) . "," . $db->quote($key) . "," . $db->quote($theme) . ",'mode','liste','last_category_id',1)) WHERE username='tester'");
echo "Theme gesetzt: $theme ($mode)\n";
