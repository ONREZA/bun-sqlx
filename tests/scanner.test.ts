import { test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scanProject } from "../src/scan/scanner";

const tmp = join(import.meta.dir, ".tmp-scan");

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function setup(files: Record<string, string>) {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(tmp, name), content);
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
