---
title: "Types"
description: "Reference for the TypeScript interfaces and type aliases exported by bun-sqlx."
---

`bun-sqlx` exports a small but important set of TypeScript interfaces and aliases. Most application code touches `sql`, but the type layer in `src/index.ts` and `src/config.ts` is what makes the generated declarations composable.

## Import Path

```ts
import type {
  BunSqlxConfig,
  KnownQueries,
  KnownFileQueries,
  TypedSql,
  Typed,
  MigrateOptions,
} from "bun-sqlx";
```

## `KnownQueries`

Source: `src/index.ts`

```ts
export interface KnownQueries {}
```

This interface starts empty in source code and is augmented by `bun-sqlx.d.ts` during `prepare`. Each property key is an exact inline SQL literal, and each property value has a `params` tuple and `row` object type.

Use it when you need to inspect or build types from the generated query registry.

## `KnownFileQueries`

Source: `src/index.ts`

```ts
export interface KnownFileQueries {}
```

Like `KnownQueries`, but keyed by literal file paths passed to `sql.file(...)`.

## `BunSqlxConfig`

Source: `src/config.ts`

```ts
export type BunSqlxConfig = {
  jsonbTypes?: Record<string, string>;
  customTypes?: Record<string, string>;
};
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `jsonbTypes` | `Record<string, string>` | None | Maps `schema.table.column` or `table.column` to a TypeScript type name used for JSON and JSONB columns and parameters. |
| `customTypes` | `Record<string, string>` | None | Maps PostgreSQL `pg_type.typname` values to TypeScript type names, overriding or extending built-in extension mappings. |

## `TypedSql`

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
```

`TypedSql` is the query-only callable surface. It is what transaction callbacks receive as `tx`.

## `Typed`

Source: `src/index.ts`

```ts
export type Typed = TypedSql & {
  transaction: <R>(fn: (tx: TypedSql) => Promise<R>) => Promise<R>;
};
```

`Typed` adds the `transaction(...)` method to `TypedSql`. The exported `sql` constant has this type.

## `MigrateOptions`

Source: `src/runtime.ts`, re-exported from `src/index.ts`

```ts
export type MigrateOptions = {
  dir?: string;
  databaseUrl?: string;
  log?: (msg: string) => void;
};
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dir` | `string` | `"migrations"` | Directory containing migration files. |
| `databaseUrl` | `string` | `process.env.DATABASE_URL` | Connection string for the migration client. |
| `log` | `(msg: string) => void` | internal console logger | Callback used for migration progress messages. |

## Generated Type Example

The example repository's generated declaration file at `example/bun-sqlx.d.ts` shows how these source-level types are meant to be augmented:

```ts
declare module "bun-sqlx" {
  interface KnownQueries {
    "SELECT id, name, role FROM users WHERE id = $1": {
      params: [bigint];
      row: {
        "id": bigint;
        "name": string;
        "role": "admin" | "editor" | "viewer";
      };
    };
  }
}
```

That is why the public type layer stays intentionally small. The static source exports define the shape of augmentation, while `prepare` fills in the project-specific details.

## When To Reach For These Types

- Use `BunSqlxConfig` when authoring `bun-sqlx.config.ts`.
- Use `TypedSql` when you want a helper function to accept the same typed callable shape as a transaction callback.
- Use `MigrateOptions` when wrapping `migrate(...)` in your own startup helper.
- Use `KnownQueries` or `KnownFileQueries` only in advanced type-level code, because they depend on generated declarations being present.

Related pages: [sql API](/docs/api-reference/sql) and [Schema-Driven Types](/docs/schema-driven-types).
