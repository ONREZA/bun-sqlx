import { test, expect } from "bun:test";
import { buildParamMap } from "../src/pg/param-map";

test("INSERT VALUES maps params to columns by position", async () => {
  const m = await buildParamMap(
    "INSERT INTO users (name, settings) VALUES ($1, $2)",
  );
  expect(m.get(1)).toEqual({ schema: undefined, table: "users", column: "name" });
  expect(m.get(2)).toEqual({ schema: undefined, table: "users", column: "settings" });
});

test("multi-row INSERT VALUES maps each row's params", async () => {
  const m = await buildParamMap(
    "INSERT INTO users (name, settings) VALUES ($1, $2), ($3, $4)",
  );
  expect(m.get(1)?.column).toBe("name");
  expect(m.get(2)?.column).toBe("settings");
  expect(m.get(3)?.column).toBe("name");
  expect(m.get(4)?.column).toBe("settings");
});

test("UPDATE SET maps each assignment", async () => {
  const m = await buildParamMap(
    "UPDATE users SET settings = $1, name = $2 WHERE id = $3",
  );
  expect(m.get(1)?.column).toBe("settings");
  expect(m.get(2)?.column).toBe("name");
  expect(m.get(3)?.column).toBe("id");
});

test("SELECT WHERE equality maps the param to its column", async () => {
  const m = await buildParamMap("SELECT id FROM users WHERE settings = $1");
  expect(m.get(1)?.column).toBe("settings");
  expect(m.get(1)?.table).toBe("users");
});

test("RETURNING expressions do not produce mappings", async () => {
  const m = await buildParamMap(
    "INSERT INTO users (settings) VALUES ($1) RETURNING id",
  );
  expect(m.size).toBe(1);
  expect(m.get(1)?.column).toBe("settings");
});
