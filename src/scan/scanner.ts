import ts from "typescript";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export type QueryCallSite = {
  file: string;
  line: number;
  column: number;
  query: string;
  paramCount: number;
  kind: "inline" | "file";
  sqlFilePath?: string;
};

const EXCLUDE_DIRS = new Set(["node_modules", ".git", ".bun-sqlx", "dist", "build", ".next"]);
const EXT = /\.(ts|tsx|mts|cts)$/;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXT.test(name)) out.push(full);
  }
}

export function findSourceFiles(root: string): string[] {
  const out: string[] = [];
  walk(root, out);
  return out;
}

type CalleeKind = "inline" | "file" | "transaction" | null;

function classifyCallee(
  callee: ts.LeftHandSideExpression,
  aliases: Set<string>,
): { alias: string; kind: Exclude<CalleeKind, null> } | null {
  if (ts.isIdentifier(callee)) {
    if (!aliases.has(callee.text)) return null;
    return { alias: callee.text, kind: "inline" };
  }

  if (!ts.isPropertyAccessExpression(callee)) return null;
  if (!ts.isIdentifier(callee.name)) return null;
  const methodName = callee.name.text;

  if (ts.isIdentifier(callee.expression)) {
    const aliasName = callee.expression.text;
    if (!aliases.has(aliasName)) return null;
    if (methodName === "transaction") return { alias: aliasName, kind: "transaction" };
    if (methodName === "file") return { alias: aliasName, kind: "file" };
    if (methodName === "one" || methodName === "optional") return { alias: aliasName, kind: "inline" };
    return null;
  }

  if (ts.isPropertyAccessExpression(callee.expression)) {
    const mid = callee.expression;
    if (!ts.isIdentifier(mid.expression) || !aliases.has(mid.expression.text)) return null;
    if (!ts.isIdentifier(mid.name) || mid.name.text !== "file") return null;
    if (methodName === "one" || methodName === "optional") {
      return { alias: mid.expression.text, kind: "file" };
    }
  }

  return null;
}

export function scanFile(absPath: string, root: string): QueryCallSite[] {
  const text = readFileSync(absPath, "utf8");
  const source = ts.createSourceFile(absPath, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);

  const sqlAliases = new Set<string>();
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const mod = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(mod)) continue;
    if (mod.text !== "bun-sqlx") continue;
    const ic = stmt.importClause;
    if (!ic) continue;
    const bindings = ic.namedBindings;
    if (!bindings) continue;
    if (ts.isNamedImports(bindings)) {
      for (const elem of bindings.elements) {
        const orig = (elem.propertyName ?? elem.name).text;
        if (orig === "sql") sqlAliases.add(elem.name.text);
      }
    }
  }

  if (sqlAliases.size === 0) return [];

  const out: QueryCallSite[] = [];
  const here = (node: ts.Node) => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    return { line: line + 1, column: character + 1 };
  };
  const fileRel = relative(root, absPath);

  const recordInline = (first: ts.Node, args: ts.NodeArray<ts.Expression>): boolean => {
    if (!ts.isStringLiteralLike(first)) {
      const pos = here(first);
      throw new Error(
        `bun-sqlx: ${fileRel}:${pos.line}:${pos.column} — sql() requires a string literal as first argument`,
      );
    }
    const pos = here(first);
    out.push({
      file: fileRel,
      line: pos.line,
      column: pos.column,
      query: first.text,
      paramCount: args.length - 1,
      kind: "inline",
    });
    return true;
  };

  const recordFile = (first: ts.Node, args: ts.NodeArray<ts.Expression>, callee: ts.Node): boolean => {
    if (!ts.isStringLiteralLike(first)) {
      const pos = first ? here(first) : here(callee);
      throw new Error(
        `bun-sqlx: ${fileRel}:${pos.line}:${pos.column} — sql.file() requires a string literal path`,
      );
    }
    const sqlPath = first.text;
    const abs = resolve(dirname(absPath), sqlPath);
    if (!existsSync(abs)) {
      const pos = here(first);
      throw new Error(
        `bun-sqlx: ${fileRel}:${pos.line}:${pos.column} — sql.file path not found: ${sqlPath}`,
      );
    }
    const query = readFileSync(abs, "utf8");
    const pos = here(first);
    out.push({
      file: fileRel,
      line: pos.line,
      column: pos.column,
      query,
      paramCount: args.length - 1,
      kind: "file",
      sqlFilePath: relative(root, abs),
    });
    return true;
  };

  const visit = (node: ts.Node, aliases: Set<string>) => {
    if (ts.isCallExpression(node)) {
      const classified = classifyCallee(node.expression, aliases);
      if (classified) {
        if (classified.kind === "transaction") {
          const fn = node.arguments[0];
          if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
            const param = fn.parameters[0];
            if (param && ts.isIdentifier(param.name)) {
              const inner = new Set(aliases);
              inner.add(param.name.text);
              visit(fn.body, inner);
              return;
            }
          }
        } else if (classified.kind === "file") {
          const first = node.arguments[0];
          if (first) recordFile(first, node.arguments, node.expression);
        } else if (classified.kind === "inline") {
          const first = node.arguments[0];
          if (first) recordInline(first, node.arguments);
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, aliases));
  };
  visit(source, sqlAliases);
  return out;
}

export function scanProject(root: string): QueryCallSite[] {
  const files = findSourceFiles(root);
  const out: QueryCallSite[] = [];
  for (const f of files) {
    for (const site of scanFile(f, root)) out.push(site);
  }
  return out;
}
