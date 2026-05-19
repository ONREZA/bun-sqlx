---
title: "SQL Files and Transactions"
description: "Use external .sql files and typed transactions together for larger queries and multi-step writes."
---

This guide covers two related workflows from the source example: keeping complex SQL in standalone files and executing a multi-step unit of work inside `sql.transaction(...)` without losing type safety.

## Problem

Inline query strings are convenient until they become large, reused, or shared across application layers. At the same time, write-heavy code often needs transactions, and many abstractions lose type information once you move into a callback-specific transaction client.

## Solution

Use `sql.file(...)` for external SQL files and `sql.transaction(...)` for grouped writes. The scanner in `src/scan/scanner.ts` supports both, and the transaction callback parameter is intentionally treated as a typed query function too.

<Steps>
  <Step>
    ### Create a SQL file

Create `queries/get_users_by_role.sql`:

```sql
SELECT id AS "id!", name AS "name!", email AS "email!"
FROM users
WHERE role = $1
ORDER BY id
LIMIT $2::int
```

The example repo ships this exact file at `example/queries/get_users_by_role.sql`.
  </Step>
  <Step>
    ### Call the file-backed query

```ts
import { sql } from "bun-sqlx";

const admins = await sql.file("queries/get_users_by_role.sql", "admin", 5);

for (const admin of admins) {
  console.log(admin.id, admin.name, admin.email);
}
```

`prepare` keys this query under `"queries/get_users_by_role.sql"` inside `KnownFileQueries`, not under the SQL text itself.
  </Step>
  <Step>
    ### Wrap related writes in a transaction

```ts
import { sql } from "bun-sqlx";

const created = await sql.transaction(async (tx) => {
  const users = await tx(
    `INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id AS "id!"`,
    "Alice",
    "alice@example.com",
  );

  const posts = await tx(
    `INSERT INTO posts (user_id, title) VALUES ($1, $2) RETURNING id AS "id!"`,
    users[0]!.id,
    "Hello from tx",
  );

  return { userId: users[0]!.id, postId: posts[0]!.id };
});
```

The callback receives a scoped query function bound to the transaction connection. `src/runtime.ts` builds that helper with `makeBoundCallable(txClient)`.
  </Step>
  <Step>
    ### Prepare and run

```bash
bunx bun-sqlx prepare
bun run app.ts
```

If any query text changes or the SQL file moves, rerun `prepare` so the generated `KnownQueries` and `KnownFileQueries` stay current.
  </Step>
</Steps>

## Complete Example

```ts
import { sql, close } from "bun-sqlx";

async function createUserWithRole(name: string, email: string) {
  return await sql.transaction(async (tx) => {
    const inserted = await tx(
      `INSERT INTO users (name, email, role) VALUES ($1, $2, $3) RETURNING id AS "id!"`,
      name,
      email,
      "admin",
    );

    const admins = await tx.file("queries/get_users_by_role.sql", "admin", 10);

    return { id: inserted[0]!.id, adminCount: admins.length };
  });
}

console.log(await createUserWithRole("FileTx", "filetx@example.com"));
await close();
```

## Path Rules That Matter

At scan time, `sql.file("queries/get_users_by_role.sql")` is resolved relative to the calling source file, because `scanner.ts` uses `resolve(dirname(absPath), sqlPath)`. At runtime, the same path is resolved relative to `process.cwd()` in `loadSqlFile(path)` inside `src/runtime.ts`. Keep a stable project convention, usually "run from repo root", so both phases point at the same file.

<Callout type="warn">Do not generate `sql.file(...)` paths dynamically. Like inline queries, the path must be a string literal or the scanner throws an error. Also remember that moving a `.sql` file without updating runtime working-directory assumptions can create a mismatch where types exist but the file cannot be read at runtime.</Callout>

Related pages: [Typed Queries](/docs/typed-queries) and [SQL API Reference](/docs/api-reference/sql).
