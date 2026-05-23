---
title: "sql API"
description: "Reference for the typed sql callable, file-backed queries, transactions, and the exact public signatures exported by bun-sqlx."
---

The `sql` export is the main application API. It is declared in `src/index.ts` and implemented by the runtime callable in `src/runtime.ts`.

## Import Path

```ts
import { sql } from "bun-sqlx";
```

## Public Signatures

Source: `src/index.ts`

```ts
export type TypedSql = {
  <Q extends keyof KnownQueries>(
    query: Q,
    ...params: ParamsOf<KnownQueries[Q]>
  ): Promise<RowOf<KnownQueries[Q]>[]>;
  file: <P extends keyof KnownFileQueries>(
    path: P,
    ...params: ParamsOf<KnownFileQueries[P]>
  ) => Promise<RowOf<KnownFileQueries[P]>[]>;
};

export type Typed = TypedSql & {
  transaction: <R>(fn: (tx: TypedSql) => Promise<R>) => Promise<R>;
};

export const sql: Typed;
```

## `sql(query, ...params)`

Run a prepared inline SQL query whose first argument is a key in `KnownQueries`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | `Q extends keyof KnownQueries` | None | The exact SQL string literal that `prepare` scanned and emitted into `bun-sqlx.d.ts`. |
| `...params` | `ParamsOf<KnownQueries[Q]>` | None | The generated parameter tuple for that specific query. |

**Returns**

```ts
Promise<RowOf<KnownQueries[Q]>[]>
```

### Example

```ts
import { sql } from "bun-sqlx";

const users = await sql(
  `SELECT id AS "id!", name AS "name!" FROM users WHERE id = $1`,
  1n,
);

users[0]!.id;
users[0]!.name;
```

## `sql.file(path, ...params)`

Run a file-backed query whose path is a key in `KnownFileQueries`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `P extends keyof KnownFileQueries` | None | A literal path such as `"queries/get_users_by_role.sql"`. |
| `...params` | `ParamsOf<KnownFileQueries[P]>` | None | The generated parameter tuple for the SQL file. |

**Returns**

```ts
Promise<RowOf<KnownFileQueries[P]>[]>
```

### Example

```ts
import { sql } from "bun-sqlx";

const admins = await sql.file("queries/get_users_by_role.sql", "admin", 5);
```

`src/runtime.ts` caches the file contents in memory until you call `clearSqlFileCache()`.

## `sql.transaction(fn)`

Run a callback inside a database transaction using the same typed query surface.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `fn` | `(tx: TypedSql) => Promise<R>` | None | Async callback that receives a transaction-scoped typed query function. |

**Returns**

```ts
Promise<R>
```

### Example

```ts
import { sql } from "bun-sqlx";

const result = await sql.transaction(async (tx) => {
  const inserted = await tx(
    `INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id AS "id!"`,
    "Alice",
    "alice@example.com",
  );

  return inserted[0]!.id;
});
```

Internally, `src/runtime.ts` calls `getClient().begin(...)`, creates a bound callable with `makeBoundCallable(txClient)`, and passes that to your callback.

## Combining The Methods

```ts
import { sql } from "bun-sqlx";

const summary = await sql.transaction(async (tx) => {
  const user = await tx(
    `INSERT INTO users (name, email, role) VALUES ($1, $2, $3) RETURNING id AS "id!"`,
    "Admin",
    "admin@example.com",
    "admin",
  );

  const admins = await tx.file("queries/get_users_by_role.sql", "admin", 10);

  return { userId: user[0]!.id, totalAdmins: admins.length };
});
```

## Notes

- Inline queries and file paths must be string literals so the scanner can generate type keys.
- Alias overrides such as `"id!"` and `"name?"` affect the generated row type and are stripped from runtime row keys.
- The callable is typed only after `bun-sqlx prepare` has emitted `bun-sqlx.d.ts`.

Related pages: [Typed Queries](/docs/typed-queries), [Runtime Helpers](/docs/api-reference/runtime-helpers), and [Types](/docs/types).
