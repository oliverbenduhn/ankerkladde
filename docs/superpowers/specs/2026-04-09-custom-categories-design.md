# Custom Categories — Design Spec

**Date:** 2026-04-09  
**Status:** Proposed

## Problem / Context

The app currently has eight hard-coded categories:

- `shopping`
- `meds`
- `todo_private`
- `todo_work`
- `notes`
- `images`
- `files`
- `links`

These categories are embedded in the database assumptions, API validation, frontend rendering, settings persistence, and HTML tab markup. Adding a new category currently requires a code change and deploy.

The goal is to let each user create additional categories by:

1. choosing one of the existing structural types
2. giving the category a custom name

Examples:

- `Supermarkt` of type `list_quantity`
- `Kunden` of type `list_due_date`
- `Rezepte` of type `notes`

The internal data shape should stay constrained and predictable. Users should not define arbitrary schemas.

---

## Summary of Decisions

| Question | Decision |
|---|---|
| Free-form schemas? | No |
| Internal category types | Fixed set |
| Category names | User-defined |
| Ownership | Per-user |
| Item relation | `items.category_id` |
| Existing `items.section` | Transitional only, removed later |
| Category ordering | Stored per category via `sort_order` |
| Category visibility | Stored per category via `is_hidden` |
| Last active category | Stored in user preferences as `last_category_id` |

---

## 1. Internal Category Types

These replace today's implicit hard-coded section behavior:

| Type | Behavior |
|---|---|
| `list_quantity` | Name + quantity |
| `list_due_date` | Name + due date |
| `notes` | Name + rich text content |
| `images` | Name + image upload |
| `files` | Name + file upload |
| `links` | URL-like name, rendered as link |

These types are fixed in code and should be treated as product-level primitives, not user-editable values.

---

## 2. New Database Model

### New table: `categories`

```sql
CREATE TABLE categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    type        TEXT    NOT NULL CHECK(type IN (
        'list_quantity',
        'list_due_date',
        'notes',
        'images',
        'files',
        'links'
    )),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_hidden   INTEGER NOT NULL DEFAULT 0 CHECK(is_hidden IN (0, 1)),
    created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
)
```

Indexes:

```sql
CREATE INDEX idx_categories_user_id ON categories(user_id);
CREATE INDEX idx_categories_user_sort ON categories(user_id, sort_order);
```

### New column: `items.category_id`

```sql
ALTER TABLE items ADD COLUMN category_id INTEGER REFERENCES categories(id)
```

Target state:

- all item reads and writes use `category_id`
- `section` becomes obsolete and is removed in a later cleanup migration

---

## 3. Mapping Existing Categories

The existing hard-coded categories map to the new internal types like this:

| Old key | Default label | New type |
|---|---|---|
| `shopping` | Einkauf | `list_quantity` |
| `meds` | Medizin | `list_quantity` |
| `todo_private` | Privat | `list_due_date` |
| `todo_work` | Arbeit | `list_due_date` |
| `notes` | Notizen | `notes` |
| `images` | Bilder | `images` |
| `files` | Dateien | `files` |
| `links` | Links | `links` |

During migration, each user receives one `categories` row for each of the above legacy categories. Existing items are then assigned to the matching per-user category.

---

## 4. Migration Strategy

### Phase 1: Additive migration

In `db.php::getDatabase()`:

1. create `categories`
2. add `items.category_id`
3. create legacy default categories for every existing user
4. update all existing items by matching:
   - `items.user_id`
   - `items.section`
   - legacy category map above
5. keep `items.section` in place temporarily

Pseudo-SQL:

```sql
UPDATE items
SET category_id = (
    SELECT c.id
    FROM categories c
    WHERE c.user_id = items.user_id
      AND c.name = <mapped legacy name>
    LIMIT 1
)
WHERE category_id IS NULL
```

### Phase 2: Dual-read / dual-write transition

Backend can temporarily:

- prefer `category_id`
- fall back to `section` only for not-yet-migrated rows if needed

This phase should be kept short to reduce complexity.

### Phase 3: Cleanup

After frontend and API fully use categories:

- remove legacy `section` validation assumptions
- stop using `section` for rendering logic
- optionally remove `items.section` in a later schema rewrite

---

## 5. Backend Changes

### Replace `VALID_SECTIONS`

Today the API validates against a fixed list. This must be replaced by per-user category lookup.

Instead of:

```php
const VALID_SECTIONS = [...]
```

use helpers such as:

```php
loadUserCategory(PDO $db, int $userId, int $categoryId): array
loadUserCategories(PDO $db, int $userId): array
```

### API changes

New category endpoints:

