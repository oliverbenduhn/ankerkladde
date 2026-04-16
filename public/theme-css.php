<?php
declare(strict_types=1);

require_once __DIR__ . '/theme.php';

header('Content-Type: text/css');
echo renderThemeTokensCSS();