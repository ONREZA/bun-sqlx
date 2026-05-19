# bun-sqlx

Compile-time-checked raw SQL for Bun + PostgreSQL. Inspired by Rust's [sqlx](https://github.com/launchbadge/sqlx).

You write plain SQL strings. A `prepare` step validates them against your database via the PostgreSQL wire protocol and generates a TypeScript declaration file. Wrong column names, mismatched parameter types, stale queries after a migration — all become compile errors.

```ts
import { sql } from "bun-sqlx";

const rows = await sql(
  `SELECT id, name, role FROM users WHERE id = $1`,
  1n,
);
//      ^ bigint
//
// rows: { id: bigint; name: string; role: "admin" | "editor" | "viewer" }[]
```

## Features

- **Compile-time validation** against a live PostgreSQL via `Parse` + `Describe Statement` (no query execution).
- **Precise nullability inference** through `libpg-query`: `JOIN` direction (LEFT/RIGHT/FULL), `COALESCE`, `CASE`, `COUNT`, expression propagation.
- **WHERE narrowing**: `IS NOT NULL`, equality, `IN`, `LIKE`, `BETWEEN` make columns non-null. Tracks `AND`/`OR` semantics.
- **PostgreSQL enums** generated as TypeScript literal unions (read + write side).
- **Schema-aware `jsonb`** via a `BunSqlxJson` global namespace and a config-driven column → type mapping. Works for both result columns and `INSERT`/`UPDATE`/`WHERE` parameters.
- **Extension types out of the box**: `pgvector` (`vector`, `halfvec`, `sparsevec`), `hstore`, `citext`, `ltree`/`lquery`/`ltxtquery`. Add your own through `customTypes` config.
- **Domains** resolve to their base TypeScript type (`CREATE DOMAIN email AS text` → `string`), including domains over extension types or other domains.
- **Wide built-in type coverage**: numeric, text, date/time, UUID, json/jsonb, network (inet/cidr/macaddr/macaddr8), bit strings, ranges/multiranges, geometric, money, tsvector/tsquery, xml — and the matching array variants.
- **External SQL files** via `sql.file("queries/foo.sql", ...)` — typed exactly like inline queries.
- **Typed transactions** via `sql.transaction(async tx => …)` — the `tx` callback parameter is recognized by the scanner, so queries inside the block keep full type checking.
- **Sourcemap-accurate error reporting**: every prepare failure points to `file:line:column` of the originating `sql(...)` call site, with PG error code, position, and hint.
- **Linear migrations** with hash tampering detection.
- **Runtime `migrate()`** with PostgreSQL advisory lock, safe for multi-replica startup.
- **Offline cache** committed to your repo. CI verifies via `prepare --check` without a database.
- **Watch mode**: ~15ms incremental re-prepare on file change.
- **Cache pruning** removes orphaned entries automatically (toggleable with `--no-prune`).

## Install

```bash
bun add bun-sqlx
```

## Setup

### 1. Configure the database URL

```bash
# .env
DATABASE_URL=postgres://user:password@localhost:5432/your_db
```

### 2. Create a migration

```bash
bunx bun-sqlx migrate add init
```

Edit the created file (`migrations/0001_init.up.sql`):

```sql
CREATE TABLE users (
  id    BIGSERIAL PRIMARY KEY,
  name  TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  age   INT,
  bio   TEXT
);
```

Apply:

```bash
bunx bun-sqlx migrate run
```

### 3. Write your first query

```ts
// app.ts
import { sql } from "bun-sqlx";

const users = await sql(
  `SELECT id, name FROM users WHERE id = $1`,
  1n,
);
```

### 4. Prepare types

```bash
bunx bun-sqlx prepare
```

This generates `bun-sqlx.d.ts` next to your code. Add it to your `tsconfig.json` `include` if it isn't picked up automatically.

### 5. Dev loop with watch

```bash
bunx bun-sqlx prepare --watch
```

Save a `.ts` file, types regenerate in milliseconds, your editor picks up changes.

## API

### `sql(query, ...params)`

The typed query function. The first argument must be a string literal that exists in `KnownQueries` (populated by `prepare`).

```ts
const rows = await sql(`SELECT id FROM users WHERE name = $1`, "alice");
//                      ^ literal — checked at compile time
```

