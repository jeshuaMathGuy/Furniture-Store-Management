/**
 * Statement classifier for the read-only SQL playground.
 *
 * This is DEFENCE IN DEPTH, not the security boundary. The boundary is the
 * MySQL account: lab_reader holds SELECT on the lab, fixture and teaching
 * schemas, SHOW VIEW on the lab schema and EXECUTE on two NO SQL functions,
 * and nothing on the application database. The classifier exists to give a
 * clear message before MySQL would refuse, and to keep statements that are
 * permitted but undesirable (locking reads, named locks) out of a shared pool.
 *
 * It uses a real SQL parser (node-sql-parser, MySQL dialect). The parser is
 * injected so this package does not depend on it directly.
 */
export interface SqlParserLike {
  astify(sql: string, opt?: { database?: string }): unknown;
}

export type StatementKind = "select" | "with" | "explain" | "show" | "describe";
export type ExplainFormat = "traditional" | "json" | "tree";

export type Classification =
  | { ok: true; kind: StatementKind; sql: string; explainFormat?: ExplainFormat; explained?: string }
  | { ok: false; reason: RejectReason; message: string };

export type RejectReason =
  | "empty" | "too_long" | "parse_error" | "multiple_statements" | "not_read_only"
  | "locking_read" | "select_into" | "forbidden_function" | "explain_analyze";

export const MAX_SQL_LENGTH = 20_000;

