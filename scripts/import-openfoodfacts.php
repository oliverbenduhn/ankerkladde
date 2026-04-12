<?php
declare(strict_types=1);

require dirname(__DIR__) . '/db.php';

const REQUIRED_COLUMNS = ['code', 'product_name', 'brands', 'quantity'];
const IMPORT_BATCH_SIZE = 5000;
const VALID_DATASETS = ['food', 'beauty', 'petfood', 'products'];

function normalizeCatalogValue(?string $value, int $maxLength): string
{
    $value = trim((string) $value);
    $value = preg_replace('/\s+/u', ' ', $value) ?? '';

    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $maxLength);
    }

    return substr($value, 0, $maxLength);
}

function openSource(string $path)
{
    $handle = gzopen($path, 'rb');
    if ($handle === false) {
        throw new RuntimeException(sprintf('Datei konnte nicht geöffnet werden: %s', $path));
    }

    return $handle;
}

function readTsvRow($handle): ?array
{
    $line = gzgets($handle);
    if ($line === false) {
        return null;
    }

    $line = rtrim($line, "\r\n");
    return str_getcsv($line, "\t");
}

function parseArguments(array $argv): array
{
    $result = [
        'truncate' => false,
        'dataset' => 'food',
        'path' => getDataDirectory() . '/openfoodfacts/en.openfoodfacts.org.products.csv.gz',
    ];

    foreach (array_slice($argv, 1) as $argument) {
        if ($argument === '--truncate') {
            $result['truncate'] = true;
            continue;
        }

        if (str_starts_with($argument, '--dataset=')) {
            $dataset = substr($argument, strlen('--dataset='));
            if (!in_array($dataset, VALID_DATASETS, true)) {
                throw new InvalidArgumentException('Ungültiges Dataset. Erlaubt: ' . implode(', ', VALID_DATASETS));
            }
            $result['dataset'] = $dataset;
            continue;
        }

        $result['path'] = $argument;
    }

    return $result;
}

function quoteIdentifier(string $identifier): string
{
    return '"' . str_replace('"', '""', $identifier) . '"';
}

function datasetTableName(string $dataset): string
{
    return 'product_catalog_' . $dataset;
}

function ensureDatasetTable(PDO $db, string $tableName, array $header): void
{
    $tableIdentifier = quoteIdentifier($tableName);
    $exists = (bool) $db->query(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = " . $db->quote($tableName)
    )->fetchColumn();

    if (!$exists) {
        $columnsSql = [];
        foreach ($header as $columnName) {
            $name = (string) $columnName;
            if ($name === 'code') {
                $columnsSql[] = quoteIdentifier($name) . ' TEXT PRIMARY KEY';
                continue;
            }

            $columnsSql[] = quoteIdentifier($name) . " TEXT NOT NULL DEFAULT ''";
        }

        $db->exec("CREATE TABLE {$tableIdentifier} (" . implode(', ', $columnsSql) . ")");
        return;
    }

    $existingColumns = $db->query("PRAGMA table_info({$tableIdentifier})")->fetchAll();
    $existingColumnNames = array_map(static fn(array $column): string => (string) $column['name'], $existingColumns);

    foreach ($header as $columnName) {
        $name = (string) $columnName;
        if (in_array($name, $existingColumnNames, true)) {
            continue;
        }

        $db->exec("ALTER TABLE {$tableIdentifier} ADD COLUMN " . quoteIdentifier($name) . " TEXT NOT NULL DEFAULT ''");
    }
}

function buildNormalizedRow(array $header, array $row): array
{
    $normalized = [];

    foreach ($header as $index => $columnName) {
        $normalized[(string) $columnName] = (string) ($row[$index] ?? '');
    }

    return $normalized;
}

function buildInsertStatement(PDO $db, string $tableName, array $header): array
{
    $quotedColumns = array_map(static fn(string $name): string => quoteIdentifier($name), $header);
    $paramMap = [];
    $placeholders = [];
    foreach ($header as $index => $name) {
        $placeholder = ':p' . $index;
        $paramMap[$name] = $placeholder;
        $placeholders[] = $placeholder;
    }
    $assignments = [];

    foreach ($header as $columnName) {
        if ($columnName === 'code') {
            continue;
        }
        $assignments[] = quoteIdentifier($columnName) . ' = excluded.' . quoteIdentifier($columnName);
    }

    $sql = sprintf(
        'INSERT INTO %s (%s) VALUES (%s) ON CONFLICT("code") DO UPDATE SET %s',
        quoteIdentifier($tableName),
        implode(', ', $quotedColumns),
        implode(', ', $placeholders),
        implode(', ', $assignments)
    );

    return [$db->prepare($sql), $paramMap];
}

