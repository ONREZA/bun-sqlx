import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type QueryCallSite = {
  file: string;
  line: number;
  column: number;
  query: string;
  paramCount: number;
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
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && sqlAliases.has(callee.text)) {
        const first = node.arguments[0];
        if (first && ts.isStringLiteralLike(first)) {
          const { line, character } = source.getLineAndCharacterOfPosition(first.getStart(source));
          out.push({
            file: relative(root, absPath),
            line: line + 1,
            column: character + 1,
            query: first.text,
            paramCount: node.arguments.length - 1,
          });
        } else if (first) {
          const { line, character } = source.getLineAndCharacterOfPosition(first.getStart(source));
          throw new Error(
            `bun-sqlx: ${relative(root, absPath)}:${line + 1}:${character + 1} — sql() requires a string literal as first argument`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
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
