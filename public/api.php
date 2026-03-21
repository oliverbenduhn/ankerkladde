<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';

startAppSession();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function requireMethod(string $expectedMethod): void
{
    if ($_SERVER['REQUEST_METHOD'] !== $expectedMethod) {
        header('Allow: ' . $expectedMethod);
        respond(405, ['error' => sprintf('Nur %s ist für diese Aktion erlaubt.', $expectedMethod)]);
    }
}

function requestData(): array
{
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if ($_POST !== []) {
            return $_POST;
        }
    }

    $raw = file_get_contents('php://input');
    if (!$raw) {
        return [];
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function requireCsrfToken(array $data): void
{
    $providedToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($data['csrf_token'] ?? null);

    if (!hasValidCsrfToken(is_string($providedToken) ? $providedToken : null)) {
        respond(403, ['error' => 'Ungültiges Sicherheits-Token.']);
    }
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
            requireMethod('GET');

            $stmt = $db->query(
                'SELECT id, name, quantity, done, created_at, updated_at
                 FROM items
                 ORDER BY done ASC, updated_at DESC, id DESC'
            );

            respond(200, ['items' => $stmt->fetchAll()]);

        case 'add':
            requireMethod('POST');

            $data = requestData();
            requireCsrfToken($data);
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
            requireMethod('POST');

            $data = requestData();
            requireCsrfToken($data);
            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT);
            $done = filter_var($data['done'] ?? null, FILTER_VALIDATE_INT, [
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

            if ($stmt->rowCount() === 0) {
                respond(404, ['error' => 'Artikel nicht gefunden.']);
            }

            respond(200, ['message' => 'Status aktualisiert.']);

        case 'delete':
            requireMethod('POST');

            $data = requestData();
            requireCsrfToken($data);
            $id = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT);
            if (!$id) {
                respond(422, ['error' => 'Ungültige ID.']);
            }

            $stmt = $db->prepare('DELETE FROM items WHERE id = :id');
            $stmt->execute([':id' => $id]);

            if ($stmt->rowCount() === 0) {
                respond(404, ['error' => 'Artikel nicht gefunden.']);
            }

            respond(200, ['message' => 'Artikel gelöscht.']);

        case 'clear':
            requireMethod('POST');

            $data = requestData();
            requireCsrfToken($data);
            $deletedCount = $db->exec('DELETE FROM items WHERE done = 1');
            respond(200, [
                'message' => 'Erledigte Artikel gelöscht.',
                'deleted' => (int) $deletedCount,
            ]);

        default:
            respond(404, ['error' => 'Unbekannte Aktion.']);
    }
} catch (Throwable $exception) {
    error_log(sprintf('Einkauf API error [%s]: %s', (string) $action, (string) $exception));
    respond(500, ['error' => 'Serverfehler.']);
}
