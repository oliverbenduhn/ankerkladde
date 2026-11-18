<?php
declare(strict_types=1);

require dirname(__DIR__) . '/security.php';
require dirname(__DIR__) . '/db.php';

$db = getDatabase();
fwrite(STDOUT, 'Database schema ready (version ' . getSchemaVersion($db) . ").\n");
