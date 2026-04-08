<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';
require dirname(__DIR__) . '/security.php';

enforceCanonicalRequest();
startAppSession();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const VALID_SECTIONS = ['shopping', 'meds', 'todo_private', 'todo_work', 'notes', 'images', 'files', 'links'];

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

function getSection(array $data = []): string
{
    $section = $_GET['section'] ?? ($data['section'] ?? 'shopping');
    if (!in_array($section, VALID_SECTIONS, true)) {
        respond(422, ['error' => 'Ungültige Sektion.']);
    }
    return (string) $section;
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

function normalizeContent(?string $content): string
{
    return mb_substr(trim((string) $content), 0, 102400);
}

function normalizeIdList(mixed $ids): array
{
    if (!is_array($ids) || $ids === []) {
        return [];
    }

    $normalized = [];

    foreach ($ids as $rawId) {
        $id = filter_var($rawId, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1],
        ]);

        if ($id === false || $id === null) {
            return [];
        }

        $normalized[] = (int) $id;
    }

    if (count(array_unique($normalized)) !== count($normalized)) {
        return [];
    }

    return $normalized;
}

$action = $_GET['action'] ?? 'list';
$db = getDatabase();

try {
    switch ($action) {
        case 'list':
            requireMethod('GET');
            $section = getSection();

            $stmt = $db->prepare(
                'SELECT
                    items.id,
                    items.name,
                    items.quantity,
                    items.content,
                    items.done,
                    items.sort_order,
                    items.created_at,
                    items.updated_at,
                    attachments.storage_section AS attachment_storage_section,
                    attachments.original_name AS attachment_original_name,
                    attachments.media_type AS attachment_media_type,
                    attachments.size_bytes AS attachment_size_bytes,
                    CASE WHEN attachments.id IS NULL THEN NULL ELSE "media.php?item_id=" || items.id END AS attachment_url,
                    CASE WHEN attachments.id IS NULL THEN 0 ELSE 1 END AS has_attachment
                 FROM items
                 LEFT JOIN attachments
                    ON attachments.item_id = items.id
                   AND attachments.storage_section = items.section
                 WHERE items.section = :section
                 ORDER BY items.sort_order ASC, items.id ASC'
            );
            $stmt->execute([':section' => $section]);

            respond(200, ['items' => $stmt->fetchAll()]);

        case 'add':
            requireMethod('POST');

            $data     = requestData();
            requireCsrfToken($data);
            $section  = getSection($data);
            $name     = normalizeName($data['name'] ?? null);
            $quantity = normalizeQuantity($data['quantity'] ?? null);
            $content  = normalizeContent($data['content'] ?? null);

            if ($name == '') {
                respond(422, ['error' => 'Bitte gib einen Artikelnamen ein.']);
            }

            // Global MAX ensures sort_order is unique across all sections (prevents db integrity check failure)
            $maxStmt = $db->query('SELECT COALESCE(MAX(sort_order), 0) FROM items');
            $nextOrder = (int) $maxStmt->fetchColumn() + 1;

            $stmt = $db->prepare(
                'INSERT INTO items (name, quantity, content, section, sort_order)
                 VALUES (:name, :quantity, :content, :section, :sort_order)'
            );
            $stmt->execute([
                ':name'       => $name,
                ':quantity'   => $quantity,
                ':content'    => $content,
                ':section'    => $section,
                ':sort_order' => $nextOrder,
            ]);

            respond(201, [
                'message' => 'Artikel hinzugefügt.',
                'id'      => (int) $db->lastInsertId(),
            ]);

        case 'toggle':
            requireMethod('POST');

            $data = requestData();
            requireCsrfToken($data);
            $id   = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT);
            $done = filter_var($data['done'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 0, 'max_range' => 1],
            ]);

            if (!$id || $done === false || $done === null) {
                respond(422, ['error' => 'Ungültige Parameter für den Statuswechsel.']);
            }

            $stmt = $db->prepare(
                'UPDATE items SET done = :done, updated_at = CURRENT_TIMESTAMP WHERE id = :id'
            );
            $stmt->execute([':done' => $done, ':id' => $id]);

            if ($stmt->rowCount() === 0) {
                respond(404, ['error' => 'Artikel nicht gefunden.']);
            }

            respond(200, ['message' => 'Status aktualisiert.']);

        case 'update':
            requireMethod('POST');

            $data     = requestData();
            requireCsrfToken($data);
            $id       = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 1],
            ]);
            $name     = normalizeName($data['name'] ?? null);
            $quantity = normalizeQuantity($data['quantity'] ?? null);
            $content  = normalizeContent($data['content'] ?? null);

            if (!$id) {
                respond(422, ['error' => 'Ungültige ID.']);
            }

            if ($name === '') {
                respond(422, ['error' => 'Bitte gib einen Artikelnamen ein.']);
            }

            $stmt = $db->prepare(
                'UPDATE items
                 SET name = :name, quantity = :quantity, content = :content, updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id'
            );
            $stmt->execute([':id' => $id, ':name' => $name, ':quantity' => $quantity, ':content' => $content]);

            if ($stmt->rowCount() === 0) {
                $existsStmt = $db->prepare('SELECT 1 FROM items WHERE id = :id');
                $existsStmt->execute([':id' => $id]);

                if ($existsStmt->fetchColumn() === false) {
                    respond(404, ['error' => 'Artikel nicht gefunden.']);
                }
            }

            respond(200, ['message' => 'Artikel aktualisiert.']);

        case 'delete':
            requireMethod('POST');

            $data = requestData();
            requireCsrfToken($data);
            $id   = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT);
            if (!$id) {
                respond(422, ['error' => 'Ungültige ID.']);
            }

            $attachment = findAttachmentByItemId($db, (int) $id);

            $db->beginTransaction();
            $stmt = $db->prepare('DELETE FROM items WHERE id = :id');
            $stmt->execute([':id' => $id]);

            if ($stmt->rowCount() === 0) {
                $db->rollBack();
                respond(404, ['error' => 'Artikel nicht gefunden.']);
            }

            if ($attachment !== null) {
                deleteAttachmentStorageFile($attachment);
            }

            $db->commit();

            respond(200, ['message' => 'Artikel gelöscht.']);

        case 'clear':
            requireMethod('POST');

            $data    = requestData();
            requireCsrfToken($data);
            $section = getSection($data);

            $attachmentStmt = $db->prepare(
                'SELECT attachments.id, attachments.item_id, attachments.storage_section, attachments.stored_name
                 FROM attachments
                 INNER JOIN items
                    ON items.id = attachments.item_id
                 WHERE items.done = 1
                   AND items.section = :section'
            );
            $attachmentStmt->execute([':section' => $section]);
            $attachments = $attachmentStmt->fetchAll();

            $db->beginTransaction();
            $stmt = $db->prepare('DELETE FROM items WHERE done = 1 AND section = :section');
            $stmt->execute([':section' => $section]);

            foreach ($attachments as $attachment) {
                deleteAttachmentStorageFile($attachment);
            }

            $db->commit();

            respond(200, [
                'message' => 'Erledigte Artikel gelöscht.',
                'deleted' => (int) $stmt->rowCount(),
            ]);

        case 'reorder':
            requireMethod('POST');

            $data    = requestData();
            requireCsrfToken($data);
            $section = getSection($data);
            $ids     = normalizeIdList($data['ids'] ?? null);

            if ($ids === []) {
                respond(422, ['error' => 'Ungültige Reihenfolge.']);
            }

            $existingStmt = $db->prepare(
                'SELECT id FROM items WHERE section = :section ORDER BY sort_order ASC, id ASC'
            );
            $existingStmt->execute([':section' => $section]);
            $existingIds = array_map(
                static fn(mixed $id): int => (int) $id,
                $existingStmt->fetchAll(PDO::FETCH_COLUMN)
            );

            sort($ids);
            $sortedExistingIds = $existingIds;
            sort($sortedExistingIds);

            if ($ids !== $sortedExistingIds) {
                respond(422, ['error' => 'Reihenfolge passt nicht zur aktuellen Liste.']);
            }

            $orderedIds = normalizeIdList($data['ids'] ?? null);
            $stmt = $db->prepare(
                'UPDATE items
                 SET sort_order = :sort_order, updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id'
            );

            $db->beginTransaction();

            foreach ($orderedIds as $index => $id) {
                $stmt->execute([
                    ':sort_order' => $index + 1,
                    ':id'         => $id,
                ]);
            }

            $db->commit();

            respond(200, ['message' => 'Reihenfolge aktualisiert.']);

        default:
            respond(404, ['error' => 'Unbekannte Aktion.']);
    }
} catch (Throwable $exception) {
    if ($db instanceof PDO && $db->inTransaction()) {
        $db->rollBack();
    }

    error_log(sprintf('Einkauf API error [%s]: %s', (string) $action, (string) $exception));
    respond(500, ['error' => 'Serverfehler.']);
}
