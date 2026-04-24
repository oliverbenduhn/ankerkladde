<?php
declare(strict_types=1);

/**
 * Lädt Fluent UI SVG-Icons von unpkg herunter und ersetzt die bestehenden Icons.
 * Einmalig auszuführen: php scripts/download-icons.php
 */

$iconDir = __DIR__ . '/../public/icons/categories';
$backupDir = $iconDir . '/backup';

$mapping = [
    'einkauf'  => ['ShoppingBag24Regular', 'Cart24Regular'],
    'arbeit'   => ['Briefcase24Regular'],
    'notizen'  => ['Note24Regular', 'Notepad24Regular'],
    'bilder'   => ['Image24Regular'],
    'links'    => ['Link24Regular'],
    'dateien'  => ['FolderOpen24Regular', 'Folder24Regular'],
    'auto'     => ['VehicleCar24Regular', 'Vehicle24Regular'],
    'essen'    => ['Food24Regular'],
    'gemuese'  => ['Leaf24Regular'],
    'hygiene'  => ['Sparkle24Regular', 'Drop24Regular'],
    'geschenk' => ['Gift24Regular'],
    'buecher'  => ['BookOpen24Regular', 'Book24Regular'],
    'ideen'    => ['Lightbulb24Regular'],
    'werkzeug' => ['Wrench24Regular'],
    'paket'    => ['Box24Regular'],
    'medizin'  => ['MedKit24Regular', 'HeartPulse24Regular'],
    'erledigt' => ['CheckmarkCircle24Regular'],
    'finanzen' => ['Money24Regular'],
    'planung'  => ['CalendarLtr24Regular', 'Calendar24Regular'],
    'zuhause'  => ['Home24Regular'],
    'haustier' => ['Animal24Regular', 'PawPrint24Regular'],
    'baby'     => ['PersonHeart24Regular', 'Person24Regular'],
    'liebe'    => ['Heart24Regular'],
    'wetter'   => ['WeatherSunny24Regular'],
    'sport'    => ['Sport24Regular', 'Run24Regular', 'SportSoccer24Regular'],
    'reisen'   => ['Airplane24Regular'],
    'musik'    => ['MusicNote24Regular', 'MusicNote124Regular'],
    'film'     => ['MoviesAndTv24Regular', 'Play24Regular'],
    'kamera'   => ['Camera24Regular'],
    'stern'    => ['Star24Regular'],
];

$color = '#16345B';

// Backup
if (!is_dir($backupDir)) {
    mkdir($backupDir, 0755, true);
}
foreach (glob($iconDir . '/*.svg') as $file) {
    copy($file, $backupDir . '/' . basename($file));
}
echo "Backup erstellt in: $backupDir\n\n";

$success = [];
$failed  = [];

foreach ($mapping as $key => $candidates) {
    $downloaded = false;
    foreach ($candidates as $name) {
        $url = "https://unpkg.com/@sicons/fluent@latest/$name.svg";
        $ctx = stream_context_create(['http' => ['timeout' => 10]]);
        $svg = @file_get_contents($url, false, $ctx);

        if ($svg === false || str_starts_with(trim($svg), '<!')) {
            echo "  NICHT GEFUNDEN: $name\n";
            continue;
        }

        // currentColor durch feste Farbe ersetzen
        $svg = str_replace('currentColor', $color, $svg);

        file_put_contents($iconDir . '/' . $key . '.svg', $svg);
        echo "OK  $key  ←  $name\n";
        $success[] = $key;
        $downloaded = true;
        break;
    }

    if (!$downloaded) {
        echo "FEHLER: Kein Icon gefunden für '$key' (versucht: " . implode(', ', $candidates) . ")\n";
        $failed[] = $key;
    }
}

echo "\n--- Ergebnis ---\n";
echo "Erfolgreich: " . count($success) . "/" . count($mapping) . "\n";
if ($failed) {
    echo "Fehlgeschlagen: " . implode(', ', $failed) . "\n";
    echo "→ Für diese Keys bitte manuell ein Icon wählen.\n";
}
