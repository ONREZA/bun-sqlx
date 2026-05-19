import { parse } from "libpg-query";

export type ParamTarget = { schema?: string; table: string; column: string };
export type ParamMap = Map<number, ParamTarget>;

export async function buildParamMap(sql: string): Promise<ParamMap> {
  const map: ParamMap = new Map();
  const ast = await parse(sql);
  const stmt = ast?.stmts?.[0]?.stmt;
  if (!stmt) return map;

  if (stmt.InsertStmt) walkInsert(stmt.InsertStmt, map);
  else if (stmt.UpdateStmt) walkUpdate(stmt.UpdateStmt, map);
  else if (stmt.SelectStmt) walkWhere(stmt.SelectStmt.whereClause, defaultRel(stmt.SelectStmt), map);
  else if (stmt.DeleteStmt) walkWhere(stmt.DeleteStmt.whereClause, relOf(stmt.DeleteStmt.relation), map);

  return map;
}

function walkInsert(ins: any, map: ParamMap): void {
  const rel = relOf(ins.relation);
  if (!rel) return;
  const cols: string[] = (ins.cols ?? [])
    .map((c: any) => c?.ResTarget?.name)
    .filter((n: any): n is string => typeof n === "string");
  const valuesLists = ins.selectStmt?.SelectStmt?.valuesLists ?? [];
  for (const row of valuesLists) {
    const items = row?.List?.items ?? [];
    for (let i = 0; i < items.length; i++) {
      const colName = cols[i];
      if (!colName) continue;
      const pn = paramNumber(items[i]);
      if (pn !== null) map.set(pn, { ...rel, column: colName });
    }
  }
  if (ins.returningList) {
    for (const rt of ins.returningList) {
      collectFromExpr(rt?.ResTarget?.val, rel, map);
    }
  }
  walkWhere(ins.whereClause, rel, map);
}

function walkUpdate(upd: any, map: ParamMap): void {
  const rel = relOf(upd.relation);
  if (!rel) return;
  for (const rt of upd.targetList ?? []) {
    const colName = rt?.ResTarget?.name;
    if (typeof colName !== "string") continue;
    const pn = paramNumber(rt.ResTarget.val);
    if (pn !== null) map.set(pn, { ...rel, column: colName });
  }
  walkWhere(upd.whereClause, rel, map);
}

function walkWhere(node: any, defaultRel: { schema?: string; table: string } | null, map: ParamMap): void {
  if (!node || !defaultRel) return;
  if (node.BoolExpr) {
    for (const a of node.BoolExpr.args ?? []) walkWhere(a, defaultRel, map);
    return;
  }
  if (node.A_Expr) {
    collectFromExpr(node, defaultRel, map);
    return;
  }
}

function collectFromExpr(
  node: any,
  defaultRel: { schema?: string; table: string } | null,
  map: ParamMap,
): void {
  if (!node || !defaultRel) return;
  if (node.A_Expr) {
    const e = node.A_Expr;
    const opName = e.name?.[0]?.String?.sval;
    if (e.kind === "AEXPR_OP" && opName === "=") {
      tryBind(e.lexpr, e.rexpr, defaultRel, map);
      tryBind(e.rexpr, e.lexpr, defaultRel, map);
    }
    if (e.kind === "AEXPR_IN") {
      const colName = colNameOf(e.lexpr);
      if (colName) {
        const list = Array.isArray(e.rexpr) ? e.rexpr : [];
        for (const item of list) {
          const pn = paramNumber(item);
          if (pn !== null) map.set(pn, { ...defaultRel, column: colName });
        }
      }
    }
  }
}

function tryBind(
  colSide: any,
  valSide: any,
  defaultRel: { schema?: string; table: string },
  map: ParamMap,
): void {
  const colName = colNameOf(colSide);
  const pn = paramNumber(valSide);
  if (colName !== null && pn !== null) map.set(pn, { ...defaultRel, column: colName });
}

function colNameOf(node: any): string | null {
  if (!node?.ColumnRef) return null;
  const fields = node.ColumnRef.fields;
  if (!Array.isArray(fields) || fields.length === 0) return null;
  if (fields.some((f: any) => f.A_Star !== undefined)) return null;
  return fields[fields.length - 1]?.String?.sval ?? null;
}

function paramNumber(node: any): number | null {
  if (node?.ParamRef && typeof node.ParamRef.number === "number") return node.ParamRef.number;
  if (node?.TypeCast) return paramNumber(node.TypeCast.arg);
  return null;
}

function relOf(relation: any): { schema?: string; table: string } | null {
  if (!relation) return null;
  const name = relation.relname;
  if (typeof name !== "string") return null;
  return { schema: relation.schemaname || undefined, table: name };
}

function defaultRel(select: any): { schema?: string; table: string } | null {
  const from = select?.fromClause;
  if (!Array.isArray(from) || from.length !== 1) return null;
  const node = from[0];
  if (node?.RangeVar) return relOf(node.RangeVar);
  return null;
}
