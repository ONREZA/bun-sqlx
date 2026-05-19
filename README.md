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
- **Linear migrations** with hash tampering detection.
- **Runtime `migrate()`** with PostgreSQL advisory lock, safe for multi-replica startup.
- **Offline cache** committed to your repo. CI verifies via `prepare --check` without a database.
- **Watch mode**: ~15ms incremental re-prepare on file change.

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
import { sql } from "bun-sqlx";

const rows = await sql(`SELECT id FROM users WHERE name = $1`, "alice");
//                      ^ literal — checked at compile time
```

Unknown queries, wrong parameter types, and dynamic strings are compile errors. For genuinely dynamic SQL, use `unsafe`.

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

Low-level access to the underlying `Bun.SQL` instance, in case you need to manage the connection or use transactions directly.

## CLI

```
bun-sqlx prepare [--check | --watch] [--root <dir>]
bun-sqlx migrate run | info | revert | add <name>
```

| Flag           | Meaning                                                      |
|----------------|--------------------------------------------------------------|
| `--check`      | Offline: verify cache matches sources, no database required. |
| `--watch`      | Persistent connection, re-prepare on file change.            |
| `--root <dir>` | Source/cache/migrations root (default: cwd).                 |

`DATABASE_URL` must be set for any command that touches the database.

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

## How nullability is inferred

A result column is non-null if **all** of the following hold:

1. The source column has a `NOT NULL` constraint (looked up via `pg_attribute`).
2. The source table isn't on the nullable side of an outer join.
3. Any wrapping expression is null-preserving — `COALESCE` with a non-null fallback, `CASE` with `ELSE`, `COUNT(*)`, `length(non_null)`, etc.

A column that doesn't satisfy the above is `T | null`. You can override:

- `SELECT id AS "id!"` → force non-null.
- `SELECT id AS "id?"` → force nullable.
- `WHERE col IS NOT NULL` / `WHERE col = ...` / `WHERE col IN (...)` → narrows `col` to non-null in the result.

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

See [ROADMAP.md](./ROADMAP.md) for what's planned.

## License

MIT.
