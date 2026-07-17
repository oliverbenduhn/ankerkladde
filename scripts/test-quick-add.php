<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/QuickAddParser.php';

function assertQuickAdd(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$categories = [
    ['id' => 1, 'name' => 'Einkauf', 'type' => 'list_quantity'],
    ['id' => 2, 'name' => 'Privat', 'type' => 'list_due_date'],
];

$parsed = parseQuickAdd('Zahnarzt anrufen morgen /privat !2', 1, $categories, '2026-07-17');
assertQuickAdd($parsed === [
    'ok' => true,
    'name' => 'Zahnarzt anrufen',
    'category_id' => 2,
    'due_date' => '2026-07-18',
    'due_time' => '',
    'priority' => '2',
], 'Happy Path wurde nicht korrekt geparst.');

$timed = parseQuickAdd('Arzt übermorgen 8 Uhr !1', 2, $categories, '2026-07-17');
assertQuickAdd($timed['due_date'] === '2026-07-19' && $timed['due_time'] === '08:00', 'HH Uhr wurde nicht erkannt.');

$colonTime = parseQuickAdd('Anruf heute 17:45 !3', 2, $categories, '2026-07-17');
assertQuickAdd($colonTime['due_date'] === '2026-07-17' && $colonTime['due_time'] === '17:45', 'HH:MM wurde nicht erkannt.');

$defaults = parseQuickAdd('Milch', 1, $categories, '2026-07-17');
assertQuickAdd($defaults['category_id'] === 1, 'Aktive Kategorie wurde nicht als Default verwendet.');
assertQuickAdd($defaults['due_date'] === '' && $defaults['due_time'] === '' && $defaults['priority'] === '', 'Fehlende Tokens müssen leer bleiben.');

$unknown = parseQuickAdd('Milch /unbekannt', 1, $categories, '2026-07-17');
assertQuickAdd($unknown['ok'] === false && $unknown['error_key'] === 'quick_add.unknown_category', 'Unbekannte Kategorie muss ablehnen.');

$ambiguous = parseQuickAdd('Termin heute morgen', 2, $categories, '2026-07-17');
assertQuickAdd($ambiguous['ok'] === false && $ambiguous['error_key'] === 'quick_add.ambiguous', 'Mehrere Datumsangaben müssen eskalieren.');
assertQuickAdd($ambiguous['can_escalate_to_ai'] === true, 'Mehrdeutige Eingabe muss AI-Eskalation anbieten.');

$invalidToken = parseQuickAdd('Termin !4', 2, $categories, '2026-07-17');
assertQuickAdd($invalidToken['ok'] === false && $invalidToken['error_key'] === 'quick_add.unresolved_token', 'Ungültiges Steuer-Token muss ablehnen.');

echo "Quick-Add-Parser-Tests erfolgreich.\n";
