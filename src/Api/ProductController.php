<?php
declare(strict_types=1);

function handleProductApiAction(PDO $db, int $userId, string $action): never
{
    switch ($action) {
        case 'product_lookup':
            requireMethod('GET');
            $barcode = preg_replace('/\D+/', '', (string) ($_GET['barcode'] ?? '')) ?? '';
            $barcode = truncateText($barcode, 64);

            if ($barcode === '') {
                respond(422, ['error' => t('error.invalid_barcode'), 'error_key' => 'error.invalid_barcode']);
            }

            // 1. scanned_products — Single Point of Truth
            $stmt = $db->prepare(
                'SELECT barcode, product_name, brands, quantity
                 FROM scanned_products
                 WHERE barcode = :barcode
                 LIMIT 1'
            );
            $stmt->execute([':barcode' => $barcode]);
            $scanned = $stmt->fetch();

            if (is_array($scanned)) {
                respond(200, [
                    'product' => [
                        'barcode'      => (string) ($scanned['barcode'] ?? ''),
                        'product_name' => (string) ($scanned['product_name'] ?? ''),
                        'brands'       => (string) ($scanned['brands'] ?? ''),
                        'quantity'     => (string) ($scanned['quantity'] ?? ''),
                        'source'       => 'local',
                    ],
                ]);
            }

            // 2. product_catalog — OpenFoodFacts-Fallback
            $productDb = getProductDatabase();
            $stmt = $productDb->prepare(
                'SELECT barcode, product_name, brands, quantity
                 FROM product_catalog
                 WHERE barcode = :barcode
                 LIMIT 1'
            );
            $stmt->execute([':barcode' => $barcode]);
            $catalog = $stmt->fetch();

            if (is_array($catalog)) {
                $preferences = getExtendedUserPreferences($db, $userId);
                $aiConfig = getActiveAiConfig($preferences);
                $usedAiNormalization = $aiConfig['provider'] === 'openai_compatible'
                    ? $aiConfig['base_url'] !== ''
                    : trim((string) ($aiConfig['key'] ?? '')) !== '';
                $normalizedCatalog = normalizeOpenFoodFactsProductWithAi([
                    'product_name' => (string) ($catalog['product_name'] ?? ''),
                    'brands' => (string) ($catalog['brands'] ?? ''),
                    'quantity' => (string) ($catalog['quantity'] ?? ''),
                ], $preferences);

                upsertScannedProduct($db, $barcode, $normalizedCatalog, false);

                respond(200, [
                    'product' => [
                        'barcode'      => (string) ($catalog['barcode'] ?? ''),
                        'product_name' => (string) ($normalizedCatalog['product_name'] ?? ''),
                        'brands'       => (string) ($normalizedCatalog['brands'] ?? ''),
                        'quantity'     => (string) ($normalizedCatalog['quantity'] ?? ''),
                        'source'       => $usedAiNormalization ? 'catalog_ai' : 'catalog',
                    ],
                ]);
            }


            respond(404, ['error' => t('error.product_not_found'), 'error_key' => 'error.product_not_found']);

        case 'product_normalize_debug':
            requireMethod('GET');
            // Restricted to admin users only — exposes internal normalization details.
            if (!isAdminUser()) {
                respond(403, ['error' => t('error.unknown_action'), 'error_key' => 'error.unknown_action']);
            }
            $barcode = preg_replace('/\D+/', '', (string) ($_GET['barcode'] ?? '')) ?? '';
            $barcode = truncateText($barcode, 64);

            if ($barcode === '') {
                respond(422, ['error' => t('error.invalid_barcode'), 'error_key' => 'error.invalid_barcode']);
            }

            $productDb = getProductDatabase();
            $stmt = $productDb->prepare(
                'SELECT barcode, product_name, brands, quantity, source
                 FROM product_catalog
                 WHERE barcode = :barcode
                 LIMIT 1'
            );
            $stmt->execute([':barcode' => $barcode]);
            $catalog = $stmt->fetch();

            if (!is_array($catalog)) {
                respond(404, ['error' => t('error.product_not_found'), 'error_key' => 'error.product_not_found']);
            }

            $rawProduct = [
                'barcode' => (string) ($catalog['barcode'] ?? ''),
                'product_name' => (string) ($catalog['product_name'] ?? ''),
                'brands' => (string) ($catalog['brands'] ?? ''),
                'quantity' => (string) ($catalog['quantity'] ?? ''),
                'source' => (string) ($catalog['source'] ?? ''),
            ];
            $heuristicProduct = heuristicNormalizeProductData($rawProduct);
            $preferences = getExtendedUserPreferences($db, $userId);
            $aiProduct = normalizeOpenFoodFactsProductWithAi($rawProduct, $preferences);

            respond(200, [
                'barcode' => $barcode,
                'raw' => $rawProduct,
                'heuristic' => $heuristicProduct,
                'ai' => $aiProduct,
                'ai_enabled' => (function () use ($preferences): bool {
                    $cfg = getActiveAiConfig($preferences);
                    if ($cfg['provider'] === 'openai_compatible') {
                        return $cfg['base_url'] !== '';
                    }
                    return trim((string) ($cfg['key'] ?? '')) !== '';
                })(),
            ]);

        case 'fetch_metadata':
            requireMethod('GET');
            $url = trim((string) ($_GET['url'] ?? ''));
            if ($url === '' || !filter_var($url, FILTER_VALIDATE_URL)) {
                respond(422, ['error' => t('error.invalid_url'), 'error_key' => 'error.invalid_url']);
            }

            if (!isAllowedRemoteUrl($url)) {
                respond(422, ['error' => t('error.url_external_only'), 'error_key' => 'error.url_external_only']);
            }

            $remote = fetchRemoteHtml($url);
            if (!is_string($remote['html'] ?? null)) {
                respond(200, [
                    'title' => '',
                    'description' => '',
                    'image' => '',
                    'error' => (string) ($remote['error'] ?? t('error.page_unreachable')),
                    'error_key' => (string) ($remote['error_key'] ?? 'error.page_unreachable'),
                ]);
            }

            $html = (string) $remote['html'];
            $title = extractMetaContent($html, 'property', 'og:title');
            if ($title === '') {
                $title = extractMetaContent($html, 'name', 'twitter:title');
            }
            if ($title === '' && preg_match('/<title[^>]*>(.*?)<\/title>/is', $html, $m) === 1) {
                $title = normalizeWhitespace(html_entity_decode((string) ($m[1] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
            }

            $description = extractMetaContent($html, 'property', 'og:description');
            if ($description === '') {
                $description = extractMetaContent($html, 'name', 'description');
            }
            if ($description === '') {
                $description = extractMetaContent($html, 'name', 'twitter:description');
            }

            $image = extractMetaContent($html, 'property', 'og:image');
            if ($image === '') {
                $image = extractMetaContent($html, 'name', 'twitter:image');
            }
            $image = absolutizeUrl($url, $image);

            if ($image !== '' && !filter_var($image, FILTER_VALIDATE_URL)) {
                $image = '';
            }

            respond(200, [
                'title' => truncateText($title, 200),
                'description' => truncateText($description, 500),
                'image' => $image,
            ]);

        case 'product_details':
            requireMethod('GET');
            $barcode = preg_replace('/\D+/', '', (string) ($_GET['barcode'] ?? '')) ?? '';
            $barcode = truncateText($barcode, 64);

            if ($barcode === '') {
                respond(422, ['error' => t('error.invalid_barcode'), 'error_key' => 'error.invalid_barcode']);
            }

            $productDb = getProductDatabase();
            $summaryStmt = $productDb->prepare(
                'SELECT barcode, product_name, brands, quantity, source
                 FROM product_catalog
                 WHERE barcode = :barcode
                 LIMIT 1'
            );
            $summaryStmt->execute([':barcode' => $barcode]);
            $summary = $summaryStmt->fetch();

            if (!is_array($summary)) {
                respond(404, ['error' => t('error.product_not_found'), 'error_key' => 'error.product_not_found']);
            }

            $sources = [];
            $sourceNames = array_values(array_filter(array_map('trim', explode(',', (string) ($summary['source'] ?? '')))));

            foreach ($sourceNames as $dataset) {
                try {
                    $tableName = getProductCatalogTableName($dataset);
                } catch (InvalidArgumentException) {
                    continue;
                }

                $tableIdentifier = quoteSqlIdentifier($tableName);
                $exists = (bool) $productDb->query(
                    "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = " . $productDb->quote($tableName)
                )->fetchColumn();

                if (!$exists) {
                    continue;
                }

                $stmt = $productDb->prepare("SELECT * FROM {$tableIdentifier} WHERE code = :barcode LIMIT 1");
                $stmt->execute([':barcode' => $barcode]);
                $row = $stmt->fetch();

                if (!is_array($row)) {
                    continue;
                }

                $sources[] = [
                    'dataset' => $dataset,
                    'fields' => $row,
                ];
            }

            respond(200, [
                'product' => [
                    'barcode' => (string) ($summary['barcode'] ?? ''),
                    'product_name' => (string) ($summary['product_name'] ?? ''),
                    'brands' => (string) ($summary['brands'] ?? ''),
                    'quantity' => (string) ($summary['quantity'] ?? ''),
                    'source' => (string) ($summary['source'] ?? ''),
                ],
                'sources' => $sources,
            ]);
    }
    throw new LogicException('Unsupported product API action.');
}
