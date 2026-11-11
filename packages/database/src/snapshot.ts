import type { RowDataPacket } from "mysql2";
import type { ColumnMeta, Provenance, Row, RowChange, TableSnapshot } from "@furni/shared";
import { quoteId } from "./connection.js";

type Queryable = { query: <T extends RowDataPacket[]>(sql: string, values?: unknown[]) => Promise<[T, unknown]> };

/** Capture a table (optionally filtered by a fixed, server-authored predicate) with stable PK identities. */
export async function snapshotTable(
  conn: Queryable, schema: string, table: string,
  opts: { where?: string; params?: unknown[]; provenance?: Provenance } = {},
): Promise<TableSnapshot> {
  const [cols] = await conn.query<RowDataPacket[]>(
    `SELECT c.COLUMN_NAME AS name, c.DATA_TYPE AS dataType, (c.COLUMN_KEY='PRI') AS pk, (c.GENERATION_EXPRESSION <> '') AS gen
       FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA=? AND c.TABLE_NAME=? ORDER BY c.ORDINAL_POSITION`,
    [schema, table]);
  if (cols.length === 0) throw new Error(`Unknown table ${schema}.${table}`);
  const columns: ColumnMeta[] = cols.map((c) => ({
    name: c.name, dataType: c.dataType, isPrimaryKey: !!Number(c.pk), isGenerated: !!Number(c.gen),
  }));
  const [pkRows] = await conn.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION`, [schema, table]);
  const primaryKey = pkRows.map((r) => r.c as string);
  const order = primaryKey.map(quoteId).join(",") || "1";
  const where = opts.where ? ` WHERE ${opts.where}` : "";
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT * FROM ${quoteId(schema)}.${quoteId(table)}${where} ORDER BY ${order}`, opts.params);
  return {
    schema, table, columns, primaryKey,
    rows: rows.map((r) => ({ key: rowKey(r, primaryKey), values: { ...r } })),
    capturedAt: new Date().toISOString(),
    provenance: opts.provenance ?? "observed",
  };
}

export function rowKey(row: Row, pk: string[]): string {
  return pk.map((c) => String(row[c])).join("|");
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Primary-key-keyed diff of two snapshots of the same table. */
export function diffSnapshots(before: TableSnapshot, after: TableSnapshot): RowChange[] {
  if (before.table !== after.table) throw new Error("Cannot diff different tables");
  const b = new Map(before.rows.map((r) => [r.key, r.values]));
  const a = new Map(after.rows.map((r) => [r.key, r.values]));
  const changes: RowChange[] = [];
  for (const [key, av] of a) {
    const bv = b.get(key);
    if (!bv) { changes.push({ table: after.table, key, kind: "inserted", after: av }); continue; }
    const changedColumns = Object.keys(av).filter((c) => !same(av[c], bv[c]));
    if (changedColumns.length) changes.push({ table: after.table, key, kind: "updated", before: bv, after: av, changedColumns });
  }
  for (const [key, bv] of b) if (!a.has(key)) changes.push({ table: before.table, key, kind: "deleted", before: bv });
  return changes;
}