| Action | Method | Purpose |
|---|---|---|
| `categories_list` | GET | Return all categories for the current user |
| `categories_create` | POST | Create a category from a fixed type + custom name |
| `categories_update` | POST | Rename, hide/unhide |
| `categories_reorder` | POST | Persist tab order |
| `categories_delete` | POST | Delete category if allowed |

Existing item endpoints change from `section` to `category_id`:

| Existing action | Change |
|---|---|
| `list` | require `category_id`, join category |
| `add` | insert using category-derived type |
| `upload` | validate against category type |
| `update` | load category type for item |
| `clear` | clear within `category_id` |
| `reorder` | reorder within `category_id` |
| `search` | return `category_id`, category name, category type |

### Behavior should be driven by `category.type`

Examples:

- `list_quantity` behaves like today's `shopping` / `meds`
- `list_due_date` behaves like today's `todo_private` / `todo_work`
- `images` / `files` determine upload handling
- `links` determines link rendering

Do not keep branching on legacy names.

---

## 6. Frontend Changes

### Remove hard-coded sections

Today the app uses a fixed `SECTIONS` object and hard-coded tab markup. This must become dynamic.

Target approach:

1. `index.php` renders an empty categories container
2. `app.js` loads categories from the API during init
3. tabs are rendered from returned category data
4. current category is tracked by `category_id`
5. titles, placeholders, and item rendering are driven by `category.type`

### New frontend state

Example shape:

```js
state.categories = []
state.categoryId = null
```

Each category returned by the API should include:

```json
{
  "id": 12,
  "name": "Supermarkt",
  "type": "list_quantity",
  "sort_order": 1,
  "is_hidden": 0
}
```

### Rendering rules

Frontend logic must move from:

```js
if (state.section === 'notes') { ... }
```

to:

```js
if (currentCategory.type === 'notes') { ... }
```

This affects:

- tab rendering
- form placeholders
- quantity/date field switching
- upload section logic
- item card rendering
- note editor routing
- search result category labels

---

## 7. Settings / Category Management UI

`settings.php` should eventually allow:

- create category
- choose type
- set custom name
- rename category
- hide/unhide category
- reorder categories
- delete category

### Create flow

Fields:

- category name
- category type select

Example type labels:

- Liste mit Menge
- Liste mit Datum
- Notizen
- Bilder
- Dateien
- Links

### Delete rules

Initial rule should be conservative:

- category can only be deleted if empty

Later extension:

- delete after moving items into another category

---

## 8. User Preferences Changes

Current preferences are based on legacy string keys such as `shopping` and `notes`. This must move to category-aware values.

Replace with:

| Current concept | New storage |
|---|---|
| last active section | `last_category_id` |
| hidden sections | stored on `categories.is_hidden` |
| tab order | stored on `categories.sort_order` |
| tabs hidden | user preference boolean |
| mode | user preference enum |
| install banner dismissed | user preference boolean |

Recommendation:

- move visibility and order fully into `categories`
- keep only user-global UI values in `users.preferences_json`

That means `users.preferences_json` should eventually contain values like:

```json
{
  "mode": "liste",
  "tabs_hidden": false,
  "last_category_id": 12,
  "install_banner_dismissed": true
}
```

---

## 9. Files Most Affected

| File | Required change |
|---|---|
| `db.php` | categories migration, item migration, new helpers |
| `public/api.php` | category-based validation and CRUD |
| `public/app.js` | dynamic categories, `category_id` state, type-based rendering |
| `public/index.php` | remove hard-coded tabs, provide bootstrap data only |
| `public/settings.php` | category management UI |
| `public/media.php` | no structural change except continuing ownership checks |

---

## 10. Recommended Implementation Order

1. Add `categories` table and `items.category_id`
2. Migrate legacy categories per user
3. Add backend category helpers and category endpoints
4. Change item endpoints to work with `category_id`
5. Refactor frontend to load and render categories dynamically
6. Move preferences from section keys to category-aware storage
7. Add category creation and editing UI in settings
8. Remove legacy `section` dependencies

---

## 11. Guardrails

- Keep category types fixed in code
- Do not support arbitrary user-defined fields
- Prefer `category_id` over string names everywhere
- Avoid long-term dual support for both `section` and `category_id`
- Keep category ownership strictly per user
- Preserve current attachment and note behaviors by mapping them to category type

---

## 12. Verification Checklist

1. Existing users receive default migrated categories
2. Existing items appear under the correct migrated categories
3. New category can be created with custom name and fixed type
4. A `list_quantity` custom category behaves like Einkauf/Medizin
5. A `list_due_date` custom category behaves like Arbeit/Privat
6. Notes, images, files, and links still render correctly through type-driven logic
7. Category hiding and ordering persist correctly
8. Last active category restores correctly after reload
9. Search results open the correct custom category
10. Smoke test and migration test still pass after the refactor
