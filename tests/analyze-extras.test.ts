import { describe, expect, test } from "bun:test";
import { analyzeQuery } from "../src/pg/analyze";
import type { ColumnInfo, SchemaCache } from "../src/pg/schema";
import type { FieldDescription } from "../src/pg/wire";

type TableDef = {
  schema?: string;
  name: string;
  oid: number;
  columns: { name: string; attno: number; notNull: boolean }[];
};

function fakeSchema(tables: TableDef[]): SchemaCache {
  const byOidAttno = new Map<string, ColumnInfo>();
  const byName = new Map<string, number>();
  const byOid = new Map<number, Map<string, ColumnInfo>>();
  const oidToName = new Map<number, { schema: string; name: string }>();
  for (const t of tables) {
    const schema = t.schema ?? "public";
    byName.set(`${schema}.${t.name}`, t.oid);
    oidToName.set(t.oid, { schema, name: t.name });
    const cols = new Map<string, ColumnInfo>();
    for (const c of t.columns) {
      const info: ColumnInfo = { attrelid: t.oid, attnum: c.attno, notNull: c.notNull, name: c.name };
      cols.set(c.name, info);
      byOidAttno.set(`${t.oid}/${c.attno}`, info);
    }
    byOid.set(t.oid, cols);
  }
  return {
    loadTableNames: async () => {},
    loadAttributes: async () => {},
    loadColumnsForTables: async () => {},
    loadTableNamesByOid: async () => {},
    loadCustomTypes: async () => {},
    resolveTable: (s: string | undefined, n: string) => byName.get(`${s ?? "public"}.${n}`),
    isNotNull: (oid: number, attno: number) => byOidAttno.get(`${oid}/${attno}`)?.notNull,
    columnNameByAttno: (oid: number, attno: number) => byOidAttno.get(`${oid}/${attno}`)?.name,
    columnsOf: (oid: number) => byOid.get(oid),
    tableNameByOid: (oid: number) => oidToName.get(oid),
    customType: () => undefined,
    setTypeRegistry: () => {},
  } as unknown as SchemaCache;
}

function rowDesc(parts: { name: string; tableOid?: number; attno?: number; typeOid?: number }[]): FieldDescription[] {
  return parts.map((p) => ({
    name: p.name,
    tableOid: p.tableOid ?? 0,
    columnAttr: p.attno ?? 0,
    typeOid: p.typeOid ?? 23,
    typeSize: 4,
    typeModifier: -1,
    format: 0,
  }));
}

describe("analyze: CTE / WITH", () => {
  test("infers nullability of CTE column references", async () => {
    const schema = fakeSchema([{
      name: "users",
      oid: 16400,
      columns: [
        { name: "id", attno: 1, notNull: true },
        { name: "bio", attno: 2, notNull: false },
      ],
    }]);
    // WITH active AS (SELECT id, bio FROM users) SELECT id, bio FROM active
    const sql = "WITH active AS (SELECT id, bio FROM users) SELECT id, bio FROM active";
    const rd = rowDesc([
      { name: "id", tableOid: 0, attno: 0 },
      { name: "bio", tableOid: 0, attno: 0 },
    ]);
    const result = await analyzeQuery(sql, rd, schema);
    expect(result.perColumnNullable[0]).toBe(false);
    expect(result.perColumnNullable[1]).toBe(true);
  });

  test("CTE through outer JOIN keeps inner not-null as nullable", async () => {
    const schema = fakeSchema([
      {
        name: "users",
        oid: 16400,
        columns: [
          { name: "id", attno: 1, notNull: true },
          { name: "name", attno: 2, notNull: true },
        ],
      },
      {
        name: "posts",
        oid: 16401,
        columns: [
          { name: "id", attno: 1, notNull: true },
          { name: "user_id", attno: 2, notNull: true },
        ],
      },
    ]);
    const sql = "WITH p AS (SELECT id, user_id FROM posts) SELECT u.id, p.id FROM users u LEFT JOIN p ON p.user_id = u.id";
    const rd = rowDesc([
      { name: "id", tableOid: 0, attno: 0 },
      { name: "id", tableOid: 0, attno: 0 },
    ]);
    const result = await analyzeQuery(sql, rd, schema);
    expect(result.perColumnNullable[0]).toBe(false);
    expect(result.perColumnNullable[1]).toBe(true);
  });
});