Unknown queries, wrong parameter types, and dynamic strings are compile errors. For genuinely dynamic SQL, use `unsafe`.

### `sql.file(path, ...params)`

Load SQL from an external file. The path is resolved against the source file at scan time (so `prepare` can read it), and against `process.cwd()` at runtime (so the running process can read it). Both must point at the same content.

```ts
// queries/top_admins.sql
// SELECT id AS "id!", name AS "name!" FROM users WHERE role = $1 ORDER BY id LIMIT $2::int

import { sql } from "bun-sqlx";

const admins = await sql.file("queries/top_admins.sql", "admin", 5);
//                                                       ^ string  ^ number
// admins: { id: bigint; name: string }[]
```

File-backed queries are emitted into a separate `KnownFileQueries` interface; the path becomes the type key.

### `sql.transaction(fn)`

Wrap a function body in a database transaction. The callback receives a scoped `tx` that has the same typed `()` and `.file()` surface, but routes through the transaction's dedicated connection. The scanner recognises the callback parameter name and validates inner queries against `KnownQueries`.

```ts
import { sql } from "bun-sqlx";

const { userId, postId } = await sql.transaction(async (tx) => {
  const u = await tx(
    `INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id AS "id!"`,
    "Alice", "alice@example.com",
  );
  const p = await tx(
    `INSERT INTO posts (user_id, title) VALUES ($1, $2) RETURNING id AS "id!"`,
    u[0].id, "Hello",
  );
  return { userId: u[0].id, postId: p[0].id };
});
```

If the callback throws, the transaction is rolled back. The return value of the callback becomes the return value of `transaction`.

### `unsafe(query, ...params)`

Same runtime as `sql` but without type-checking. For dynamic SQL where compile-time validation isn't possible.

### `migrate(options)`

Apply pending migrations from application startup with a PostgreSQL advisory lock. Safe to call from multiple replicas.

```ts
import { migrate } from "bun-sqlx";

await migrate({ dir: "./migrations" });
```

Options: `{ dir?: string; databaseUrl?: string; log?: (msg) => void }`.

### `getClient()` / `setClient()` / `close()`

Low-level access to the underlying `Bun.SQL` instance, in case you need to manage the connection directly.

### `clearSqlFileCache()`

Drops the in-memory cache used by `sql.file(...)`. Call this if you reload `.sql` files at runtime (rare; useful in tests).

## CLI

```
bun-sqlx prepare [--check | --watch] [--root <dir>] [--no-prune]
bun-sqlx migrate run | info | revert | add <name>
```

| Flag           | Meaning                                                      |
|----------------|--------------------------------------------------------------|
| `--check`      | Offline: verify cache matches sources, no database required. |
| `--watch`      | Persistent connection, re-prepare on file change.            |
| `--root <dir>` | Source/cache/migrations root (default: cwd).                 |
| `--no-prune`   | Keep orphaned cache entries instead of removing them.        |

`DATABASE_URL` must be set for any command that touches the database.

### Error output

When `prepare` fails, every diagnostic points back to the originating call site:

```
✗ src/users.ts:42:13 — describe failed: relation "userss" does not exist (pos 15, code 42P01)
    query: SELECT * FROM userss WHERE id = $1
```

Phases reported separately: `describe failed`, `analyze failed`, `paramMap failed`. PostgreSQL `position`, `code`, and `hint` are surfaced when present.

## Configuration

`bun-sqlx.config.ts` at the project root is optional.

```ts
import type { BunSqlxConfig } from "bun-sqlx";

const config: BunSqlxConfig = {
  jsonbTypes: {
    "users.settings":     "BunSqlxJson.UserSettings",
    "posts.meta":         "BunSqlxJson.PostMeta",
    "posts.attachments":  "BunSqlxJson.Attachment",
  },
};

export default config;
```

Declare the referenced types anywhere in your project (`.d.ts` file is conventional):

```ts
// json-types.d.ts
declare global {
  namespace BunSqlxJson {
    type UserSettings = {
      theme: "light" | "dark";
      lang: string;
      notifications?: { email: boolean; push: boolean };
    };
    type PostMeta = { tags?: string[]; pinned?: boolean };
    type Attachment = { url: string; kind: "image" | "video" | "file"; sizeBytes: number };
  }
}
export {};
```

