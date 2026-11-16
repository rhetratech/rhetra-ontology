/** One table, as much as the modeler needs to see of it. */
export interface TableSample {
  name: string;
  columns: string[];
  /** A handful of rows, used for profiling and as examples in the prompt. */
  rows: Record<string, unknown>[];
  rowCount: number;
}

/**
 * Where the data lives. Every source answers the same three questions, so the
 * inference and verification code never knows whether it's reading CSV files,
 * SQLite or Postgres.
 */
export interface Source {
  readonly label: string;
  listTables(): Promise<string[]>;
  sample(table: string, limit: number): Promise<TableSample>;
  /**
   * Distinct non-empty values of one column, as strings, capped at `limit`.
   * Used to check a proposed link against the full data, not the sample.
   */
  distinctValues(table: string, column: string, limit: number): Promise<Set<string>>;
  /** Row count, and how many distinct combinations of these columns exist. */
  keyStats(table: string, columns: string[]): Promise<{ rows: number; distinct: number }>;
  close(): Promise<void>;
}

/** CSV exports spell missing values many ways. They are all null. */
export function isBlank(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t === "" || t === "NULL" || t === "null" || t === "N/A" || t === "NaN";
}
