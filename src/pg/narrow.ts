export type NonNullSet = Set<string>;

const NULL_REJECTING_OPS = new Set(["=", "!=", "<>", "<", ">", "<=", ">="]);

export function narrowFromWhere(whereClause: any): NonNullSet {
  if (!whereClause) return new Set();
  return walk(whereClause);
}

function walk(node: any): NonNullSet {
  if (!node) return new Set();

  if (node.NullTest) {
    if (node.NullTest.nulltesttype === "IS_NOT_NULL") {
      const k = keyOfColumnRef(node.NullTest.arg);
      return k ? new Set([k]) : new Set();
    }
    return new Set();
  }

  if (node.BoolExpr) {
    const op = node.BoolExpr.boolop;
    const args = node.BoolExpr.args ?? [];
    if (op === "AND_EXPR") {
      const out = new Set<string>();
      for (const a of args) for (const k of walk(a)) out.add(k);
      return out;
    }
    if (op === "OR_EXPR") {
      if (args.length === 0) return new Set();
      let acc: NonNullSet | undefined;
      for (const a of args) {
        const s = walk(a);
        if (!acc) acc = new Set(s);
        else {
          const next = new Set<string>();
          for (const k of acc) if (s.has(k)) next.add(k);
          acc = next;
        }
      }
      return acc ?? new Set();
    }
    return new Set();
  }

  if (node.A_Expr) {
    const e = node.A_Expr;
    const kind = e.kind;
    const opName = e.name?.[0]?.String?.sval;
    if (kind === "AEXPR_OP" && opName && NULL_REJECTING_OPS.has(opName)) {
      const out = new Set<string>();
      const lk = keyOfColumnRef(e.lexpr);
      const rk = keyOfColumnRef(e.rexpr);
      const lIsNull = isNullLiteral(e.lexpr);
      const rIsNull = isNullLiteral(e.rexpr);
      if (lk && !rIsNull) out.add(lk);
      if (rk && !lIsNull) out.add(rk);
      return out;
    }
    if (kind === "AEXPR_IN" || kind === "AEXPR_LIKE" || kind === "AEXPR_ILIKE" || kind === "AEXPR_BETWEEN") {
      const k = keyOfColumnRef(e.lexpr);
      return k ? new Set([k]) : new Set();
    }
    return new Set();
  }

  return new Set();
}

function keyOfColumnRef(node: any): string | null {
  if (!node?.ColumnRef) return null;
  const fields = node.ColumnRef.fields;
  if (!Array.isArray(fields) || fields.length === 0) return null;
  if (fields.some((f: any) => f.A_Star !== undefined)) return null;
  if (fields.length === 1) {
    const col = fields[0]?.String?.sval;
    return typeof col === "string" ? `|${col}` : null;
  }
  const alias = fields[0]?.String?.sval;
  const col = fields[fields.length - 1]?.String?.sval;
  if (typeof alias !== "string" || typeof col !== "string") return null;
  return `${alias}|${col}`;
}

function isNullLiteral(node: any): boolean {
  return node?.A_Const?.isnull === true;
}

export function isNarrowed(set: NonNullSet, alias: string | undefined, col: string): boolean {
  if (set.size === 0) return false;
  if (alias && set.has(`${alias}|${col}`)) return true;
  if (set.has(`|${col}`)) return true;
  if (!alias) {
    const suffix = `|${col}`;
    for (const k of set) if (k.endsWith(suffix)) return true;
  }
  return false;
}
