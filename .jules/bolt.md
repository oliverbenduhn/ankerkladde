## 2024-05-15 - [getDatabase Overhead Optimization]
**Learning:** Found that `getDatabase()` (which handles schema initialization) was unconditionally running several expensive legacy data migration loops (`migrateLegacyCategories`, `backfillLegacyCategoryKeys`, etc) and an icon-update loop on *every request*. This caused massive N+1 overhead during the connection phase.
**Action:** Always check the connection bootstrapping functions (`getDatabase()`) to ensure heavy migration scripts are guarded behind a one-time execution flag (e.g., `hasDatabaseMetaFlag`), rather than running unconditionally on every request.
## 2024-05-16 - [ensureDefaultCategories Global Check Overhead]
**Learning:** Found that `ensureDefaultCategories($db)` was running unconditionally inside `getDatabase()` on every request, creating massive overhead for large userbases.
**Action:** Always verify if a global data initialization or check function in connection bootstrapping can be guarded behind a one-time execution flag (e.g. `hasDatabaseMetaFlag`) and its workload shifted to specific targeted events (e.g., executing `createDefaultCategoriesForUser` during new user creation).
