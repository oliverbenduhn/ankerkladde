<?php
declare(strict_types=1);

function findAttachmentByItemId(PDO $db, int $itemId): ?array
{
    $stmt = $db->prepare(
        'SELECT id, item_id, storage_section, stored_name, original_name, media_type, size_bytes, created_at, updated_at
         FROM attachments
         WHERE item_id = :item_id'
    );
    $stmt->execute([':item_id' => $itemId]);
    $attachment = $stmt->fetch();

    return is_array($attachment) ? $attachment : null;
}

function rebuildSortOrder(PDO $db): void
{
    $db->beginTransaction();

    try {
        $pragmaRows = $db->query('PRAGMA table_info(items)')->fetchAll();
        $columnNames = array_column($pragmaRows, 'name');
        $hasCategoryId = in_array('category_id', $columnNames, true);
        $hasSection = in_array('section', $columnNames, true);

        $stmt = $db->prepare('UPDATE items SET sort_order = :sort_order WHERE id = :id');

        if ($hasCategoryId) {
            $categoryIds = $db->query('SELECT DISTINCT category_id FROM items WHERE category_id IS NOT NULL')->fetchAll(PDO::FETCH_COLUMN);

            foreach ($categoryIds as $categoryId) {
                $idsStmt = $db->prepare(
                    'SELECT id FROM items WHERE category_id = :category_id ORDER BY done ASC, updated_at DESC, id DESC'
                );
                $idsStmt->execute([':category_id' => $categoryId]);
                $ids = $idsStmt->fetchAll(PDO::FETCH_COLUMN);

                foreach ($ids as $index => $id) {
                    $stmt->execute([':sort_order' => $index + 1, ':id' => (int) $id]);
                }
            }
        }

        if ($hasSection) {
            $sectionSql = $hasCategoryId
                ? 'SELECT DISTINCT section FROM items WHERE category_id IS NULL'
                : 'SELECT DISTINCT section FROM items';
            $sections = $db->query($sectionSql)->fetchAll(PDO::FETCH_COLUMN);
            foreach ($sections as $section) {
                if ($hasCategoryId) {
                    $idsStmt = $db->prepare(
                        'SELECT id FROM items WHERE section = :section AND category_id IS NULL ORDER BY done ASC, updated_at DESC, id DESC'
                    );
                    $idsStmt->execute([':section' => $section]);
                } else {
                    $idsStmt = $db->prepare(
                        'SELECT id FROM items WHERE section = :section ORDER BY done ASC, updated_at DESC, id DESC'
                    );
                    $idsStmt->execute([':section' => $section]);
                }
                $ids = $idsStmt->fetchAll(PDO::FETCH_COLUMN);

                foreach ($ids as $index => $id) {
                    $stmt->execute([':sort_order' => $index + 1, ':id' => (int) $id]);
                }
            }
        } elseif (!$hasCategoryId) {
            $ids = $db->query(
                'SELECT id FROM items ORDER BY done ASC, updated_at DESC, id DESC'
            )->fetchAll(PDO::FETCH_COLUMN);
            foreach ($ids as $index => $id) {
                $stmt->execute([':sort_order' => $index + 1, ':id' => (int) $id]);
            }
        }

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }
}

function hasInvalidSortOrder(PDO $db, string $whereClause = '', array $params = []): bool
{
    $sql = 'SELECT
                COUNT(*) AS total,
                COUNT(DISTINCT sort_order) AS distinct_count,
                MIN(sort_order) AS min_sort_order
            FROM items';

    if ($whereClause !== '') {
        $sql .= ' WHERE ' . $whereClause;
    }

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $stats = $stmt->fetch();

    $total = (int) ($stats['total'] ?? 0);
    $distinctCount = (int) ($stats['distinct_count'] ?? 0);
    $minSortOrder = (int) ($stats['min_sort_order'] ?? 0);

    return $total > 0 && ($distinctCount !== $total || $minSortOrder < 1);
}

