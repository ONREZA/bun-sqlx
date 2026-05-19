---
title: "Runtime Helpers"
description: "Reference for unsafe execution, client management, and SQL file cache helpers exported by bun-sqlx."
---

These helpers are exported from `src/index.ts` and implemented in `src/runtime.ts`. They sit below the main typed `sql` abstraction.

## Import Path

```ts
import {
  unsafe,
  getClient,
  setClient,
  close,
  clearSqlFileCache,
} from "bun-sqlx";
```

## `unsafe`

`unsafe` is exported as `rt.unsafe`, and `src/runtime.ts` defines it as `export const unsafe = sql;`. In practice, it uses the same runtime code path as `sql` but without the literal-keyed public type declaration from `src/index.ts`.

### Practical Signature

```ts
type UnsafeCallable = {
  (query: string, ...params: unknown[]): Promise<unknown[]>;
  file(path: string, ...params: unknown[]): Promise<unknown[]>;
  transaction<R>(fn: (tx: {
    (query: string, ...params: unknown[]): Promise<unknown[]>;
    file(path: string, ...params: unknown[]): Promise<unknown[]>;
  }) => Promise<R>): Promise<R>;
};
```

### Example

```ts
import { unsafe } from "bun-sqlx";

const table = "users";
const rows = await unsafe(`SELECT * FROM ${table} WHERE id = $1`, 1n);
```

Use this only when a query genuinely cannot be expressed as a prepare-time literal.

## `getClient()`

Source: `src/runtime.ts`

```ts
export function getClient(): SQL;
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| None | None | None | Returns the shared `Bun.SQL` client, creating it from `process.env.DATABASE_URL` if needed. |

### Example

```ts
import { getClient } from "bun-sqlx";

const client = getClient();
const health = await client`SELECT 1`;
```

The implementation sets `bigint: true` when constructing the default client so runtime values match the generated `bigint` types.

## `setClient(client)`

Source: `src/runtime.ts`

```ts
export function setClient(client: SQL): void;
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `client` | `SQL` | None | Replaces the shared `Bun.SQL` instance used by `sql`, `unsafe`, and transactions. |

### Example

```ts
import { SQL } from "bun";
import { setClient } from "bun-sqlx";

setClient(new SQL({ url: process.env.DATABASE_URL!, bigint: true }));
```

## `close()`

Source: `src/runtime.ts`

```ts
export async function close(): Promise<void>;
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| None | None | None | Closes the shared default client if one exists and resets internal state. |

### Example

```ts
import { close } from "bun-sqlx";

await close();
```

This is useful in scripts and tests where process lifetime should not depend on an open connection.

## `clearSqlFileCache()`

Source: `src/runtime.ts`

```ts
export function clearSqlFileCache(): void;
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| None | None | None | Clears the in-memory map that caches `.sql` file contents for `sql.file(...)` and `unsafe.file(...)`. |

### Example

```ts
import { clearSqlFileCache, sql } from "bun-sqlx";

clearSqlFileCache();
await sql.file("queries/get_users_by_role.sql", "admin", 5);
```

## Common Pattern

```ts
import { SQL } from "bun";
import { setClient, unsafe, close } from "bun-sqlx";

setClient(new SQL({ url: process.env.DATABASE_URL!, bigint: true }));

const rows = await unsafe("SELECT now() AS ts");
console.log(rows);

await close();
```

<Callout type="warn">If you replace the shared client with `setClient(...)`, keep its runtime behavior aligned with bun-sqlx assumptions. In particular, the default implementation enables `bigint: true` so PostgreSQL `int8` values match the generated `bigint` TypeScript types.</Callout>

Related pages: [sql API](/docs/api-reference/sql) and [Migration API](/docs/api-reference/migrate).
