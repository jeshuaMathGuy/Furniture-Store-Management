/**
 * Splits a MySQL client script into individual statements, honouring the
 * client-side `DELIMITER` command, quoted strings/identifiers and comments.
 * `DELIMITER` is a mysql-CLI directive, not server SQL, so a driver such as
 * mysql2 cannot execute the original script verbatim without this step.
 */
export interface SqlStatement {
  sql: string;
  /** 1-based line in the source file where the statement starts */
  line: number;
}

export function splitSqlScript(source: string): SqlStatement[] {
  const text = source.replace(/\r\n?/g, "\n");
  const out: SqlStatement[] = [];
  let delimiter = ";";
  let buf = "";
  let bufLine = 0;
  let line = 1;
  let i = 0;
  let atLineStart = true;

  const push = () => {
    const sql = buf.trim();
    if (sql.length > 0) out.push({ sql, line: bufLine });
    buf = "";
    bufLine = 0;
  };

  while (i < text.length) {
    // DELIMITER directive: only recognised at the start of a line, outside a statement body.
    if (atLineStart && buf.trim() === "") {
      const m = /^[ \t]*DELIMITER[ \t]+(\S+)[ \t]*(?:\n|$)/i.exec(text.slice(i));
      if (m) {
        delimiter = m[1]!;
        i += m[0].length;
        line += m[0].endsWith("\n") ? 1 : 0;
        buf = "";
        continue;
      }
    }

    const ch = text[i]!;
    if (bufLine === 0 && !/\s/.test(ch)) bufLine = line;

    // Comments
    if (ch === "-" && text[i + 1] === "-" && /[\s]/.test(text[i + 2] ?? "\n")) {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      if (buf.trim() === "") bufLine = 0;
      continue;
    }
    if (ch === "#") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      if (buf.trim() === "") bufLine = 0;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      const chunk = text.slice(i, stop);
      line += (chunk.match(/\n/g) ?? []).length;
      // Keep executable comments (/*! ... */); drop ordinary ones.
      if (chunk.startsWith("/*!")) buf += chunk;
      else if (buf.trim() === "") bufLine = 0;
      i = stop;
      continue;
    }

    // Quoted string or identifier
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      while (j < text.length) {
        const c = text[j]!;
        if (c === "\\" && ch !== "`") { j += 2; continue; }
        if (c === ch) {
          if (text[j + 1] === ch) { j += 2; continue; } // doubled quote
          break;
        }
        j++;
      }
      const chunk = text.slice(i, j + 1);
      line += (chunk.match(/\n/g) ?? []).length;
      buf += chunk;
      i = j + 1;
      atLineStart = false;
      continue;
    }

    // Delimiter
    if (text.startsWith(delimiter, i)) {
      push();
      i += delimiter.length;
      atLineStart = false;
      continue;
    }

    buf += ch;
    if (ch === "\n") { line++; atLineStart = true; } else if (!/[ \t]/.test(ch)) { atLineStart = false; }
    i++;
  }
  push();
  return out;
}
