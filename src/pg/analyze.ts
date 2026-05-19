import { parse } from "libpg-query";
import type { FieldDescription } from "./wire";
import type { SchemaCache } from "./schema";
import { narrowFromWhere, isNarrowed, type NonNullSet } from "./narrow";

type AliasInfo =
  | { kind: "table"; schema?: string; relname: string; joinNullable: boolean }
  | { kind: "subquery"; joinNullable: boolean }
  | { kind: "function"; joinNullable: boolean };

type Scope = {
  aliases: Map<string, AliasInfo>;
  aliasOidByName: Map<string, number>;
  tableRefsByOid: Map<number, AliasInfo[]>;
  hasStar: boolean;
  schema: SchemaCache;
  forcedNonNull: NonNullSet;
};

export type AnalysisResult = {
  perColumnNullable: boolean[];
  referencedTables: { schema?: string; name: string }[];
};

export async function analyzeQuery(
  sql: string,
  rowDesc: FieldDescription[],
  schema: SchemaCache,
): Promise<AnalysisResult> {
  const ast = await parse(sql);
  const stmt = ast?.stmts?.[0]?.stmt;
  const select = stmt?.SelectStmt;

  if (!select || !select.targetList || !select.fromClause) {
    return {
      perColumnNullable: rowDesc.map(() => true),
      referencedTables: [],
    };
  }

  const scope: Scope = {
    aliases: new Map(),
    aliasOidByName: new Map(),
    tableRefsByOid: new Map(),
    hasStar: false,
    schema,
    forcedNonNull: narrowFromWhere(select.whereClause),
  };
  for (const entry of select.fromClause) {
    walkFrom(entry, false, scope);
  }
  for (const t of select.targetList) {
    if (containsStar(t.ResTarget?.val)) scope.hasStar = true;
  }

  const referencedTables: { schema?: string; name: string }[] = [];
  for (const a of scope.aliases.values()) {
    if (a.kind === "table") referencedTables.push({ schema: a.schema, name: a.relname });
  }

  await schema.loadTableNames(referencedTables);
  const allOids: number[] = [];
  for (const [aliasName, a] of scope.aliases) {
    if (a.kind !== "table") continue;
    const oid = schema.resolveTable(a.schema, a.relname);
    if (oid === undefined) continue;
    scope.aliasOidByName.set(aliasName, oid);
    allOids.push(oid);
    const arr = scope.tableRefsByOid.get(oid) ?? [];
    arr.push(a);
    scope.tableRefsByOid.set(oid, arr);
  }
  await schema.loadColumnsForTables(allOids);

  const nullables = new Array<boolean>(rowDesc.length).fill(true);
  const targets = select.targetList;

  if (scope.hasStar || targets.length !== rowDesc.length) {
    for (let i = 0; i < rowDesc.length; i++) {
      const f = rowDesc[i]!;
      nullables[i] = nullableFromRowDescConservative(f, scope, schema);
    }
    return { perColumnNullable: nullables, referencedTables };
  }

  for (let i = 0; i < rowDesc.length; i++) {
    const f = rowDesc[i]!;
    const target = targets[i]!;
    const val = target.ResTarget?.val;
    if (f.tableOid !== 0 && f.columnAttr !== 0) {
      const aliasName = aliasOfColumnRef(val);
      const refColName = colNameOfColumnRef(val);
      if (refColName && isNarrowed(scope.forcedNonNull, aliasName ?? undefined, refColName)) {
        nullables[i] = false;
        continue;
      }
      const notNull = schema.isNotNull(f.tableOid, f.columnAttr);
      let joinNullable: boolean;
      if (aliasName && scope.aliases.has(aliasName)) {
        joinNullable = scope.aliases.get(aliasName)!.joinNullable;
      } else {
        joinNullable = anyAliasNullableForOid(f.tableOid, scope);
      }
      nullables[i] = !(notNull === true && !joinNullable);
    } else {
      nullables[i] = expressionNullable(val, scope);
    }
  }
  return { perColumnNullable: nullables, referencedTables };
}

function nullableFromRowDescConservative(f: FieldDescription, scope: Scope, schema: SchemaCache): boolean {
  if (f.tableOid === 0 || f.columnAttr === 0) return true;
  const notNull = schema.isNotNull(f.tableOid, f.columnAttr);
  if (notNull !== true) return true;
  return anyAliasNullableForOid(f.tableOid, scope);
}

function anyAliasNullableForOid(tableOid: number, scope: Scope): boolean {
  const refs = scope.tableRefsByOid.get(tableOid);
  if (!refs || refs.length === 0) return true;
  return refs.some((r) => r.joinNullable);
}

function walkFrom(node: any, joinNullable: boolean, scope: Scope): void {
  if (!node) return;
  if (node.RangeVar) {
    const v = node.RangeVar;
    const alias = v.alias?.aliasname ?? v.relname;
    scope.aliases.set(alias, {
      kind: "table",
      schema: v.schemaname || undefined,
      relname: v.relname,
      joinNullable,
    });
    return;
  }
  if (node.JoinExpr) {
    const j = node.JoinExpr;
    let leftNullable = joinNullable;
    let rightNullable = joinNullable;
    switch (j.jointype) {
      case "JOIN_LEFT":
        rightNullable = true;
        break;
      case "JOIN_RIGHT":
        leftNullable = true;
        break;
      case "JOIN_FULL":
        leftNullable = true;
        rightNullable = true;
        break;
    }
    walkFrom(j.larg, leftNullable, scope);
    walkFrom(j.rarg, rightNullable, scope);
    return;
  }
  if (node.RangeSubselect) {
    const alias = node.RangeSubselect.alias?.aliasname;
    if (alias) scope.aliases.set(alias, { kind: "subquery", joinNullable });
    return;
  }
  if (node.RangeFunction) {
    const alias = node.RangeFunction.alias?.aliasname;
    if (alias) scope.aliases.set(alias, { kind: "function", joinNullable });
    return;
  }
}