After re-running `prepare`, every `jsonb` column or parameter declared in `jsonbTypes` is checked against the corresponding TypeScript type.

### Extension types and `customTypes`

bun-sqlx ships with a built-in registry that resolves popular PostgreSQL extension types automatically:

| `pg_type.typname` | TS type                            | Source extension |
|-------------------|------------------------------------|-------------------|
| `vector`          | `number[]`                         | pgvector          |
| `halfvec`         | `number[]`                         | pgvector          |
| `sparsevec`       | `string`                           | pgvector          |
| `hstore`          | `Record<string, string \| null>`   | hstore            |
| `citext`          | `string`                           | citext            |
| `ltree`           | `string`                           | ltree             |
| `lquery`          | `string`                           | ltree             |
| `ltxtquery`       | `string`                           | ltree             |

Add or override mappings via `customTypes` in `bun-sqlx.config.ts`. Keys are `pg_type.typname` values (the bare type name; namespacing isn't required):

```ts
import type { BunSqlxConfig } from "bun-sqlx";

const config: BunSqlxConfig = {
  customTypes: {
    vector: "Float32Array",         // override pgvector default
    geometry: "GeoJSON.Geometry",   // postgis (not built-in by design)
    myapp_color: "`#${string}`",    // your own CREATE TYPE base/domain
  },
};
export default config;
```

Domains resolve to their base type through `pg_type.typbasetype`. `CREATE DOMAIN positive_int AS integer CHECK (VALUE > 0)` → `number`, `CREATE DOMAIN tagged AS hstore` → `Record<string, string | null>`. Array variants of any registered scalar are also wired up automatically — `vector[]` → `(number[])[]`.

Composite types (`CREATE TYPE foo AS (a int, b text)`) still resolve to `unknown`; see ROADMAP.

## How nullability is inferred

A result column is non-null if **all** of the following hold:

1. The source column has a `NOT NULL` constraint (looked up via `pg_attribute`).
2. The source table isn't on the nullable side of an outer join.
3. Any wrapping expression is null-preserving — `COALESCE` with a non-null fallback, `CASE` with `ELSE`, `COUNT(*)`, `length(non_null)`, etc.

A column that doesn't satisfy the above is `T | null`. You can override:

- `SELECT id AS "id!"` → force non-null.
- `SELECT id AS "id?"` → force nullable.
- `WHERE col IS NOT NULL` / `WHERE col = …` / `WHERE col IN (…)` → narrows `col` to non-null in the result.

The runtime strips the `!`/`?` suffix from column keys so the row shape stays clean: `{ id: bigint }`, not `{ "id!": bigint }`.

## CI workflow

Commit the generated `bun-sqlx.d.ts` and the `.bun-sqlx/` cache directory to your repo. In CI:

```yaml
- run: bun install
- run: bun-sqlx prepare --check   # fails if any query is missing from cache
- run: tsc --noEmit               # fails if types are stale
- run: bun test
```

The `--check` step runs without a database — your offline cache is the source of truth.

## Contributing

The project uses [conventional commits](https://www.conventionalcommits.org/), validated locally by `cocogitto` through `lefthook` hooks. Install both before contributing:

```bash
bun install                  # installs lefthook + wires git hooks
cargo install cocogitto      # or: brew install cocogitto
```

Releases are automated via `release-please`: pushes to `main` accumulate into a release PR that bumps `package.json`, writes `CHANGELOG.md`, and on merge tags the commit. The tag push fires the npm publish workflow.

## Limitations

`bun-sqlx` is a young library. Known gaps:

- PostgreSQL only (no MySQL or SQLite).
- `INSERT INTO t VALUES (...)` without an explicit column list isn't parameter-mapped.
- `SELECT *` falls back to conservative nullability.
- `RETURNING` clauses on `INSERT`/`UPDATE`/`DELETE` use the basic nullability path (no `WHERE` narrowing yet). Use `AS "id!"` aliases.
- Composite and domain types resolve to `unknown`. Use `CAST` or alias-based typing.
- `sql.file(path)` path is matched literally between scan time and runtime — they must agree on the working directory. Document a convention for your team (e.g. always run from the repo root).

See [ROADMAP.md](./ROADMAP.md) for what's planned.

## License

MIT.
