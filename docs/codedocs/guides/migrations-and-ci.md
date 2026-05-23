---
title: "Migrations and CI"
description: "Run migrations safely at startup and verify generated query metadata in continuous integration."
---

This guide covers the migration features from both the CLI and the runtime API, plus the offline verification workflow that makes `bun-sqlx` practical in CI.

## Problem

Schema changes and typed query generation need to stay synchronized across local development, startup in multiple replicas, and CI pipelines. If migrations drift or the cache is stale, the generated types stop reflecting reality.

## Solution

Use the CLI for authoring and inspecting migrations, `migrate()` for startup-time application with an advisory lock, and `prepare --check` in CI after committing the cache and declaration outputs.

<Steps>
  <Step>
    ### Create migration files

```bash
bunx bun-sqlx migrate add add_role
```

`migrateAdd(...)` in `src/commands/migrate.ts` creates sequential `NNNN_name.up.sql` files and sanitizes the name into an underscore-safe filename.
  </Step>
  <Step>
    ### Apply or inspect migrations locally

```bash
bunx bun-sqlx migrate run
bunx bun-sqlx migrate info
```

`migrate run` creates and uses the `_bun_sqlx_migrations` table, hashes each `.up.sql` file with SHA-256, and stops if an already-applied migration was tampered with.
  </Step>
  <Step>
    ### Run migrations at application startup

```ts
import { migrate } from "bun-sqlx";

await migrate({
  dir: "./migrations",
  log: (message) => console.log(message),
});
```

The runtime helper in `src/runtime.ts` uses a PostgreSQL advisory lock before delegating to `applyPending(...)`, so multiple replicas do not race to apply the same migration batch.
  </Step>
  <Step>
    ### Commit generated artifacts and verify them in CI

Commit:

```text
.bun-sqlx/
bun-sqlx.d.ts
```

Then add a CI step:

```yaml
steps:
  - run: bun install
  - run: bunx bun-sqlx prepare --check
  - run: bunx tsc --noEmit
```

`prepare --check` scans the source tree, verifies that every query already has a cache entry, and regenerates the declaration file from cache without connecting to PostgreSQL.
  </Step>
</Steps>

## Complete Example

```ts
import { migrate, sql, close } from "bun-sqlx";

await migrate({ dir: "./migrations" });

const counts = await sql(`SELECT COUNT(*) AS "n!" FROM users`);
console.log("users:", counts[0]!.n);

await close();
```

This pattern is useful in services that should self-bootstrap on startup. Because `migrate()` uses its own `PgClient` rather than the runtime `Bun.SQL` connection, it can apply pending files before the regular query workload starts.

## What The Migration System Guarantees

The migration implementation in `src/commands/migrate.ts` is intentionally linear and conservative:

- files are ordered by their numeric prefix
- each applied migration stores the hash of the `.up.sql`
- tampering stops the process instead of silently proceeding
- `migrate revert` only reverts the latest applied migration and requires a matching `.down.sql`

That design keeps state simple. It is not trying to be a branching migration engine or a cross-database framework.

<Callout type="warn">`prepare --check` is not a substitute for rerunning full `prepare` after schema changes. It only checks that the cache contains entries for scanned queries. If the database changed but the cache was never regenerated, CI can still pass until a full prepare run refreshes the metadata.</Callout>

Related pages: [Prepare Pipeline](/docs/prepare-pipeline), [Migration API Reference](/docs/api-reference/migrate), and [CLI API Reference](/docs/api-reference/cli).
