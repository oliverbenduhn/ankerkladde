<?php
declare(strict_types=1);

require __DIR__ . '/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function requestData(): array
{
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        return $_POST;
    }

    $raw = file_get_contents('php://input');
    if (!$raw) {
        return [];
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function normalizeName(?string $name): string
{
    $name = trim((string) $name);
    $name = preg_replace('/\s+/u', ' ', $name) ?? '';
    return mb_substr($name, 0, 120);
}

function normalizeQuantity(?string $quantity): string
{
    $quantity = trim((string) $quantity);
    $quantity = preg_replace('/\s+/u', ' ', $quantity) ?? '';
    return mb_substr($quantity, 0, 40);
}

$action = $_GET['action'] ?? 'list';
$db = getDatabase();

try {
    switch ($action) {
        case 'list':
            $stmt = $db->query(
                'SELECT id, name, quantity, done, created_at, updated_at
                 FROM items
                 ORDER BY done ASC, updated_at DESC, id DESC'
            );

            respond(200, ['items' => $stmt->fetchAll()]);

        case 'add':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                respond(405, ['error' => 'Nur POST ist für diese Aktion erlaubt.']);
            }

            $data = requestData();
            $name = normalizeName($data['name'] ?? null);
            $quantity = normalizeQuantity($data['quantity'] ?? null);

            if ($name == '') {
                respond(422, ['error' => 'Bitte gib einen Artikelnamen ein.']);
            }

            $stmt = $db->prepare(
                'INSERT INTO items (name, quantity) VALUES (:name, :quantity)'
            );
            $stmt->execute([
                ':name' => $name,
                ':quantity' => $quantity,
            ]);

            respond(201, [
                'message' => 'Artikel hinzugefügt.',
                'id' => (int) $db->lastInsertId(),
            ]);

        case 'toggle':
            $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
            $done = filter_input(INPUT_GET, 'done', FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 0, 'max_range' => 1],
            ]);

            if (!$id || $done === false || $done === null) {
                respond(422, ['error' => 'Ungültige Parameter für den Statuswechsel.']);
            }

            $stmt = $db->prepare(
                'UPDATE items SET done = :done, updated_at = CURRENT_TIMESTAMP WHERE id = :id'
            );
            $stmt->execute([
                ':done' => $done,
                ':id' => $id,
            ]);

            respond(200, ['message' => 'Status aktualisiert.']);

        case 'delete':
            $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
            if (!$id) {
                respond(422, ['error' => 'Ungültige ID.']);
            }

            $stmt = $db->prepare('DELETE FROM items WHERE id = :id');
            $stmt->execute([':id' => $id]);

            respond(200, ['message' => 'Artikel gelöscht.']);

        case 'clear':
            $db->exec('DELETE FROM items WHERE done = 1');
            respond(200, ['message' => 'Erledigte Artikel gelöscht.']);

        default:
            respond(404, ['error' => 'Unbekannte Aktion.']);
    }
} catch (Throwable $exception) {
    respond(500, ['error' => 'Serverfehler', 'details' => $exception->getMessage()]);
}
