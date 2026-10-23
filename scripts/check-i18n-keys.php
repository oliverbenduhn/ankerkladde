<?php
declare(strict_types=1);

$root = dirname(__DIR__);
$languages = ['de', 'en'];
$keysByLanguage = [];
foreach ($languages as $language) {
    $decoded = json_decode((string) file_get_contents("{$root}/lang/{$language}.json"), true, 512, JSON_THROW_ON_ERROR);
    $keysByLanguage[$language] = array_keys($decoded);
    sort($keysByLanguage[$language]);
}

$missingInEnglish = array_values(array_diff($keysByLanguage['de'], $keysByLanguage['en']));
$missingInGerman = array_values(array_diff($keysByLanguage['en'], $keysByLanguage['de']));
if ($missingInEnglish !== [] || $missingInGerman !== []) {
    fwrite(STDERR, 'Missing in en: ' . implode(', ', $missingInEnglish) . PHP_EOL);
    fwrite(STDERR, 'Missing in de: ' . implode(', ', $missingInGerman) . PHP_EOL);
    exit(1);
}
echo 'i18n key sets match (' . count($keysByLanguage['de']) . ' keys).' . PHP_EOL;
