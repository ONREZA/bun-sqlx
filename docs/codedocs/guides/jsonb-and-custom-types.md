---
title: "JSONB and Custom Types"
description: "Configure structured JSONB columns and extension or domain types so bun-sqlx generates useful TypeScript."
---

This guide shows how to move beyond the default `unknown` mapping for JSON and JSONB and how to override or extend type mappings for PostgreSQL-specific types.

## Problem

PostgreSQL knows a column is `jsonb`, but it does not know your application's document shape. Likewise, extension types and user-defined domains may need better TypeScript than a generic fallback.

## Solution

Use `bun-sqlx.config.ts` with `jsonbTypes` and `customTypes`, then declare the referenced TypeScript types in your project. The config loader in `src/config.ts` reads `bun-sqlx.config.ts`, `.js`, or `.mjs` from the project root during `prepare`.

<Steps>
  <Step>
    ### Declare your application-side JSON types

Create `json-types.d.ts`:

```ts
declare global {
  namespace BunSqlxJson {
    type UserSettings = {
      theme: "light" | "dark";
      lang: string;
      notifications?: { email: boolean; push: boolean };
    };

    type Attachment = {
      url: string;
      kind: "image" | "video" | "file";
      sizeBytes: number;
    };
  }
}

export {};
```
  </Step>
  <Step>
    ### Map JSONB columns and custom PostgreSQL types

Create `bun-sqlx.config.ts`:

```ts
import type { BunSqlxConfig } from "bun-sqlx";

const config: BunSqlxConfig = {
  jsonbTypes: {
    "users.settings": "BunSqlxJson.UserSettings",
    "posts.attachments": "BunSqlxJson.Attachment",
  },
  customTypes: {
    vector: "Float32Array",
    geometry: "GeoJSON.Geometry",
  },
};

export default config;
```

The built-in extension registry already covers `vector`, `halfvec`, `sparsevec`, `hstore`, `citext`, `ltree`, `lquery`, and `ltxtquery`. `customTypes` can override those defaults or add new names.
  </Step>
  <Step>
    ### Query and update typed JSONB columns

```ts
import { sql } from "bun-sqlx";

const inserted = await sql(
  `INSERT INTO users (name, email, settings) VALUES ($1, $2, $3) RETURNING id AS "id!"`,
  "Alice",
  "alice@example.com",
  { theme: "dark", lang: "en" },
);

const updated = await sql(
  `UPDATE users SET settings = $1 WHERE id = $2 RETURNING id AS "id!", settings`,
  { theme: "light", lang: "en", notifications: { email: true, push: false } },
  inserted[0]!.id,
);
```

Because `buildParamMap(...)` can link `$1` to `users.settings`, the input parameter becomes `BunSqlxJson.UserSettings` instead of `unknown`.
  </Step>
  <Step>
    ### Regenerate declarations

```bash
bunx bun-sqlx prepare
```

`prepare` resolves JSONB types through `lookupJsonbType(...)` in `src/config.ts` and user-defined or extension types through `SchemaCache.loadCustomTypes(...)` in `src/pg/schema.ts`.
  </Step>
</Steps>

## Complete Example

```ts
import { sql } from "bun-sqlx";

const user = await sql(
  `SELECT id, settings FROM users WHERE id = $1`,
  1n,
);

const theme: "light" | "dark" = user[0]!.settings.theme;

const found = await sql(
  `SELECT id, settings FROM users WHERE settings = $1 LIMIT 1`,
  { theme: "light", lang: "en" } as BunSqlxJson.UserSettings,
);

console.log(theme, found[0]?.id);
```

The example repository contains both the config file and the corresponding declaration file at `example/bun-sqlx.config.ts` and `example/json-types.d.ts`.

## Practical Notes

- JSONB lookups support both `"schema.table.column"` and `"table.column"` keys through `lookupJsonbType(...)`.
- Domains resolve to their base type by following `pg_type.typbasetype`.
- Arrays of registered scalar or enum custom types are handled automatically in `SchemaCache.loadCustomTypes(...)`.
- Unsupported composite types currently fall back to `unknown`.

<Callout type="warn">Keep your `BunSqlxJson` declarations aligned with the real values you write. PostgreSQL does not enforce those TypeScript shapes for you, so stale declaration files or stale global types can make application code look safer than the stored JSON actually is.</Callout>

Related pages: [Schema-Driven Types](/docs/schema-driven-types) and [Types Reference](/docs/types).
