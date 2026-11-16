import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parse } from "csv-parse/sync";
import { isBlank, type Source, type TableSample } from "./types.js";

/**
 * A directory of CSV files (or a single file). Each file is one table, named
 * after the file. Files are parsed once and held in memory: this tool is for
 * exploring a dataset, not for streaming a warehouse.
 */
export class CsvSource implements Source {
  readonly label: string;
  private files = new Map<string, string>();
  private cache = new Map<string, Record<string, string>[]>();

  private constructor(label: string) {
    this.label = label;
  }

  static async open(path: string): Promise<CsvSource> {
    const src = new CsvSource(path);
    const s = await stat(path);
    const paths = s.isDirectory()
      ? (await readdir(path)).filter((f) => extname(f).toLowerCase() === ".csv").sort().map((f) => join(path, f))
      : [path];
    if (paths.length === 0) throw new Error(`No .csv files found in ${path}`);
    for (const p of paths) src.files.set(basename(p, extname(p)), p);
    return src;
  }

  private async load(table: string): Promise<Record<string, string>[]> {
    const hit = this.cache.get(table);
    if (hit) return hit;
    const path = this.files.get(table);
    if (!path) throw new Error(`Unknown table: ${table}`);
    const rows = parse(await readFile(path), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
      trim: true,
    }) as Record<string, string>[];
    this.cache.set(table, rows);
    return rows;
  }

  async listTables(): Promise<string[]> {
    return [...this.files.keys()];
  }

  async sample(table: string, limit: number): Promise<TableSample> {
    const rows = await this.load(table);
    return {
      name: table,
      columns: rows.length > 0 ? Object.keys(rows[0]!) : [],
      rows: rows.slice(0, limit),
      rowCount: rows.length,
    };
  }

  async distinctValues(table: string, column: string, limit: number): Promise<Set<string>> {
    const out = new Set<string>();
    for (const r of await this.load(table)) {
      const v = r[column];
      if (isBlank(v)) continue;
      out.add(String(v));
      if (out.size >= limit) break;
    }
    return out;
  }

  async keyStats(table: string, columns: string[]): Promise<{ rows: number; distinct: number }> {
    const rows = await this.load(table);
    const seen = new Set(rows.map((r) => JSON.stringify(columns.map((c) => r[c] ?? null))));
    return { rows: rows.length, distinct: seen.size };
  }

  async close(): Promise<void> {}
}