/** Functions that take server-global named locks or wait on replication/files. Not useful in a teaching sandbox. */
export const FORBIDDEN_FUNCTIONS = [
  "get_lock", "release_lock", "release_all_locks", "load_file", "master_pos_wait", "source_pos_wait",
  "wait_for_executed_gtid_set", "wait_until_sql_thread_after_gtids",
] as const;
const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN_FUNCTIONS.join("|")})\\s*\\(`, "i");

const reject = (reason: RejectReason, message: string): Classification => ({ ok: false, reason, message });

/** Remove trailing semicolons and whitespace; a single statement may end with one ';'. */
export function normalizeSql(sql: string): string {
  let s = sql.trim();
  while (s.endsWith(";")) s = s.slice(0, -1).trimEnd();
  return s;
}

function parse(parser: SqlParserLike, sql: string): { ast: Record<string, unknown>[] } | { error: string } {
  try {
    const ast = parser.astify(sql, { database: "MySQL" });
    return { ast: (Array.isArray(ast) ? ast : [ast]) as Record<string, unknown>[] };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return { error: msg.length > 300 ? msg.slice(0, 300) + "…" : msg };
  }
}

function functionName(node: Record<string, unknown>): string {
  const n = node.name;
  if (typeof n === "string") return n;
  const parts: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") { const o = v as Record<string, unknown>; if (typeof o.value === "string") parts.push(o.value); else Object.values(o).forEach(walk); }
  };
  walk(n);
  return parts.join(".");
}

/** Walk the AST: locking clauses, SELECT ... INTO and forbidden functions at any depth (subqueries, UNION arms, CTEs). */
function inspectSelect(ast: unknown): Classification | null {
  let found: Classification | null = null;
  const seen = new Set<unknown>();
  const visit = (v: unknown) => {
    if (found || !v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach(visit); return; }
    const o = v as Record<string, unknown>;
    if (o.locking_read) {
      found = reject("locking_read", `Locking reads (${String(o.locking_read)}) are not available in the read-only playground. They are demonstrated in the Transactions and Concurrency labs.`);
      return;
    }
    const into = o.into as { position?: unknown } | undefined;
    if (into && typeof into === "object" && into.position) {
      found = reject("select_into", "SELECT ... INTO (variables or files) is not allowed: the playground only returns result sets.");
      return;
    }
    if (o.type === "function" || o.type === "aggr_func") {
      const name = functionName(o).toLowerCase();
      if ((FORBIDDEN_FUNCTIONS as readonly string[]).includes(name.split(".").pop() ?? "")) {
        found = reject("forbidden_function", `${name.toUpperCase()}() is not allowed in the playground (it takes server-wide locks or touches files).`);
        return;
      }
    }
    Object.values(o).forEach(visit);
  };
  visit(ast);
  return found;
}

function classifySelect(parser: SqlParserLike, sql: string): Classification {
  const p = parse(parser, sql);
  if ("error" in p) return reject("parse_error", `The classifier could not parse this statement as MySQL: ${p.error}`);
  if (p.ast.length !== 1) return reject("multiple_statements", `Only one statement can run at a time (found ${p.ast.length}).`);
  const ast = p.ast[0]!;
  if (ast.type !== "select") return reject("not_read_only", `Only SELECT, WITH, EXPLAIN, SHOW and DESCRIBE are allowed; this is ${String(ast.type).toUpperCase()}.`);
  return inspectSelect(ast) ?? { ok: true, kind: ast.with ? "with" : "select", sql };
}

/**
 * Classify one statement. Allowed: SELECT, WITH ... SELECT, EXPLAIN [FORMAT=JSON|TREE|TRADITIONAL] of
 * a SELECT, SHOW, DESCRIBE/DESC of a table. Everything else is rejected with a reason.
 */
export function classifySql(input: string, parser: SqlParserLike): Classification {
  const sql = normalizeSql(input);
  if (!sql) return reject("empty", "Type a query first.");
  if (sql.length > MAX_SQL_LENGTH) return reject("too_long", `Statements are limited to ${MAX_SQL_LENGTH} characters.`);
  // Text-level backstop for the function denylist (conservative: it also matches inside string literals).
  const fn = FORBIDDEN_RE.exec(sql);
  if (fn) return reject("forbidden_function", `${fn[1]!.toUpperCase()}() is not allowed in the playground (it takes server-wide locks or touches files).`);

  const ex = /^(EXPLAIN|DESCRIBE|DESC)\b\s*/i.exec(sql);
  if (ex) {
    let rest = sql.slice(ex[0].length);
    if (/^ANALYZE\b/i.test(rest)) return reject("explain_analyze", "EXPLAIN ANALYZE executes the query; use Run, or EXPLAIN FORMAT=TREE for the estimated plan.");
    let format: ExplainFormat = "traditional";
    const f = /^FORMAT\s*=\s*(JSON|TREE|TRADITIONAL)\s+/i.exec(rest);
    if (f) { format = f[1]!.toLowerCase() as ExplainFormat; rest = rest.slice(f[0].length); }
    if (/^(SELECT|WITH|\()/i.test(rest)) {
      const inner = classifySelect(parser, rest);
      if (!inner.ok) return inner;
      return { ok: true, kind: "explain", sql, explainFormat: format, explained: rest };
    }
    if (f) return reject("not_read_only", "EXPLAIN FORMAT=... is supported for SELECT statements only.");
    // DESCRIBE table [column]
    const p = parse(parser, `DESCRIBE ${rest}`);
    if ("error" in p) return reject("parse_error", `The classifier could not parse this statement as MySQL: ${p.error}`);
    if (p.ast.length !== 1) return reject("multiple_statements", "Only one statement can run at a time.");
    if (p.ast[0]!.type !== "desc") return reject("not_read_only", "EXPLAIN/DESCRIBE is supported for SELECT statements and table names only.");
    return { ok: true, kind: "describe", sql };
  }

  const p = parse(parser, sql);
  if ("error" in p) return reject("parse_error", `The classifier could not parse this statement as MySQL: ${p.error}`);
  if (p.ast.length !== 1) return reject("multiple_statements", `Only one statement can run at a time (found ${p.ast.length}).`);
  const type = String(p.ast[0]!.type);
  if (type === "show") return { ok: true, kind: "show", sql };
  if (type === "desc") return { ok: true, kind: "describe", sql };
  if (type !== "select") return reject("not_read_only", `Only SELECT, WITH, EXPLAIN, SHOW and DESCRIBE are allowed; this is ${type.toUpperCase()}.`);
  return classifySelect(parser, sql);
}
