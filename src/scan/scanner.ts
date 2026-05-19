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

  const visit = (node: ts.Node, aliases: Set<string>) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        aliases.has(callee.expression.text) &&
        ts.isIdentifier(callee.name) &&
        callee.name.text === "transaction"
      ) {
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
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        aliases.has(callee.expression.text) &&
        ts.isIdentifier(callee.name) &&
        callee.name.text === "file"
      ) {
        const first = node.arguments[0];
        if (!first || !ts.isStringLiteralLike(first)) {
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
          paramCount: node.arguments.length - 1,
          kind: "file",
          sqlFilePath: relative(root, abs),
        });
      } else if (ts.isIdentifier(callee) && aliases.has(callee.text)) {
        const first = node.arguments[0];
        if (first && ts.isStringLiteralLike(first)) {
          const pos = here(first);
          out.push({
            file: fileRel,
            line: pos.line,
            column: pos.column,
            query: first.text,
            paramCount: node.arguments.length - 1,
            kind: "inline",
          });
        } else if (first) {
          const pos = here(first);
          throw new Error(
            `bun-sqlx: ${fileRel}:${pos.line}:${pos.column} — sql() requires a string literal as first argument`,
          );
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
