# Roadmap

Future work, ordered by ROI (0–10) — how much real-world pain each item closes.

Items already shipped live in the [README](./README.md) feature list; this file tracks what's still ahead.

| Feature | ROI | Notes |
|---------|-----|-------|
| Composite & domain types | 6 | Resolve PG `CREATE TYPE foo AS (...)` and `CREATE DOMAIN` via `pg_type` recursion. Domain → base type's TS (`email DOMAIN AS text` → `string`). Composite → struct literal type. Currently both fall through to `unknown`. |
| Self-join precision (unqualified ColumnRef) | 4 | `SELECT name FROM users u1 JOIN users u2 ON ...` with unqualified `name` can't be attributed to a specific alias. PG would reject ambiguous unqualified refs anyway, but explicit aliasing currently has no narrowing benefit in self-joins. |
| Transitive equality narrowing | 4 | `WHERE a = b AND b IS NOT NULL` ⇒ `a IS NOT NULL`. Union-find over equality chains in WHERE. |
| JOIN ON-clause narrowing | 4 | `INNER JOIN t ON t.k = u.k` guarantees `t.k` and `u.k` non-null. Today only `joinNullable` flips from the join type, not from the ON predicate. |
| RETURNING analysis on DML | 5 | `INSERT INTO t (...) RETURNING ...` and `UPDATE ... RETURNING ...` currently use base nullability + alias overrides only. Should run the same scope + narrowing pipeline as `SELECT`. |
| `INSERT INTO t VALUES (...)` without column list | 3 | Map params by `pg_attribute attnum` ordering. Rare in practice — most teams use explicit column lists. |
| Tagged-template literal API (`` sql`SELECT ${x}` ``) | 8 | Restoring sqlx's inline-SQL aesthetic requires either a TS compiler plugin (`ts-patch`) or a Bun preload-time AST rewriter. TS itself hardcodes the first tag argument as `TemplateStringsArray` and refuses to narrow to literal tuples. Significant effort, large UX win. |
| LSP server | 6 | Realtime diagnostics, hover with column types, autocomplete on schema names. Two-to-four weeks for beta, separate VS Code / Neovim extensions. Watch mode covers ~85% of the value today. |
| Schema-aware `jsonb` runtime validation | 5 | Optional opt-in: pass a Zod / Valibot / ArkType schema, validate rows on read. Currently we are compile-time-only by design. |
| MySQL backend | 5 | `Bun.SQL` supports it, but MySQL has no `Describe Statement` equivalent. Would need a real SQL parser pass + `INFORMATION_SCHEMA` introspection. |
| SQLite backend | 4 | SQLite's column types are dynamic. Would require running `EXPLAIN` and a heuristic mapper, or schema-driven inference per-statement. |
| `EXPLAIN`-based performance hints | 6 | `prepare` could optionally run `EXPLAIN` per query and surface seq-scan / missing-index warnings. Independent feature; pairs well with CI. |
| Safe identifier interpolation (`sql.id(table)`) | 4 | Today dynamic identifiers force `unsafe`. A whitelist-checked helper would cover safe dynamic table/column names. |
| `NOT (col IS NULL)` narrowing | 2 | Symmetric inversion in WHERE walker. Niche pattern. |
| Multi-statement queries | 2 | One SQL string with multiple statements separated by `;`. PG's `Parse` is single-statement; this would require client-side splitting. |
| Migration `down` reversal dry-run | 3 | Apply `down`, diff schema, compare to pre-`up` snapshot. Useful for catching irreversible migrations. |
| Stored procedure / function typing | 3 | `CALL proc(...)` and `SELECT func(...)` with parameter and return-type binding from `pg_proc`. |
| Streaming / cursor / COPY typing | 3 | Surface the cursor variants of `Bun.SQL` with proper row types. |
| Shadow-database support for `prepare` | 5 | Some teams want `prepare` to target a stage / temp DB instead of `DATABASE_URL`. A `--shadow-url` flag or `SHADOW_DATABASE_URL` env. |

## Long-term

- Full LSP with schema-driven autocomplete.
- Hooks for ORM-like helpers that build on top of the typed `sql()` primitive (joins, paginated queries, etc.) without becoming an ORM.
- Optional binary protocol support in the underlying wire client for measurable perf gain on large result sets.
