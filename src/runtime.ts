import { SQL } from "bun";
import { PgClient, parseDatabaseUrl } from "./pg/wire";
import { applyPending } from "./commands/migrate";

const MIGRATE_LOCK_KEY = 18750938867203960;

let defaultClient: SQL | null = null;

export function getClient(): SQL {
  if (!defaultClient) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("bun-sqlx: DATABASE_URL is not set");
    defaultClient = new SQL({ url, bigint: true });
  }
  return defaultClient;
}

export function setClient(client: SQL): void {
  defaultClient = client;
}

export async function close(): Promise<void> {
  if (defaultClient) {
    await defaultClient.close();
    defaultClient = null;
  }
}

type AnyFn = (...args: unknown[]) => Promise<unknown[]>;

const SUFFIX = /[!?]$/;

function renameRows(rows: unknown[]): unknown[] {
  if (rows.length === 0) return rows;
  const first = rows[0];
  if (first === null || typeof first !== "object") return rows;
  const keys = Object.keys(first as Record<string, unknown>);
  const renames: { from: string; to: string }[] = [];
  for (const k of keys) {
    if (SUFFIX.test(k)) renames.push({ from: k, to: k.slice(0, -1) });
  }
  if (renames.length === 0) return rows;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Record<string, unknown>;
    for (const { from, to } of renames) {
      r[to] = r[from];
      delete r[from];
    }
  }
  return rows;
}

export const sql: AnyFn = (async (query: string, ...params: unknown[]) => {
  const c = getClient();
  const rows = await c.unsafe(query, params);
  return renameRows(rows);
}) as AnyFn;

export const unsafe = sql;

export type MigrateOptions = {
  dir?: string;
  databaseUrl?: string;
  log?: (msg: string) => void;
};

export async function migrate(opts: MigrateOptions = {}): Promise<void> {
  const url = opts.databaseUrl ?? process.env.DATABASE_URL;
  if (!url) throw new Error("bun-sqlx.migrate: DATABASE_URL is required");
  const dir = opts.dir ?? "migrations";
  const log = opts.log ?? ((m: string) => console.log(`[bun-sqlx] ${m}`));

  const cfg = parseDatabaseUrl(url);
  const client = new PgClient(cfg);
  await client.connect();
  let locked = false;
  try {
    await client.simpleQuery(`SELECT pg_advisory_lock(${MIGRATE_LOCK_KEY})`);
    locked = true;
    let appliedAny = false;
    const result = await applyPending(client, dir, (e) => {
      if (e.kind === "applied") {
        log(`migrate: applied ${String(e.version).padStart(4, "0")}_${e.name}`);
        appliedAny = true;
      } else if (e.kind === "tampered") {
        throw new Error(
          `bun-sqlx.migrate: ${e.version}_${e.name} hash mismatch (applied ${e.applied.slice(0, 16)}… vs current ${e.current.slice(0, 16)}…)`,
        );
      } else {
        throw new Error(`bun-sqlx.migrate: ${e.version}_${e.name} failed — ${e.error}`);
      }
    });
    if (!appliedAny) log(`migrate: up-to-date (${result.applied + result.failed + result.tampered === 0 ? "no pending" : ""})`);
  } finally {
    if (locked) {
      try { await client.simpleQuery(`SELECT pg_advisory_unlock(${MIGRATE_LOCK_KEY})`); } catch {}
    }
    await client.end();
  }
}
