<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/TransactionalPDO.php';

function check(bool $value, string $message): void
{
    if (!$value) throw new RuntimeException($message);
}

$file = tempnam(sys_get_temp_dir(), 'anker-atomic-');
try {
    $db = new TransactionalPDO('sqlite:' . $file);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->exec('CREATE TABLE operations (value TEXT)');
    $observer = new PDO('sqlite:' . $file);
    $db->exec('BEGIN IMMEDIATE');
    $db->beginTransaction();
    $db->exec("INSERT INTO operations VALUES ('mutation')");
    $ran = false;
    $db->afterCommit(function () use (&$ran): void { $ran = true; });
    $db->commit();
    check(!$ran, 'Nested commit must not run file cleanup.');
    check((int) $observer->query('SELECT count(*) FROM operations')->fetchColumn() === 0, 'Nested commit must stay invisible.');
    $db->rollBackAll();
    check(!$ran, 'Rollback must discard cleanup.');
    check((int) $observer->query('SELECT count(*) FROM operations')->fetchColumn() === 0, 'Mutation must roll back.');

    $db->beginTransaction();
    $db->exec('BEGIN IMMEDIATE');
    $db->exec("INSERT INTO operations VALUES ('discarded')");
    $db->rollBack();
    $db->exec("INSERT INTO operations VALUES ('committed')");
    $db->afterCommit(function () use (&$ran): void { $ran = true; });
    $db->commit();
    check($ran, 'Cleanup must run after the outer commit.');
    check($observer->query('SELECT value FROM operations')->fetchAll(PDO::FETCH_COLUMN) === ['committed'], 'Savepoint rollback must preserve the outer operation.');

    // Abrupt worker exit between mutation and response: SQLite rolls back both.
    $source = 'require ' . var_export(dirname(__DIR__) . '/src/TransactionalPDO.php', true) . ';'
        . '$db = new TransactionalPDO(' . var_export('sqlite:' . $file, true) . ');'
        . '$db->exec("BEGIN IMMEDIATE"); $db->exec("INSERT INTO operations VALUES (\"crashed\")"); exit(23);';
    $process = proc_open([PHP_BINARY, '-r', $source], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    foreach ($pipes as $pipe) fclose($pipe);
    check(proc_close($process) === 23, 'Crash simulation must exit at the intended point.');
    check((int) $observer->query('SELECT count(*) FROM operations')->fetchColumn() === 1, 'Worker exit must not persist an unfinished operation.');
    echo "Transaction and crash recovery tests passed.\n";
} finally {
    unset($db, $observer);
    unlink($file);
}
