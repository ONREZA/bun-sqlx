---
title: "CLI"
description: "Reference for bun-sqlx prepare, watch mode, migration commands, and the command-line flags."
---

The CLI entry point is `bin/bun-sqlx.ts`. It wires command-line arguments to `runPrepare`, `runWatch`, and the migration helpers.

## Installable Binary

```bash
bunx bun-sqlx
```

## Command Summary

```text
bun-sqlx prepare [--check | --watch] [--root <dir>] [--no-prune]
bun-sqlx migrate run | info | revert | add <name>
```

## `prepare`

Validates queries and emits `bun-sqlx.d.ts`.

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--root <dir>` | `string` | current working directory | Project root to scan for source files, cache, and generated declarations. |
| `--check` | `boolean` | `false` | Verify cache entries for all scanned queries and regenerate declarations without contacting PostgreSQL. |
| `--watch` | `boolean` | `false` | Keep a warm PostgreSQL session and re-run prepare on TypeScript file changes. |
| `--no-prune` | `boolean` | `false` | Keep orphaned cache entries instead of removing them. |

### Examples

```bash
bunx bun-sqlx prepare
bunx bun-sqlx prepare --watch
bunx bun-sqlx prepare --check --root ./example
```

`--watch` and `--check` are mutually exclusive, and `DATABASE_URL` is required unless `--check` is used.

## `migrate run`

Apply pending migrations in order.

```bash
bunx bun-sqlx migrate run
```

Implemented by `migrateRun(...)` in `src/commands/migrate.ts`.

## `migrate info`

Show the status of numbered migration files compared with `_bun_sqlx_migrations`.

```bash
bunx bun-sqlx migrate info
```

## `migrate revert`

Revert the latest applied migration if a matching `.down.sql` file exists.

```bash
bunx bun-sqlx migrate revert
```

This command only targets the latest applied migration. It is intentionally simple and linear.

## `migrate add <name>`

Create the next numbered `.up.sql` file in the migrations directory.

```bash
bunx bun-sqlx migrate add add_user_roles
```

The filename is sanitized to underscores, and the file starts with a comment containing the original name.

## Environment

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DATABASE_URL` | `string` | None | Required for `prepare`, `migrate run`, `migrate info`, and `migrate revert`. |

## Related Source Files

- `bin/bun-sqlx.ts` parses arguments and dispatches commands.
- `src/commands/prepare.ts` handles full and check-mode prepare.
- `src/commands/watch.ts` handles watch mode with debounce and a warm session.
- `src/commands/migrate.ts` implements migration file handling and execution.

## Common Workflow

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/app
bunx bun-sqlx migrate run
bunx bun-sqlx prepare
bunx tsc --noEmit
```

That sequence creates the schema, validates every query, regenerates `bun-sqlx.d.ts`, and confirms the rest of the codebase agrees with the generated types.

Related pages: [Prepare Pipeline](/docs/prepare-pipeline) and [Migrations and CI Guide](/docs/guides/migrations-and-ci).
