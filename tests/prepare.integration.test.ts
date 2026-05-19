import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dir, "..");
const DB_URL = process.env.BUN_SQLX_TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/bun_sqlx_test";

function probeDb(): boolean {
  const r = spawnSync("bun", [join(repoRoot, "bin/bun-sqlx.ts"), "migrate", "info", "--root", "/dev/null"], {
    env: { ...process.env, DATABASE_URL: DB_URL },
    encoding: "utf8",
  });
  return r.status === 0 || /no such file or directory|does not exist|migrations/i.test(`${r.stdout}${r.stderr}`);
}

const dbAvailable = probeDb();

if (!dbAvailable) {
  test.skip("integration suite requires Postgres at BUN_SQLX_TEST_DATABASE_URL", () => {});
} else {
  const tmp = join(repoRoot, "tests/.tmp-integration");

  function writeFile(rel: string, content: string) {
    const full = join(tmp, rel);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  function prepare(args: string[] = []): { code: number; stdout: string; stderr: string } {
    const r = spawnSync(
      "bun",
      [join(repoRoot, "bin/bun-sqlx.ts"), "prepare", "--root", tmp, ...args],
      { env: { ...process.env, DATABASE_URL: DB_URL }, encoding: "utf8" },
    );
    return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }

  beforeAll(() => {
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    writeFile("package.json", '{"name":"tmp-integration","type":"module"}');
    writeFile("migrations/0001_init.up.sql",
      "CREATE TABLE IF NOT EXISTS tmp_users (\n" +
      "  id BIGSERIAL PRIMARY KEY,\n" +
      "  name TEXT NOT NULL,\n" +
      "  email TEXT NOT NULL\n" +
      ");\n",
    );
    writeFile("migrations/0001_init.down.sql", "DROP TABLE IF EXISTS tmp_users;\n");

    const r = spawnSync(
      "bun",
      [join(repoRoot, "bin/bun-sqlx.ts"), "migrate", "run", "--root", tmp],
      { env: { ...process.env, DATABASE_URL: DB_URL }, encoding: "utf8" },
    );
    if (r.status !== 0) {
      throw new Error(`integration migrate failed: ${r.stderr}\n${r.stdout}`);
    }
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
    spawnSync("bun", ["-e", `
      import { SQL } from "bun";
      const c = new SQL({ url: "${DB_URL}" });
      await c.unsafe("DROP TABLE IF EXISTS tmp_users CASCADE", []);
      await c.unsafe("DROP TABLE IF EXISTS _bun_sqlx_migrations CASCADE", []);
      await c.close();
    `], { encoding: "utf8", stdio: "ignore" });
  });

  test("prepare emits file:line:column on PG describe error", () => {
    writeFile("a.ts",
      "import { sql } from \"bun-sqlx\";\n" +
      "await sql(\"SELECT * FROM totally_made_up_relation\");\n",
    );
    const r = prepare();
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/a\.ts:2:11/);
    expect(r.stderr).toMatch(/describe failed/);
    expect(r.stderr).toMatch(/relation .* does not exist/i);
  });

  test("prepare succeeds for a valid query and emits .d.ts and cache", () => {
    writeFile("a.ts",
      "import { sql } from \"bun-sqlx\";\n" +
      "await sql(\"SELECT id, name FROM tmp_users WHERE id = $1\", 1);\n",
    );
    const r = prepare();
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/a\.ts:2:11/);
    const dts = readFileSync(join(tmp, "bun-sqlx.d.ts"), "utf8");
    expect(dts).toContain("interface KnownQueries");
    expect(dts).toContain("SELECT id, name FROM tmp_users WHERE id = $1");
    expect(readdirSync(join(tmp, ".bun-sqlx")).filter((f) => f.endsWith(".json")).length).toBeGreaterThan(0);
  });

  test("prepare prunes orphaned cache entries by default", () => {
    writeFile("a.ts",
      "import { sql } from \"bun-sqlx\";\n" +
      "await sql(\"SELECT id FROM tmp_users\");\n",
    );
    let r = prepare();
    expect(r.code).toBe(0);
    const firstFiles = readdirSync(join(tmp, ".bun-sqlx")).filter((f) => f.endsWith(".json"));
    expect(firstFiles.length).toBe(1);

    writeFile("a.ts",
      "import { sql } from \"bun-sqlx\";\n" +
      "await sql(\"SELECT name FROM tmp_users\");\n",
    );
    r = prepare();
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/pruned 1 orphaned/);
    const second = readdirSync(join(tmp, ".bun-sqlx")).filter((f) => f.endsWith(".json"));
    expect(second.length).toBe(1);
    expect(second[0]).not.toBe(firstFiles[0]);
  });

  test("prepare --no-prune retains orphaned cache entries", () => {
    writeFile("a.ts",
      "import { sql } from \"bun-sqlx\";\n" +
      "await sql(\"SELECT id FROM tmp_users\");\n",
    );
    let r = prepare();
    expect(r.code).toBe(0);
    const first = readdirSync(join(tmp, ".bun-sqlx")).filter((f) => f.endsWith(".json"));

    writeFile("a.ts",
      "import { sql } from \"bun-sqlx\";\n" +
      "await sql(\"SELECT name FROM tmp_users\");\n",
    );
    r = prepare(["--no-prune"]);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toMatch(/pruned/);
    const second = readdirSync(join(tmp, ".bun-sqlx")).filter((f) => f.endsWith(".json"));
    expect(second.length).toBe(first.length + 1);
  });

  test("sql.file produces KnownFileQueries entry keyed by path", () => {
    writeFile("queries/by_id.sql", "SELECT id, name FROM tmp_users WHERE id = $1\n");
    writeFile("a.ts",
      "import { sql } from \"bun-sqlx\";\n" +
      "await sql.file(\"./queries/by_id.sql\", 1);\n",
    );
    const r = prepare();
    expect(r.code).toBe(0);
    const dts = readFileSync(join(tmp, "bun-sqlx.d.ts"), "utf8");
    expect(dts).toContain("interface KnownFileQueries");
    expect(dts).toContain('"queries/by_id.sql":');
  });

  test("sql.file with missing path errors at scan time with file:line:column", () => {
    writeFile("a.ts",
      "import { sql } from \"bun-sqlx\";\n" +
      "await sql.file(\"./nope.sql\");\n",
    );
    const r = prepare();
    expect(r.code).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/a\.ts:2:16.*nope\.sql/s);
  });

  test("scanner recognizes sql.transaction callback param as sql-alias", () => {
    writeFile("queries/by_id.sql", "SELECT id, name FROM tmp_users WHERE id = $1\n");
    writeFile("a.ts",
      "import { sql } from \"bun-sqlx\";\n" +
      "await sql.transaction(async (tx) => {\n" +
      "  await tx(\"SELECT id FROM tmp_users WHERE id = $1\", 1);\n" +
      "});\n",
    );
    const r = prepare();
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/a\.ts:3:12/);
    const dts = readFileSync(join(tmp, "bun-sqlx.d.ts"), "utf8");
    expect(dts).toContain("SELECT id FROM tmp_users WHERE id = $1");
  });
}

export {};
