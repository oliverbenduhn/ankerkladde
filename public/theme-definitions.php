<?php
declare(strict_types=1);

function getAvailableThemes(): array {
    static $themes = null;
    if ($themes === null) {
        $themes = require __DIR__ . '/theme-data.php';
    }
    return $themes;
}