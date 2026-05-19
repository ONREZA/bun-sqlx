---
title: "Getting Started"
description: "Learn what bun-sqlx does, why it exists, and how to get typed PostgreSQL queries running in a Bun project."
---

`bun-sqlx` gives Bun applications compile-time-checked raw PostgreSQL queries by validating SQL during a `prepare` step and generating TypeScript declarations for the exact queries you wrote.

## The Problem

- Raw SQL is often the right abstraction, but stringly typed query calls make column mistakes and stale schema assumptions easy to ship.
- ORMs hide SQL details, while lightweight query helpers usually give up on full result typing, nullability, and enum awareness.
- PostgreSQL schema changes can silently break application code until a query runs in production or an integration test happens to hit it.
- Dynamic runtime validation adds overhead and still cannot give editors the same first-class autocomplete as true TypeScript types.

## The Solution

`bun-sqlx` takes a different path. It scans your source files for `sql("...", ...)` and `sql.file("...", ...)` call sites, asks PostgreSQL to describe those queries over the wire protocol, analyzes nullability with `libpg-query`, and emits a `bun-sqlx.d.ts` file that augments the package's `KnownQueries` and `KnownFileQueries` interfaces. The runtime in `src/runtime.ts` then stays intentionally thin: it forwards the same SQL string to `Bun.SQL.unsafe(...)`, strips `!` and `?` suffixes from column aliases, and returns rows whose types were already fixed at compile time.

```ts
import { sql } from "bun-sqlx";

const rows = await sql(
  `SELECT id, name, role FROM users WHERE id = $1`,
  1n,
);

rows[0]?.role;
//    ^ "admin" | "editor" | "viewer"
```

## Installation

" "bun"]}>
  <Tab value="npm">

```bash
npm install bun-sqlx typescript
```

  </Tab>
  <Tab value="pnpm">

```bash
pnpm add bun-sqlx typescript
```

  </Tab>
  <Tab value="yarn">

```bash
yarn add bun-sqlx typescript
```

  </Tab>
  <Tab value="bun">

```bash
bun add bun-sqlx typescript
```

  </Tab>
</Tabs>

`bun-sqlx` itself is Bun-only. The package declares `bun >= 1.3.0` in `package.json`, expects a reachable PostgreSQL database for `prepare`, and exports its public API from `src/index.ts`.

## Quick Start

Create a migration, write one query, and run `prepare`. The example fixture in `example/app.ts` follows exactly this workflow.

```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);
```

```ts
import { sql, close } from "bun-sqlx";

const users = await sql(
  `SELECT id AS "id!", name AS "name!" FROM users WHERE id = $1`,
  1n,
);

console.log(users[0]);

await close();
```

Run the CLI from your project root:

```bash
export DATABASE_URL=postgres://user:password@localhost:5432/app
bunx bun-sqlx prepare
```

Expected output after the query exists and the database schema matches it:

```text
scanned: found 1 sql() call site(s)
  ✓ app.ts:4:3 -> 1 param(s), 2 col(s) [2 non-null]

prepared 1 unique query/queries -> /path/to/your-project/bun-sqlx.d.ts
```

That generated declaration file is the reason the editor now knows `users[0]?.id` is `bigint` and `users[0]?.name` is `string`.

## Key Features

- Compile-time validation against a live PostgreSQL database using `Parse` and `Describe Statement`, not query execution.
- Literal-keyed result and parameter types generated into `KnownQueries` and `KnownFileQueries`.
- Nullability inference that combines table metadata, join direction, expressions, and `WHERE`-clause narrowing.
- Support for enums, domains, arrays, JSON and JSONB, plus built-in extension mappings such as `vector`, `hstore`, `citext`, and `ltree`.
- External SQL files and typed transactions using the same `sql` surface.
- Offline cache verification with `prepare --check`, plus watch mode with a warm PostgreSQL session.
- Runtime migrations with advisory locking for multi-replica startup safety.

<Cards>
  <Card title="Architecture" href="/docs/architecture">See how scanning, describing, analysis, caching, and code generation fit together.</Card>
  <Card title="Core Concepts" href="/docs/typed-queries">Understand typed queries, the prepare pipeline, and schema-driven type inference.</Card>
  <Card title="API Reference" href="/docs/api-reference/sql">Jump straight to the callable API, runtime helpers, migration API, and CLI.</Card>
</Cards>
