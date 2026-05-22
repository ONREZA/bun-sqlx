#!/usr/bin/env bun
import { join, resolve } from "node:path";
import { runPrepare } from "../src/commands/prepare";
import { runWatch } from "../src/commands/watch";
import { migrateRun, migrateInfo, migrateRevert, migrateAdd } from "../src/commands/migrate";
import { applyShadowMigrations, runSchemaCheck, runSchemaDump } from "../src/commands/schema";
import pkg from "../package.json";

const VERSION = pkg.version;

function help(): never {
  console.error(`bun-sqlx — compile-time-checked SQL for Bun + Postgres (v${VERSION})

usage:
  bun-sqlx prepare [--check | --watch] [--root <dir>] [--dts <path>] [--no-prune] [--shadow-url <url>]
  bun-sqlx migrate run [--lock-timeout <ms>] | info | revert [--lock-timeout <ms>] | add <name>
  bun-sqlx schema dump | check [--schema <path>] [--manifest <path>] [--no-manifest] [--shadow-url <url>]
  bun-sqlx --version

env:
  DATABASE_URL=postgres://...  (supports ?sslmode=require|verify-ca|verify-full)
  SHADOW_DATABASE_URL=postgres://...  (optional throwaway DB for prepare/schema checks)

flags:
  --root <dir>             scan root (default: cwd)
  --dts <path>             declarations output (default: <root>/bun-sqlx-env.d.ts)
  --check                  offline mode: validate cache vs sources, no DB
  --watch                  re-prepare on file change (persistent PG connection)
  --no-prune               keep orphaned cache entries (default: remove)
  --migrations <dir>       migrations directory (default: <root>/migrations)
  --lock-timeout <ms>      advisory-lock acquisition timeout for migrate run/revert
  --shadow-url <url>       apply migrations to this DB, then prepare/introspect against it
  --schema <path>          schema snapshot path (default: <root>/.bun-sqlx/schema/schema.json)
  --manifest <path>        LLM schema manifest path (default: <root>/.bun-sqlx/schema/schema.md)
  --no-manifest            skip writing the LLM schema manifest during schema dump
`);
  process.exit(2);
}

function arg(name: string, def?: string): string | undefined {
  const argv = process.argv;
  const eq = `${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === name) return argv[i + 1] ?? def;
    if (a.startsWith(eq)) return a.slice(eq.length);
  }
  return def;
}

function flag(name: string): boolean {
  for (const a of process.argv) {
    if (a === name) return true;
  }
  return false;
}

const cmd = process.argv[2];

if (cmd === "--version" || cmd === "-v") {
  console.log(VERSION);
  process.exit(0);
}
if (cmd === "--help" || cmd === "-h" || !cmd) {
  help();
}

const root = resolve(arg("--root", process.cwd())!);
const databaseUrl = process.env.DATABASE_URL ?? "";
const shadowUrlArg = arg("--shadow-url");
const shadowUrl = shadowUrlArg ?? process.env.SHADOW_DATABASE_URL;
const cacheDir = join(root, ".bun-sqlx");
const dtsArg = arg("--dts");
const dtsPath = dtsArg ? resolve(dtsArg) : join(root, "bun-sqlx-env.d.ts");
const migrationsDir = join(root, arg("--migrations", "migrations")!);
const schemaArg = arg("--schema");
const schemaPath = schemaArg ? resolve(schemaArg) : join(root, ".bun-sqlx/schema/schema.json");
const manifestArg = arg("--manifest");
const manifestPath = manifestArg ? resolve(manifestArg) : join(root, ".bun-sqlx/schema/schema.md");

if (cmd === "prepare") {
  if (flag("--check") && shadowUrlArg) {
    console.error("--shadow-url cannot be used with prepare --check; use live prepare or schema check --shadow-url");
    process.exit(2);
  }
  const prepareShadowUrl = flag("--check") ? undefined : shadowUrl;
  const prepareDatabaseUrl = prepareShadowUrl ?? databaseUrl;
  if (!flag("--check") && !prepareDatabaseUrl) {
    console.error("DATABASE_URL is required for prepare (use --check for offline)");
    process.exit(2);
  }
  const opts = {
    root,
    databaseUrl: prepareDatabaseUrl,
    cacheDir,
    dtsPath,
    check: flag("--check"),
    prune: !flag("--no-prune"),
  };
  if (flag("--watch")) {
    if (flag("--check")) {
      console.error("--watch and --check are mutually exclusive");
      process.exit(2);
    }
    await runWatch({
      ...opts,
      ...(prepareShadowUrl
        ? {
            beforePrepare: async () => {
              const result = await applyShadowMigrations(prepareShadowUrl, migrationsDir);
              return { resetSession: result.applied > 0 };
            },
          }
        : {}),
    });
  } else {
    if (prepareShadowUrl) await applyShadowMigrations(prepareShadowUrl, migrationsDir);
    await runPrepare(opts);
  }
} else if (cmd === "schema") {
  const sub = process.argv[3];
  const schemaDatabaseUrl = shadowUrl ?? databaseUrl;
  if (!schemaDatabaseUrl) {
    console.error("DATABASE_URL is required for schema commands (or pass --shadow-url)");
    process.exit(2);
  }
  const opts = {
    databaseUrl,
    snapshotPath: schemaPath,
    manifestPath,
    writeManifest: !flag("--no-manifest"),
    shadowUrl,
    migrationsDir,
  };
  if (sub === "dump") await runSchemaDump(opts);
  else if (sub === "check") await runSchemaCheck(opts);
  else help();
} else if (cmd === "migrate") {
  const sub = process.argv[3];
  if (!databaseUrl && sub !== "add") {
    console.error("DATABASE_URL is required");
    process.exit(2);
  }
  const tRaw = arg("--lock-timeout");
  const lockTimeoutMs = tRaw ? Number(tRaw) : undefined;
  if (sub === "run") {
    await migrateRun({ databaseUrl, migrationsDir, lockTimeoutMs });
  } else if (sub === "info") await migrateInfo({ databaseUrl, migrationsDir });
  else if (sub === "revert") await migrateRevert({ databaseUrl, migrationsDir, lockTimeoutMs });
  else if (sub === "add") {
    const name = process.argv[4];
    if (!name) { console.error("migrate add: name required"); process.exit(2); }
    migrateAdd({ databaseUrl, migrationsDir, name });
  } else help();
} else {
  help();
}
