<?php
$url = 'https://www.heise.de';
$html = @file_get_contents($url, false, stream_context_create([
    'http' => [
        'timeout' => 8,
        'user_agent' => 'Mozilla/5.0 (compatible; Ankerkladde/1.0)',
    ],
]));

if (!$html) {
    echo "FAILED to fetch\n";
    exit(1);
}

echo "Got " . strlen($html) . " bytes\n";

if (preg_match('/<title[^>]*>([^<]+)<\/title>/i', $html, $m)) {
    echo "title: " . $m[1] . "\n";
} else {
    echo "title: none\n";
}

if (preg_match('/<meta\s+property=["\']og:title["\']\s+content=["\']([^"\']*)["\']/i', $html, $m)) {
    echo "og:title: " . $m[1] . "\n";
} else {
    echo "og:title: none\n";
}

if (preg_match('/<meta\s+property=["\']og:description["\']\s+content=["\']([^"\']*)["\']/i', $html, $m)) {
    echo "og:description: " . substr($m[1], 0, 100) . "...\n";
} else {
    echo "og:description: none\n";
}

if (preg_match('/<meta\s+name=["\']description["\']\s+content=["\']([^"\']*)["\']/i', $html, $m)) {
    echo "meta description: " . substr($m[1], 0, 100) . "...\n";
} else {
    echo "meta description: none\n";
}