<?php
declare(strict_types=1);

/**
 * Parse Quick-Add input without accessing a clock, database, or network.
 *
 * @param array<int, array{id:int|string,name:string,type?:string}> $categories
 * @return array<string, int|string|bool>
 */
function parseQuickAdd(string $input, int $activeCategoryId, array $categories, string $today): array
{
    $working = trim($input);
    $failure = static fn(string $key, string $message, bool $canEscalate = true): array => [
        'ok' => false,
        'error_key' => $key,
        'error' => $message,
        'can_escalate_to_ai' => $canEscalate,
    ];

    if ($working === '') {
        return $failure('quick_add.name_required', 'Bitte gib einen Namen ein.', false);
    }

    preg_match_all('/\b(übermorgen|heute|morgen)\b/iu', $working, $dateMatches);
    if (count($dateMatches[0]) > 1) {
        return $failure('quick_add.ambiguous', 'Die Eingabe enthält mehrere Datumsangaben.');
    }
    $dateToken = isset($dateMatches[1][0]) ? mb_strtolower($dateMatches[1][0], 'UTF-8') : '';
    $working = preg_replace('/\b(übermorgen|heute|morgen)\b/iu', ' ', $working) ?? $working;

    preg_match_all('/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/u', $working, $colonMatches, PREG_SET_ORDER);
    preg_match_all('/(?<!\d)([01]?\d|2[0-3])\s+Uhr\b/iu', $working, $hourMatches, PREG_SET_ORDER);
    if (count($colonMatches) + count($hourMatches) > 1) {
        return $failure('quick_add.ambiguous', 'Die Eingabe enthält mehrere Uhrzeiten.');
    }
    $dueTime = '';
    if ($colonMatches !== []) {
        $dueTime = sprintf('%02d:%02d', (int) $colonMatches[0][1], (int) $colonMatches[0][2]);
        $working = preg_replace('/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/u', ' ', $working) ?? $working;
    } elseif ($hourMatches !== []) {
        $dueTime = sprintf('%02d:00', (int) $hourMatches[0][1]);
        $working = preg_replace('/(?<!\d)([01]?\d|2[0-3])\s+Uhr\b/iu', ' ', $working) ?? $working;
    }

    preg_match_all('/!(1|2|3)\b/u', $working, $priorityMatches);
    if (count($priorityMatches[0]) > 1) {
        return $failure('quick_add.ambiguous', 'Die Eingabe enthält mehrere Prioritäten.');
    }
    $priority = $priorityMatches[1][0] ?? '';
    $working = preg_replace('/!(1|2|3)\b/u', ' ', $working) ?? $working;

    preg_match_all('/\/([^\s!]+)/u', $working, $categoryMatches);
    if (count($categoryMatches[0]) > 1) {
        return $failure('quick_add.ambiguous', 'Die Eingabe enthält mehrere Kategorien.');
    }

    $categoryId = $activeCategoryId;
    if (isset($categoryMatches[1][0])) {
        $requestedName = mb_strtolower(trim($categoryMatches[1][0]), 'UTF-8');
        $matching = array_values(array_filter(
            $categories,
            static fn(array $category): bool => mb_strtolower(trim((string) $category['name']), 'UTF-8') === $requestedName
        ));
        if (count($matching) !== 1) {
            return $failure('quick_add.unknown_category', 'Kategorie nicht gefunden: /' . $categoryMatches[1][0], false);
        }
        $categoryId = (int) $matching[0]['id'];
        $working = preg_replace('/\/([^\s!]+)/u', ' ', $working) ?? $working;
    }

    if (preg_match('/(?:!\S+|\/\S+|\b\d{1,2}:\d{2}\b)/u', $working) === 1) {
        return $failure('quick_add.unresolved_token', 'Mindestens ein Steuer-Token konnte nicht aufgelöst werden.');
    }

    if ($dueTime !== '' && $dateToken === '') {
        return $failure('quick_add.ambiguous', 'Eine Uhrzeit benötigt eine Datumsangabe.');
    }

    $name = trim(preg_replace('/\s+/u', ' ', $working) ?? $working);
    if ($name === '') {
        return $failure('quick_add.name_required', 'Bitte gib einen Namen ein.', false);
    }

    $dueDate = '';
    if ($dateToken !== '') {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $today);
        if (!$date instanceof DateTimeImmutable || $date->format('Y-m-d') !== $today) {
            return $failure('quick_add.invalid_today', 'Das Bezugsdatum ist ungültig.', false);
        }
        $days = ['heute' => 0, 'morgen' => 1, 'übermorgen' => 2][$dateToken];
        $dueDate = $date->modify('+' . $days . ' days')->format('Y-m-d');
    }

    return [
        'ok' => true,
        'name' => $name,
        'category_id' => $categoryId,
        'due_date' => $dueDate,
        'due_time' => $dueTime,
        'priority' => $priority,
    ];
}