function aliasOfColumnRef(val: any): string | null {
  if (!val?.ColumnRef) return null;
  const fields = val.ColumnRef.fields;
  if (!Array.isArray(fields) || fields.length < 2) return null;
  const first = fields[0]?.String?.sval;
  if (typeof first !== "string") return null;
  return first;
}

function colNameOfColumnRef(val: any): string | undefined {
  if (!val?.ColumnRef) return undefined;
  const fields = val.ColumnRef.fields;
  if (!Array.isArray(fields) || fields.length === 0) return undefined;
  if (fields.some((f: any) => f.A_Star !== undefined)) return undefined;
  return fields[fields.length - 1]?.String?.sval;
}

function containsStar(val: any): boolean {
  if (!val?.ColumnRef) return false;
  const fields = val.ColumnRef.fields;
  if (!Array.isArray(fields)) return false;
  return fields.some((f: any) => f.A_Star !== undefined);
}

function columnRefNullable(fields: any[], scope: Scope): boolean {
  let aliasName: string | undefined;
  let colName: string | undefined;
  if (fields.length >= 2) {
    aliasName = fields[0]?.String?.sval;
    colName = fields[fields.length - 1]?.String?.sval;
  } else if (fields.length === 1) {
    colName = fields[0]?.String?.sval;
  }
  if (typeof colName !== "string") return true;

  if (isNarrowed(scope.forcedNonNull, aliasName, colName)) return false;

  if (aliasName) {
    const a = scope.aliases.get(aliasName);
    if (!a) return true;
    if (a.kind !== "table") return true;
    const oid = scope.aliasOidByName.get(aliasName);
    if (oid === undefined) return true;
    const cols = scope.schema.columnsOf(oid);
    const info = cols?.get(colName);
    if (!info) return true;
    return !info.notNull || a.joinNullable;
  }

  const matches: { alias: string; notNull: boolean; joinNullable: boolean }[] = [];
  for (const [name, a] of scope.aliases) {
    if (a.kind !== "table") continue;
    const oid = scope.aliasOidByName.get(name);
    if (oid === undefined) continue;
    const info = scope.schema.columnsOf(oid)?.get(colName);
    if (!info) continue;
    matches.push({ alias: name, notNull: info.notNull, joinNullable: a.joinNullable });
  }
  if (matches.length !== 1) return true;
  const m = matches[0]!;
  return !m.notNull || m.joinNullable;
}

function funcName(call: any): string | null {
  const names = call?.funcname;
  if (!Array.isArray(names)) return null;
  const last = names[names.length - 1];
  return last?.String?.sval?.toLowerCase() ?? null;
}

const NON_NULL_FUNCS = new Set([
  "now",
  "current_timestamp",
  "current_date",
  "current_time",
  "localtime",
  "localtimestamp",
  "current_user",
  "session_user",
  "user",
  "current_database",
  "current_schema",
  "version",
  "pg_backend_pid",
  "txid_current",
  "random",
  "gen_random_uuid",
  "uuid_generate_v4",
  "length",
  "char_length",
  "character_length",
  "octet_length",
  "concat",
  "concat_ws",
]);

const COUNT_FUNCS = new Set(["count"]);

function expressionNullable(val: any, scope: Scope): boolean {
  if (!val) return true;

  if (val.A_Const !== undefined) {
    const c = val.A_Const;
    if (c.isnull === true) return true;
    return false;
  }

  if (val.ColumnRef) {
    const fields = val.ColumnRef.fields;
    if (!Array.isArray(fields)) return true;
    if (fields.some((f: any) => f.A_Star !== undefined)) return true;
    return columnRefNullable(fields, scope);
  }

  if (val.FuncCall) {
    const name = funcName(val.FuncCall);
    if (name && COUNT_FUNCS.has(name)) return false;
    if (name && NON_NULL_FUNCS.has(name)) {
      const args = val.FuncCall.args ?? [];
      return args.some((a: any) => expressionNullable(a, scope));
    }
    if (name === "greatest" || name === "least") {
      const args = val.FuncCall.args ?? [];
      if (args.length === 0) return true;
      return args.every((a: any) => expressionNullable(a, scope));
    }
    return true;
  }

  if (val.CoalesceExpr) {
    const args = val.CoalesceExpr.args ?? [];
    if (args.length === 0) return true;
    return args.every((a: any) => expressionNullable(a, scope));
  }

  if (val.MinMaxExpr) {
    const args = val.MinMaxExpr.args ?? [];
    if (args.length === 0) return true;
    return args.every((a: any) => expressionNullable(a, scope));
  }

  if (val.NullIfExpr) {
    return true;
  }

  if (val.CaseExpr) {
    const c = val.CaseExpr;
    const branches = (c.args ?? []).map((arm: any) => arm.CaseWhen?.result);
    const hasElse = c.defresult !== undefined && c.defresult !== null;
    if (!hasElse) return true;
    const elseExpr = c.defresult;
    return [...branches, elseExpr].some((b: any) => expressionNullable(b, scope));
  }

  if (val.A_Expr) {
    const e = val.A_Expr;
    return expressionNullable(e.lexpr, scope) || expressionNullable(e.rexpr, scope);
  }

  if (val.SubLink) return true;

  if (val.TypeCast) {
    return expressionNullable(val.TypeCast.arg, scope);
  }

  if (val.BoolExpr) {
    const a = val.BoolExpr.args ?? [];
    return a.some((x: any) => expressionNullable(x, scope));
  }

  return true;
}
