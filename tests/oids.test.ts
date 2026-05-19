import { test, expect } from "bun:test";
import { oidToTs, isBuiltinOid } from "../src/pg/oids";

test("scalar OIDs map to expected TS types", () => {
  expect(oidToTs(16).ts).toBe("boolean");
  expect(oidToTs(20).ts).toBe("bigint");
  expect(oidToTs(23).ts).toBe("number");
  expect(oidToTs(25).ts).toBe("string");
  expect(oidToTs(1082).ts).toBe("Date");
  expect(oidToTs(1184).ts).toBe("Date");
  expect(oidToTs(2950).ts).toBe("string");
  expect(oidToTs(3802).ts).toBe("unknown");
});

test("array OIDs map to (T)[]", () => {
  expect(oidToTs(1007).ts).toBe("(number)[]");
  expect(oidToTs(1009).ts).toBe("(string)[]");
  expect(oidToTs(1016).ts).toBe("(bigint)[]");
});

test("unknown OID falls back to unknown", () => {
  expect(oidToTs(999_999).ts).toBe("unknown");
});

test("isBuiltinOid recognizes scalars and arrays", () => {
  expect(isBuiltinOid(23)).toBe(true);
  expect(isBuiltinOid(1007)).toBe(true);
  expect(isBuiltinOid(999_999)).toBe(false);
});