$options = parseArguments($argv);
$sourcePath = $options['path'];
$dataset = $options['dataset'];
$tableName = datasetTableName($dataset);

if (!is_string($sourcePath) || $sourcePath === '' || !is_file($sourcePath)) {
    fwrite(STDERR, "Quelle nicht gefunden: {$sourcePath}\n");
    exit(1);
}

$handle = openSource($sourcePath);
$header = readTsvRow($handle);
if (!is_array($header) || $header === []) {
    gzclose($handle);
    fwrite(STDERR, "Header konnte nicht gelesen werden.\n");
    exit(1);
}

$header = array_map(static fn($value): string => (string) $value, $header);
$columnIndex = [];
foreach ($header as $index => $name) {
    $columnIndex[$name] = (int) $index;
}

foreach (REQUIRED_COLUMNS as $columnName) {
    if (!array_key_exists($columnName, $columnIndex)) {
        gzclose($handle);
        fwrite(STDERR, "Pflichtspalte fehlt: {$columnName}\n");
        exit(1);
    }
}

$db = getDatabase();
$db->exec('PRAGMA journal_mode = WAL');
$db->exec('PRAGMA synchronous = NORMAL');
$db->exec('PRAGMA temp_store = MEMORY');

ensureDatasetTable($db, $tableName, $header);
[$sourceStmt, $paramMap] = buildInsertStatement($db, $tableName, $header);
$summaryStmt = $db->prepare(
    "INSERT INTO product_catalog (barcode, product_name, brands, quantity, source, updated_at)
     VALUES (:barcode, :product_name, :brands, :quantity, :source, CURRENT_TIMESTAMP)
     ON CONFLICT(barcode) DO UPDATE SET
         product_name = CASE
             WHEN excluded.product_name <> '' THEN excluded.product_name
             ELSE product_catalog.product_name
         END,
         brands = CASE
             WHEN excluded.brands <> '' THEN excluded.brands
             ELSE product_catalog.brands
         END,
         quantity = CASE
             WHEN excluded.quantity <> '' THEN excluded.quantity
             ELSE product_catalog.quantity
         END,
         source = CASE
             WHEN excluded.source = '' THEN product_catalog.source
             WHEN product_catalog.source = '' THEN excluded.source
             WHEN instr(',' || product_catalog.source || ',', ',' || excluded.source || ',') > 0 THEN product_catalog.source
             ELSE product_catalog.source || ',' || excluded.source
         END,
         updated_at = CURRENT_TIMESTAMP"
);

$db->beginTransaction();

if ($options['truncate']) {
    $db->exec('DELETE FROM product_catalog');
    foreach (VALID_DATASETS as $knownDataset) {
        $knownTable = datasetTableName($knownDataset);
        $exists = (bool) $db->query(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = " . $db->quote($knownTable)
        )->fetchColumn();
        if ($exists) {
            $db->exec('DELETE FROM ' . quoteIdentifier($knownTable));
        }
    }
} else {
    $db->exec('DELETE FROM ' . quoteIdentifier($tableName));
}

$imported = 0;
$skipped = 0;

while (($row = readTsvRow($handle)) !== null) {
    $normalizedRow = buildNormalizedRow($header, $row);
    $barcode = preg_replace('/\D+/', '', (string) ($normalizedRow['code'] ?? '')) ?? '';
    if ($barcode === '') {
        $skipped++;
        continue;
    }

    $normalizedRow['code'] = $barcode;
    $productName = normalizeCatalogValue($normalizedRow['product_name'] ?? '', 255);
    $brands = normalizeCatalogValue($normalizedRow['brands'] ?? '', 255);
    $quantity = normalizeCatalogValue($normalizedRow['quantity'] ?? '', 80);

    if ($productName === '' && $brands === '') {
        $skipped++;
        continue;
    }

    $sourceParams = [];
    foreach ($paramMap as $columnName => $placeholder) {
        $sourceParams[$placeholder] = (string) ($normalizedRow[$columnName] ?? '');
    }

    $sourceStmt->execute($sourceParams);
    $summaryStmt->execute([
        ':barcode' => $barcode,
        ':product_name' => $productName,
        ':brands' => $brands,
        ':quantity' => $quantity,
        ':source' => $dataset,
    ]);

    $imported++;

    if (($imported % IMPORT_BATCH_SIZE) === 0) {
        $db->commit();
        $db->beginTransaction();
        fwrite(STDOUT, "[{$dataset}] Importiert: {$imported}\n");
    }
}

$db->commit();
gzclose($handle);

fwrite(STDOUT, "[{$dataset}] Fertig. Importiert: {$imported}, übersprungen: {$skipped}\n");
