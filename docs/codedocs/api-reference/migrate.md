---
title: "migrate API"
description: "Reference for the runtime migrate helper and the migration options exported by bun-sqlx."
---

The runtime migration helper is exported from `src/index.ts` as `migrate`, with its implementation in `src/runtime.ts`. It delegates the actual migration application logic to `applyPending(...)` in `src/commands/migrate.ts`.

## Import Path

```ts
import { migrate } from "bun-sqlx";
```

## Signature

```ts
export type MigrateOptions = {
  dir?: string;
  databaseUrl?: string;
  log?: (msg: string) => void;
};

export async function migrate(opts: MigrateOptions = {}): Promise<void>;
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `opts.dir` | `string` | `"migrations"` | Directory containing numbered `.up.sql` and optional `.down.sql` files. |
| `opts.databaseUrl` | `string` | `process.env.DATABASE_URL` | Connection string used by the internal `PgClient`. |
| `opts.log` | `(msg: string) => void` | `console.log` wrapper | Logger used for progress messages. |

## Return Type

```ts
Promise<void>
```

## Behavior

`migrate()` does four important things:

1. Resolves the connection string and migrations directory.
2. Opens a dedicated `PgClient` using the wire-protocol client from `src/pg/wire.ts`.
3. Acquires a PostgreSQL advisory lock with a fixed key before applying pending migrations.
4. Calls `applyPending(...)`, which creates `_bun_sqlx_migrations`, verifies migration hashes, applies new `.up.sql` files in order, and stops on tampering or execution failure.

If no migrations are pending, the helper logs an up-to-date message and returns normally.

## Example

```ts
import { migrate } from "bun-sqlx";

await migrate({
  dir: "./migrations",
  log: (msg) => console.log("[bootstrap]", msg),
});
```

## Startup Pattern

```ts
import { migrate, sql, close } from "bun-sqlx";

await migrate({ dir: "./migrations" });

const rows = await sql(`SELECT COUNT(*) AS "n!" FROM users`);
console.log(rows[0]!.n);

await close();
```

This is safe to run in multiple replicas because the migration helper explicitly locks before applying changes.

## Related Internals

The runtime API is intentionally smaller than the CLI migration surface. The CLI also exposes:

- `migrate run`
- `migrate info`
- `migrate revert`
- `migrate add <name>`

Those commands are documented separately on the [CLI page](/docs/api-reference/cli). If you need migration inspection or file creation, use the CLI. If you need startup-time application from app code, use `migrate()`.

<Callout type="warn">`migrate()` uses direct SQL from migration files and records a content hash for every applied `.up.sql`. Editing an already-applied migration file will trigger a tampering error on the next run rather than being silently accepted.</Callout>

Related pages: [Migrations and CI Guide](/docs/guides/migrations-and-ci) and [CLI API](/docs/api-reference/cli).
