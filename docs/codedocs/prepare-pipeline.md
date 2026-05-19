---
title: "Prepare Pipeline"
description: "See what happens during bun-sqlx prepare, how the cache works, and why generated declarations stay stable in CI."
---

`bun-sqlx prepare` is the command that turns raw SQL strings into a typed API. It is implemented primarily in `src/commands/prepare.ts` and orchestrates scanning, PostgreSQL description, schema loading, AST analysis, parameter mapping, cache persistence, and declaration generation.

## Why This Exists

The package could have tried to validate SQL at runtime, but that would be too late and too expensive. The prepare pipeline front-loads the work into a deterministic build step. Once the generated `bun-sqlx.d.ts` exists, your editor and TypeScript compiler can reason about each query before the application ever starts.

This concept connects every major internal subsystem. `scanner.ts` discovers candidates. `wire.ts` talks to PostgreSQL. `schema.ts`, `analyze.ts`, and `param-map.ts` determine the types. `cache.ts` persists results. `codegen.ts` emits the type surface that `src/index.ts` exports.

## Internal Flow

```mermaid
flowchart TD
  A[scanProject(root)] --> B[Deduplicate by fingerprint]
  B --> C[client.describe(query)]
  C --> D[loadAttributes and loadTableNamesByOid]
  D --> E[analyzeQuery(query, fields, schema)]
  E --> F[buildParamMap(query)]
  F --> G[loadCustomTypes(unknownOids)]
  G --> H[resolve column and param TS types]
  H --> I[Cache.write(fp, entry)]
  I --> J[emitDts(dtsPath, entries)]
```

`prepareOnce(...)` starts by scanning the project root and computing a normalized fingerprint for each query with `fingerprint(query)` from `src/cache.ts`. The fingerprint deliberately collapses whitespace before hashing, so identical queries with formatting differences share one cache record. That deduplication is for cache efficiency only. The generated type key still remains the original query string, not the normalized form.

Next, `client.describe(query)` from `src/pg/wire.ts` asks PostgreSQL for parameter OIDs and row descriptions. This is the point where missing tables, bad column names, or other SQL errors are surfaced. `prepare.ts` catches `PgError`, prints the originating file, line, and column using the stored call-site metadata, and includes PostgreSQL position, code, and hint when available.

Once row metadata exists, `SchemaCache` loads column attributes and table names for only the tables touched by the result set. `analyzeQuery(...)` then walks the parsed SQL AST and determines per-column nullability. `buildParamMap(...)` separately maps placeholders like `$1` to target columns so input-side typing can use schema-aware information too, especially for JSONB. Finally, `resolveColumnTs(...)` and `resolveParamTs(...)` fold in built-in OID tables, custom types, enums, arrays, and JSONB config.

The final `CacheEntry` shape written to disk contains the original query text, OIDs, parameter TypeScript types, output columns, nullability flags, and whether the query came from inline code, SQL files, or both. `emitDts(...)` converts those cache entries into the `KnownQueries` and `KnownFileQueries` interfaces that power the public API.

## Basic Example

A standard local development loop looks like this:

```bash
export DATABASE_URL=postgres://user:password@localhost:5432/app
bunx bun-sqlx migrate run
bunx bun-sqlx prepare
```

After that, the project root contains:

- `.bun-sqlx/*.json` cache files, one per query fingerprint
- `bun-sqlx.d.ts`, the generated module augmentation file

If you change a query or migration, rerun `prepare` so the declaration file and cache stay in sync.

## Advanced Example

Watch mode and CI check mode are two different uses of the same pipeline:

```bash
# local development
bunx bun-sqlx prepare --watch

# CI, no database needed
bunx bun-sqlx prepare --check
```

`runWatch(opts)` in `src/commands/watch.ts` keeps a `PgClient` and `SchemaCache` open, debounces changes by 150ms, and reruns `prepareOnce(...)` for TypeScript file changes only. `runPrepare(opts)` in check mode skips PostgreSQL entirely, verifies that every scanned query already has a cache entry, regenerates `bun-sqlx.d.ts` from cache, and fails fast if anything is stale.

<Callout type="warn">`prepare --check` only proves that scanned queries exist in the cache. It does not revalidate the SQL against a live database. For that reason, commit both `.bun-sqlx/` and `bun-sqlx.d.ts`, and rerun full `prepare` whenever the schema or query text changes.</Callout>

## Trade-Offs

<Accordions>
  <Accordion title="Live database validation versus offline verification">
    Full `prepare` needs a reachable PostgreSQL instance because `src/pg/wire.ts` asks the server to parse and describe each unique query. That gives you accurate parameter OIDs, real row descriptions, and immediate detection of schema drift. The cost is that local setup and schema branches must stay runnable. `--check` exists to keep CI deterministic after cache artifacts are committed, but it is intentionally narrower than a live validation run.
  </Accordion>
  <Accordion title="Fingerprint cache reuse versus exact literal keys">
    `src/cache.ts` normalizes whitespace before hashing, which means semantically identical formatting variations do not produce redundant cache files. That is useful for storage and avoids repeated describe calls when a query is copied across files. The trade-off is subtle but important: the generated declaration file still uses the original query string, because runtime typing must match the literal argument exactly. A formatter can change the cache fingerprint behavior less than you might expect, but changing the literal string itself still changes the type key seen by TypeScript.
  </Accordion>
  <Accordion title="Automatic cache pruning versus keeping historical entries">
    By default, `prepareOnce(...)` prunes orphaned cache entries that no longer correspond to any scanned query. That keeps `.bun-sqlx/` tidy and makes `prepare --check` reflect the current source tree rather than accumulated history. The trade-off is that it removes old entries automatically, which some teams might prefer to inspect during refactors. The CLI flag `--no-prune` exists for that reason, but leaving stale cache around makes it easier to misread what queries are still part of the build.
  </Accordion>
</Accordions>

Related pages: [Typed Queries](/docs/typed-queries), [Project Setup Guide](/docs/guides/project-setup), and [CLI API Reference](/docs/api-reference/cli).
