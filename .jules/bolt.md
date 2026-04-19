## 2024-05-15 - [getDatabase Overhead Optimization]
**Learning:** Found that `getDatabase()` (which handles schema initialization) was unconditionally running several expensive legacy data migration loops (`migrateLegacyCategories`, `backfillLegacyCategoryKeys`, etc) and an icon-update loop on *every request*. This caused massive N+1 overhead during the connection phase.
**Action:** Always check the connection bootstrapping functions (`getDatabase()`) to ensure heavy migration scripts are guarded behind a one-time execution flag (e.g., `hasDatabaseMetaFlag`), rather than running unconditionally on every request.
## 2024-05-16 - [ensureDefaultCategories Query Optimization]
**Learning:** `ensureDefaultCategories` runs unconditionally inside `getDatabase()`, leading to $N+1$ queries evaluating whether all users possessed default categories via a PHP loop.
**Action:** When filtering records where missing dependencies need creation, push the filtering to the DB level using `WHERE NOT EXISTS (SELECT 1 ...)`. This efficiently drops steady-state overhead from an $O(n)$ PHP loop to an $O(1)$ fast SQL query.
