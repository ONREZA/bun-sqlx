---
title: "Project Setup"
description: "Set up bun-sqlx in a Bun project with migrations, a first query, and generated declarations."
---

This guide takes a blank Bun application to a working `bun-sqlx` setup. It follows the same sequence shown in the source README and the example fixture under `example/`.

## Problem

You want raw SQL in a Bun project, but you also want the compiler to catch bad query text, incorrect parameter types, and stale schema assumptions before the application starts.

## Solution

Install `bun-sqlx`, point it at a PostgreSQL database, create a migration, write a query, and run `prepare` so `bun-sqlx.d.ts` becomes part of your build artifacts.

<Steps>
  <Step>
    ### Install the package

```bash
bun add bun-sqlx typescript
```

`package.json` in the source repo declares Bun as the required runtime, and the CLI entry point lives at `bin/bun-sqlx.ts`.
  </Step>
  <Step>
    ### Configure the database URL

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/app
```

`prepare` and most migration commands read `DATABASE_URL` from the environment. `migrate add` is the only CLI subcommand that does not require a live connection.
  </Step>
  <Step>
    ### Create and apply your first migration

```bash
bunx bun-sqlx migrate add init
```

Edit `migrations/0001_init.up.sql`:

```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Then apply it:

```bash
bunx bun-sqlx migrate run
```
  </Step>
  <Step>
    ### Write an application query

Create `app.ts`:

```ts
import { sql, close } from "bun-sqlx";

const rows = await sql(
  `SELECT id AS "id!", name AS "name!", email AS "email!" FROM users WHERE id = $1`,
  1n,
);

console.log(rows[0]);
await close();
```

The `!` suffixes tell the generator to force those columns to non-null in the final row shape.
  </Step>
  <Step>
    ### Generate the declaration file

```bash
bunx bun-sqlx prepare
```

This scans the current working directory, validates every query literal against PostgreSQL, writes `.bun-sqlx/*.json`, and generates `bun-sqlx.d.ts`.
  </Step>
  <Step>
    ### Make sure TypeScript sees the generated file

If your `tsconfig.json` already includes the project root, you may not need extra configuration. If it does not, add the file explicitly:

```json
{
  "include": ["src", "app.ts", "bun-sqlx.d.ts"]
}
```
  </Step>
</Steps>

## Complete Example

```ts
import { sql, close } from "bun-sqlx";

async function main() {
  const inserted = await sql(
    `INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id AS "id!", created_at AS "created_at!"`,
    "Alice",
    "alice@example.com",
  );

  const found = await sql(
    `SELECT id AS "id!", name AS "name!" FROM users WHERE id = $1`,
    inserted[0]!.id,
  );

  console.log("created:", inserted[0]);
  console.log("found:", found[0]);

  await close();
}

await main();
```

If you mirror the source example in `example/app.ts`, the compiler will know the exact parameter and result types after `prepare`.

<Callout type="info">Commit both `bun-sqlx.d.ts` and `.bun-sqlx/` to your repository. That is how `bun-sqlx prepare --check` can run in CI without connecting to a live database.</Callout>

Next steps: [SQL Files and Transactions](/docs/guides/sql-files-and-transactions), [JSONB and Custom Types](/docs/guides/jsonb-and-custom-types), and [Migrations and CI](/docs/guides/migrations-and-ci).
