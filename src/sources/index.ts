import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { CsvSource } from "./csv.js";
import type { Source } from "./types.js";

export type { Source, TableSample } from "./types.js";
export { CsvSource } from "./csv.js";

/**
 * Turn whatever the user typed into a source:
 *   postgres://… / postgresql://…  → Postgres
 *   *.db / *.sqlite / *.sqlite3     → SQLite
 *   a directory or *.csv            → CSV
 */
export async function openSource(target: string, opts: { schema?: string } = {}): Promise<Source> {
  if (/^postgres(ql)?:\/\//i.test(target)) {
    const { PostgresSource } = await import("./sql.js");
    return new PostgresSource(target, opts.schema);
  }
  const ext = extname(target).toLowerCase();
  if ([".db", ".sqlite", ".sqlite3"].includes(ext)) {
    // Loaded lazily: node:sqlite prints an experimental warning on import.
    const { SqliteSource } = await import("./sql.js");
    return new SqliteSource(target);
  }
  const s = await stat(target).catch(() => null);
  if (!s) throw new Error(`Not found: ${target}`);
  if (s.isDirectory() || ext === ".csv") return CsvSource.open(target);
  throw new Error(`Don't know how to read ${target}. Give a CSV directory, a .csv, a .sqlite/.db file, or a postgres:// URL.`);
}