describe("analyze: CTE explicit column list and unnamed expressions", () => {
  test("WITH foo(a, b) AS (...) uses the declared alias names", async () => {
    const schema = fakeSchema([{
      name: "users",
      oid: 16400,
      columns: [
        { name: "id", attno: 1, notNull: true },
        { name: "bio", attno: 2, notNull: false },
      ],
    }]);
    const sql = "WITH foo(a, b) AS (SELECT id, bio FROM users) SELECT a, b FROM foo";
    const rd = rowDesc([
      { name: "a", tableOid: 0, attno: 0 },
      { name: "b", tableOid: 0, attno: 0 },
    ]);
    const result = await analyzeQuery(sql, rd, schema);
    expect(result.perColumnNullable[0]).toBe(false);
    expect(result.perColumnNullable[1]).toBe(true);
  });

  test("CTE column from an unnamed expression is conservatively nullable", async () => {
    const schema = fakeSchema([{
      name: "users",
      oid: 16400,
      columns: [{ name: "id", attno: 1, notNull: true }],
    }]);
    const sql = "WITH n AS (SELECT id + 1 FROM users) SELECT * FROM n";
    const rd = rowDesc([{ name: "?column?", tableOid: 0, attno: 0 }]);
    const result = await analyzeQuery(sql, rd, schema);
    expect(result.perColumnNullable[0]).toBe(true);
  });
});

describe("analyze: degraded reason", () => {
  test("unsupported statement type marks result as degraded", async () => {
    const schema = fakeSchema([]);
    const sql = "EXPLAIN SELECT 1";
    const rd = rowDesc([{ name: "QUERY PLAN", tableOid: 0, attno: 0 }]);
    const result = await analyzeQuery(sql, rd, schema);
    expect(result.perColumnNullable).toEqual([true]);
    expect(result.degraded).toBeDefined();
    expect(result.degraded!.reason).toContain("unsupported statement type");
  });

  test("non-degraded path does not set degraded field", async () => {
    const schema = fakeSchema([{
      name: "users",
      oid: 16400,
      columns: [{ name: "id", attno: 1, notNull: true }],
    }]);
    const result = await analyzeQuery("SELECT id FROM users", rowDesc([{ name: "id", tableOid: 16400, attno: 1 }]), schema);
    expect(result.degraded).toBeUndefined();
  });
});

describe("analyze: subquery aliases", () => {
  test("derived table reference (qualified) treats unknown column as nullable", async () => {
    const schema = fakeSchema([{
      name: "users",
      oid: 16400,
      columns: [{ name: "id", attno: 1, notNull: true }],
    }]);
    const sql = "SELECT s.x FROM (SELECT id AS x FROM users) s";
    const rd = rowDesc([{ name: "x", tableOid: 0, attno: 0 }]);
    const result = await analyzeQuery(sql, rd, schema);
    expect(result.perColumnNullable[0]).toBe(true);
  });
});

describe("analyze: RETURNING from DML", () => {
  test("INSERT ... RETURNING preserves NOT NULL of target columns", async () => {
    const schema = fakeSchema([{
      name: "users",
      oid: 16400,
      columns: [
        { name: "id", attno: 1, notNull: true },
        { name: "bio", attno: 2, notNull: false },
      ],
    }]);
    const sql = "INSERT INTO users (id, bio) VALUES ($1, $2) RETURNING id, bio";
    const rd = rowDesc([
      { name: "id", tableOid: 16400, attno: 1 },
      { name: "bio", tableOid: 16400, attno: 2 },
    ]);
    const result = await analyzeQuery(sql, rd, schema);
    expect(result.perColumnNullable[0]).toBe(false);
    expect(result.perColumnNullable[1]).toBe(true);
  });

  test("UPDATE ... RETURNING with narrowing on WHERE", async () => {
    const schema = fakeSchema([{
      name: "users",
      oid: 16400,
      columns: [
        { name: "id", attno: 1, notNull: true },
        { name: "bio", attno: 2, notNull: false },
      ],
    }]);
    const sql = "UPDATE users SET bio = $1 WHERE id = $2 AND bio IS NOT NULL RETURNING bio";
    const rd = rowDesc([{ name: "bio", tableOid: 16400, attno: 2 }]);
    const result = await analyzeQuery(sql, rd, schema);
    expect(result.perColumnNullable[0]).toBe(false);
  });

  test("DELETE ... RETURNING surfaces table column nullability", async () => {
    const schema = fakeSchema([{
      name: "users",
      oid: 16400,
      columns: [
        { name: "id", attno: 1, notNull: true },
        { name: "bio", attno: 2, notNull: false },
      ],
    }]);
    const sql = "DELETE FROM users WHERE id = $1 RETURNING id, bio";
    const rd = rowDesc([
      { name: "id", tableOid: 16400, attno: 1 },
      { name: "bio", tableOid: 16400, attno: 2 },
    ]);
    const result = await analyzeQuery(sql, rd, schema);
    expect(result.perColumnNullable[0]).toBe(false);
    expect(result.perColumnNullable[1]).toBe(true);
  });
});
