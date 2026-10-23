<?php
declare(strict_types=1);

$css = (string) file_get_contents(dirname(__DIR__) . '/public/style.css');
$header = substr($css, 0, 800);
preg_match_all('/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\s*\(/', $css, $matches);
$literalCount = count($matches[0]);

if ($literalCount > 60 && preg_match('/tokens:\s*pass/i', $header) === 1) {
    fwrite(STDERR, "Design stamp claims token compliance despite {$literalCount} direct color literals.\n");
    exit(1);
}

echo "Design-token stamp is honest ({$literalCount} direct color literals).\n";
