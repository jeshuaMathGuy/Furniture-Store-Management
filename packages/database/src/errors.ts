export class DomainError extends Error {
  constructor(message: string, readonly sqlState?: string, readonly code?: string) {
    super(message);
    this.name = "DomainError";
  }
}

interface MysqlError { sqlState?: string; code?: string; errno?: number; sqlMessage?: string; message: string }

/** SIGNAL SQLSTATE '45000' from triggers/procedures and constraint failures become DomainErrors carrying the real MySQL text. */
export function mapDbError(err: unknown): never {
  const e = err as MysqlError;
  if (!e) throw err;
  // Observed on MySQL 8.0.43: through the least-privilege furni_app user an FK violation is reported with the
  // generic codes 1216/1217 (no constraint details), while root sees 1452/1451. Both forms are mapped.
  if (e.code === "ER_NO_REFERENCED_ROW") throw new DomainError("A referenced record does not exist (foreign key check failed)", e.sqlState, e.code);
  if (e.code === "ER_ROW_IS_REFERENCED") throw new DomainError("This record is still referenced by other records (foreign key check failed)", e.sqlState, e.code);
  if (e.sqlState === "45000" || e.code === "ER_CHECK_CONSTRAINT_VIOLATED" || e.code === "ER_DUP_ENTRY"
      || e.code === "ER_NO_REFERENCED_ROW_2" || e.code === "ER_ROW_IS_REFERENCED_2") {
    throw new DomainError(e.sqlMessage ?? e.message, e.sqlState, e.code);
  }
  throw err;
}
