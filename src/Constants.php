<?php
declare(strict_types=1);

const CATEGORY_TYPES = ['list_quantity', 'list_due_date', 'notes', 'daily_notes', 'images', 'files', 'links'];
const ATTACHMENT_CATEGORY_TYPES = ['images', 'files'];
const AGENDA_GROUP_OVERDUE = 'overdue';
const AGENDA_GROUP_SCHEDULED = 'scheduled';
const AGENDA_GROUP_ANYTIME_TODAY = 'anytime_today';
const AGENDA_GROUPS = [AGENDA_GROUP_OVERDUE, AGENDA_GROUP_SCHEDULED, AGENDA_GROUP_ANYTIME_TODAY];
const DEFAULT_UPLOAD_LIMITS_MB = [
    'image_upload_max_mb' => 20,
    'file_upload_max_mb' => 500,
    'remote_file_import_max_mb' => 10240,
];
// IMPORTANT: CATEGORY_ICON_OPTIONS must always be an exact copy of the keys
// from CATEGORY_ICON_LABELS. PHP `const` does not allow array_keys() here,
// so when adding a new icon, update BOTH arrays to keep them in sync.
const CATEGORY_ICON_OPTIONS = [
    'einkauf', 'arbeit', 'notizen', 'bilder', 'links', 'dateien',
    'auto', 'essen', 'gemuese', 'hygiene', 'geschenk', 'buecher',
    'ideen', 'werkzeug', 'paket', 'medizin', 'erledigt', 'finanzen',
    'planung', 'zuhause', 'haustier', 'baby', 'liebe', 'wetter',
    'sport', 'reisen', 'musik', 'film', 'kamera', 'stern',
];
const CATEGORY_ICON_LABELS = [
    'einkauf' => 'Einkauf',
    'arbeit' => 'Arbeit',
    'notizen' => 'Notizen',
    'bilder' => 'Bilder',
    'links' => 'Links',
    'dateien' => 'Dateien',
    'auto' => 'Auto',
    'essen' => 'Essen',
    'gemuese' => 'Gemuese',
    'hygiene' => 'Hygiene',
    'geschenk' => 'Geschenk',
    'buecher' => 'Buecher',
    'ideen' => 'Ideen',
    'werkzeug' => 'Werkzeug',
    'paket' => 'Paket',
    'medizin' => 'Medizin',
    'erledigt' => 'Erledigt',
    'finanzen' => 'Finanzen',
    'planung' => 'Planung',
    'zuhause' => 'Zuhause',
    'haustier' => 'Haustier',
    'baby' => 'Baby',
    'liebe' => 'Liebe',
    'wetter' => 'Wetter',
    'sport' => 'Sport',
    'reisen' => 'Reisen',
    'musik' => 'Musik',
    'film' => 'Film',
    'kamera' => 'Kamera',
    'stern' => 'Stern',
];
const LEGACY_CATEGORY_ICON_MAP = [
    '🛒' => 'einkauf',
    '💊' => 'medizin',
    '✅' => 'erledigt',
    '💼' => 'arbeit',
    '📝' => 'notizen',
    '🖼️' => 'bilder',
    '🖼' => 'bilder',
    '📁' => 'dateien',
    '🔗' => 'links',
    '⭐' => 'stern',
    '📌' => 'planung',
    '🏠' => 'zuhause',
    '🚗' => 'auto',
    '🍎' => 'essen',
    '🥦' => 'gemuese',
    '🧴' => 'hygiene',
    '🎁' => 'geschenk',
    '📚' => 'buecher',
    '💡' => 'ideen',
    '🔧' => 'werkzeug',
    '📦' => 'paket',
    '🐶' => 'haustier',
    '👶' => 'baby',
    '❤️' => 'liebe',
    '❤' => 'liebe',
    '☀️' => 'wetter',
    '☀' => 'wetter',
];
const LEGACY_CATEGORY_DEFINITIONS = [
    'shopping' => ['name' => 'Einkauf', 'type' => 'list_quantity', 'sort_order' => 1, 'icon' => 'einkauf'],
    'todo_private' => ['name' => 'Privat', 'type' => 'list_due_date', 'sort_order' => 2, 'icon' => 'erledigt'],
    'todo_work' => ['name' => 'Arbeit', 'type' => 'list_due_date', 'sort_order' => 3, 'icon' => 'arbeit'],
    'notes' => ['name' => 'Notizen', 'type' => 'notes', 'sort_order' => 4, 'icon' => 'notizen'],
    'images' => ['name' => 'Bilder', 'type' => 'images', 'sort_order' => 5, 'icon' => 'bilder'],
    'files' => ['name' => 'Dateien', 'type' => 'files', 'sort_order' => 6, 'icon' => 'dateien'],
    'links' => ['name' => 'Links', 'type' => 'links', 'sort_order' => 7, 'icon' => 'links'],
];
