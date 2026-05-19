import { test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { scanProject } from "../src/scan/scanner";

const tmp = join(import.meta.dir, ".tmp-scan");

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function setup(files: Record<string, string>) {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const full = join(tmp, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

test("finds sql() calls when sql is imported from bun-sqlx", () => {
  setup({
    "a.ts": `
      import { sql } from "bun-sqlx";
      await sql("SELECT 1", 1);
      await sql("SELECT 2");
    `,
  });
  const sites = scanProject(tmp);
  expect(sites.length).toBe(2);
  expect(sites.map((s) => s.query).sort()).toEqual(["SELECT 1", "SELECT 2"]);
  expect(sites.find((s) => s.query === "SELECT 1")!.paramCount).toBe(1);
});

test("respects alias import", () => {
  setup({
    "a.ts": `
      import { sql as q } from "bun-sqlx";
      await q("SELECT x");
    `,
  });
  const sites = scanProject(tmp);
  expect(sites.length).toBe(1);
  expect(sites[0]!.query).toBe("SELECT x");
});

test("ignores sql() not imported from bun-sqlx", () => {
  setup({
    "a.ts": `
      import { sql } from "other-lib";
      await sql("SELECT 1");
    `,
  });
  expect(scanProject(tmp).length).toBe(0);
});

test("rejects dynamic-string first arg", () => {
  setup({
    "a.ts": `
      import { sql } from "bun-sqlx";
      const q = "SELECT 1";
      await sql(q);
    `,
  });
  expect(() => scanProject(tmp)).toThrow(/string literal/);
});

test("captures line and column of each sql() call site", () => {
  setup({
    "a.ts":
      "import { sql } from \"bun-sqlx\";\n" +
      "await sql(\"SELECT 1\");\n" +
      "  await sql(\"SELECT 2\");\n",
  });
  const sites = scanProject(tmp).slice().sort((a, b) => a.line - b.line);
  expect(sites).toHaveLength(2);
  expect(sites[0]!.line).toBe(2);
  expect(sites[0]!.column).toBe(11);
  expect(sites[1]!.line).toBe(3);
  expect(sites[1]!.column).toBe(13);
});

test("dynamic-first-arg error includes file:line:column", () => {
  setup({
    "a.ts":
      "import { sql } from \"bun-sqlx\";\n" +
      "const q = \"SELECT 1\";\n" +
      "await sql(q);\n",
  });
  expect(() => scanProject(tmp)).toThrow(/a\.ts:3:11/);
});

test("sql.file() resolves path relative to source file and reads contents", () => {
  setup({
    "a.ts": `
      import { sql } from "bun-sqlx";
      await sql.file("./q/get_user.sql", 1);
    `,
    "q/get_user.sql": "SELECT id, name FROM users WHERE id = $1\n",
  });
  const sites = scanProject(tmp);
  expect(sites).toHaveLength(1);
  const s = sites[0]!;
  expect(s.kind).toBe("file");
  expect(s.query).toContain("SELECT id, name FROM users");
  expect(s.sqlFilePath).toBe("q/get_user.sql");
  expect(s.paramCount).toBe(1);
});

test("sql.file() missing path throws with file:line:column", () => {
  setup({
    "a.ts":
      "import { sql } from \"bun-sqlx\";\n" +
      "await sql.file(\"./does-not-exist.sql\");\n",
  });
  expect(() => scanProject(tmp)).toThrow(/a\.ts:2:16.*does-not-exist\.sql/s);
});

test("sql.file() requires string literal path", () => {
  setup({
    "a.ts":
      "import { sql } from \"bun-sqlx\";\n" +
      "const p = \"x.sql\";\n" +
      "await sql.file(p);\n",
  });
  expect(() => scanProject(tmp)).toThrow(/string literal path/);
});

test("aliased sql.file() works", () => {
  setup({
    "a.ts": `
      import { sql as q } from "bun-sqlx";
      await q.file("./query.sql");
    `,
    "query.sql": "SELECT 1",
  });
  const sites = scanProject(tmp);
  expect(sites).toHaveLength(1);
  expect(sites[0]!.kind).toBe("file");
});
