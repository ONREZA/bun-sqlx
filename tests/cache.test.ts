import { test, expect } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { Cache, fingerprint } from "../src/cache";

test("fingerprint is whitespace-invariant", () => {
  expect(fingerprint("SELECT 1")).toBe(fingerprint("SELECT  1"));
  expect(fingerprint("SELECT 1")).toBe(fingerprint(" SELECT 1 "));
});

test("different queries have different fingerprints", () => {
  expect(fingerprint("SELECT 1")).not.toBe(fingerprint("SELECT 2"));
});

test("Cache round-trips entries to disk", () => {
  const dir = join(import.meta.dir, ".tmp-cache");
  rmSync(dir, { recursive: true, force: true });
  const c = new Cache(dir);
  c.write("abc", {
    query: "SELECT 1",
    paramOids: [],
    paramTsTypes: [],
    columns: [],
    hasResultSet: false,
  });
  expect(c.has("abc")).toBe(true);
  expect(c.read("abc")?.query).toBe("SELECT 1");
  expect(c.list().length).toBe(1);
  c.remove("abc");
  expect(c.has("abc")).toBe(false);
  rmSync(dir, { recursive: true, force: true });
});