/**
 * Checks in a single query whether any category group (or orphan section group)
 * has a broken sort_order — replacing the previous N+1 per-category loop.
 *
 * Expected impact: reduces sort_order validation from N+1 queries to 1 query
 * on every PHP worker startup (once per process lifetime via the static $db cache).
 */
function hasAnyInvalidSortOrderByGroup(PDO $db, bool $hasCategoryId, bool $hasSection): bool
{
    if ($hasCategoryId) {
        // Check all category groups in one pass
        $stmt = $db->query(
            'SELECT COUNT(*) AS total,
                    COUNT(DISTINCT sort_order) AS distinct_count,
                    MIN(sort_order) AS min_sort_order
             FROM items
             WHERE category_id IS NOT NULL
             GROUP BY category_id
             HAVING total > 0 AND (distinct_count != total OR min_sort_order < 1)
             LIMIT 1'
        );
        if ($stmt->fetch() !== false) {
            return true;
        }

        if ($hasSection) {
            // Check orphan (legacy) section groups in one pass
            $stmt = $db->query(
                'SELECT COUNT(*) AS total,
                        COUNT(DISTINCT sort_order) AS distinct_count,
                        MIN(sort_order) AS min_sort_order
                 FROM items
                 WHERE category_id IS NULL
                 GROUP BY section
                 HAVING total > 0 AND (distinct_count != total OR min_sort_order < 1)
                 LIMIT 1'
            );
            if ($stmt->fetch() !== false) {
                return true;
            }
        }

        return false;
    }

    if ($hasSection) {
        $stmt = $db->query(
            'SELECT COUNT(*) AS total,
                    COUNT(DISTINCT sort_order) AS distinct_count,
                    MIN(sort_order) AS min_sort_order
             FROM items
             GROUP BY section
             HAVING total > 0 AND (distinct_count != total OR min_sort_order < 1)
             LIMIT 1'
        );
        return $stmt->fetch() !== false;
    }

    // No grouping columns — check the whole table
    return hasInvalidSortOrder($db);
}

function nextItemSortOrder(PDO $db, int $userId, int $categoryId): int
{
    $maxStmt = $db->prepare(
        'SELECT COALESCE(MAX(sort_order), 0) FROM items WHERE category_id = :category_id AND user_id = :user_id'
    );
    $maxStmt->execute([':category_id' => $categoryId, ':user_id' => $userId]);
    return (int) $maxStmt->fetchColumn() + 1;
}

function prependItemSortOrder(PDO $db, int $userId, int $categoryId): int
{
    $shiftStmt = $db->prepare(
        'UPDATE items
         SET sort_order = sort_order + 1
         WHERE category_id = :category_id AND user_id = :user_id'
    );
    $shiftStmt->execute([':category_id' => $categoryId, ':user_id' => $userId]);

    return 1;
}

function upsertScannedProduct(PDO $db, string $barcode, array $data, bool $confirmed): void
{
    $stmt = $db->prepare(
        'INSERT INTO scanned_products (barcode, product_name, brands, quantity, confirmed, scan_count, updated_at)
         VALUES (:barcode, :product_name, :brands, :quantity, :confirmed, 0, CURRENT_TIMESTAMP)
         ON CONFLICT(barcode) DO UPDATE SET
             product_name = :product_name,
             brands       = :brands,
             quantity     = :quantity,
             confirmed    = MAX(confirmed, :confirmed),
             updated_at   = CURRENT_TIMESTAMP'
    );
    $stmt->execute([
        ':barcode'      => $barcode,
        ':product_name' => (string) ($data['product_name'] ?? ''),
        ':brands'       => (string) ($data['brands'] ?? ''),
        ':quantity'     => (string) ($data['quantity'] ?? ''),
        ':confirmed'    => $confirmed ? 1 : 0,
    ]);
}
