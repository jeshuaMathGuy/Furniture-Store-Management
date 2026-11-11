/**
 * Execution-trace contract (Part X). Produced only by the server from observed
 * database state; the client renders it and never synthesizes one.
 */
export type Provenance = "observed" | "instructional_simulation";

export interface ColumnMeta {
  name: string;
  dataType: string; // information_schema DATA_TYPE
  isPrimaryKey: boolean;
  isGenerated: boolean;
}

export type Row = Record<string, unknown>;

export interface TableSnapshot {
  schema: string;
  table: string;
  columns: ColumnMeta[];
  primaryKey: string[];
  /** Stable identity: primary-key values joined with "|" */
  rows: { key: string; values: Row }[];
  capturedAt: string;
  provenance: Provenance;
}

export type RowChange =
  | { table: string; key: string; kind: "inserted"; after: Row }
  | { table: string; key: string; kind: "deleted"; before: Row }
  | { table: string; key: string; kind: "updated"; before: Row; after: Row; changedColumns: string[] };

export type TraceEvent =
  | { seq: number; kind: "statement"; sql: string; affectedRows?: number; warnings?: number }
  | { seq: number; kind: "milestone"; label: string }
  | { seq: number; kind: "trigger_effect"; trigger: string; table: string; key: string }
  | { seq: number; kind: "outcome"; status: ExecutionStatus }
  | { seq: number; kind: "error"; sqlState?: string; code?: string; message: string };

export type ExecutionStatus = "committed" | "rolled_back" | "failed" | "read_only";

export interface ExecutionTrace {
  executionId: string;
  scenarioId: string;
  operation: string;
  startedAt: string;
  finishedAt: string;
  status: ExecutionStatus;
  input: Record<string, unknown>;
  before: TableSnapshot[];
  after: TableSnapshot[];
  changes: RowChange[];
  events: TraceEvent[];
  result?: unknown;
  error?: { code?: string; sqlState?: string; message: string };
  provenance: Provenance;
}
