<?php
declare(strict_types=1);

/** SQLite transactions with savepoints for use cases inside an API operation. */
final class TransactionalPDO extends PDO
{
    private int $depth = 0;
    private array $afterCommit = [];

    public function beginTransaction(): bool
    {
        // Application transactions mutate state. Acquire the writer lock before
        // any use-case SELECT instead of upgrading a possibly stale WAL snapshot.
        $this->exec('BEGIN IMMEDIATE');
        return true;
    }

    public function commit(): bool
    {
        $this->exec('COMMIT');
        return true;
    }

    public function rollBack(): bool
    {
        $this->exec('ROLLBACK');
        return true;
    }

    public function inTransaction(): bool
    {
        return $this->depth > 0;
    }

    public function transactionDepth(): int
    {
        return $this->depth;
    }

    public function afterCommit(callable $callback): void
    {
        if ($this->depth === 0) {
            $callback();
            return;
        }
        $this->afterCommit[] = [$this->depth, $callback];
    }

    public function rollBackAll(): void
    {
        if ($this->depth > 0) {
            parent::exec('ROLLBACK');
            $this->depth = 0;
            $this->afterCommit = [];
        }
    }

    public function exec(string $statement): int|false
    {
        $command = strtoupper(trim($statement, " \t\n\r;"));
        if (in_array($command, ['BEGIN', 'BEGIN IMMEDIATE', 'BEGIN TRANSACTION'], true)) {
            $result = parent::exec($this->depth === 0 ? $statement : 'SAVEPOINT app_scope_' . $this->depth);
            $this->depth++;
            return $result;
        }
        if ($command === 'COMMIT' || $command === 'ROLLBACK') {
            if ($this->depth === 0) throw new PDOException('There is no active transaction');
            $level = $this->depth - 1;
            if ($level === 0) {
                $result = parent::exec($command);
            } elseif ($command === 'COMMIT') {
                $result = parent::exec('RELEASE SAVEPOINT app_scope_' . $level);
            } else {
                parent::exec('ROLLBACK TO SAVEPOINT app_scope_' . $level);
                $result = parent::exec('RELEASE SAVEPOINT app_scope_' . $level);
            }
            $this->depth = $level;
            if ($command === 'ROLLBACK') {
                $this->afterCommit = array_values(array_filter($this->afterCommit, static fn(array $entry): bool => $entry[0] <= $level));
            } else {
                foreach ($this->afterCommit as &$entry) $entry[0] = min($entry[0], $level);
                unset($entry);
            }
            if ($level === 0) {
                $callbacks = $this->afterCommit;
                $this->afterCommit = [];
                foreach ($callbacks as [, $callback]) {
                    try { $callback(); }
                    catch (Throwable $error) { error_log('Post-commit cleanup failed: ' . $error->getMessage()); }
                }
            }
            return $result;
        }
        return parent::exec($statement);
    }
}
