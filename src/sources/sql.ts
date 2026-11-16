import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { isBlank, type Source, type TableSample } from "./types.js";

const quote = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

/** A SQLite file, read-only, through Node's built-in driver. */
export class SqliteSource implements Source {
  readonly label: string;
  private db: DatabaseSync;

  constructor(path: string) {
    this.label = path;
    this.db = new DatabaseSync(path, { readOnly: true });
  }

  async listTables(): Promise<string[]> {
    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  async sample(table: string, limit: number): Promise<TableSample> {
    const rows = this.db.prepare(`SELECT * FROM ${quote(table)} LIMIT ?`).all(limit) as Record<string, unknown>[];
    const cols = (this.db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]).map((c) => c.name);
    const { n } = this.db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get() as { n: number };
    return { name: table, columns: cols, rows, rowCount: Number(n) };
  }

  async distinctValues(table: string, column: string, limit: number): Promise<Set<string>> {
    const rows = this.db
      .prepare(`SELECT DISTINCT ${quote(column)} AS v FROM ${quote(table)} WHERE ${quote(column)} IS NOT NULL LIMIT ?`)
      .all(limit) as { v: unknown }[];
    return new Set(rows.filter((r) => !isBlank(r.v)).map((r) => String(r.v)));
  }

  async keyStats(table: string, columns: string[]): Promise<{ rows: number; distinct: number }> {
    const cols = columns.map(quote).join(", ");
    const { rows } = this.db.prepare(`SELECT COUNT(*) AS rows FROM ${quote(table)}`).get() as { rows: number };
    const { d } = this.db.prepare(`SELECT COUNT(*) AS d FROM (SELECT DISTINCT ${cols} FROM ${quote(table)})`).get() as { d: number };
    return { rows: Number(rows), distinct: Number(d) };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/** A Postgres database. Tables come from one schema, `public` unless told otherwise. */
export class PostgresSource implements Source {
  readonly label: string;
  private pool: pg.Pool;
  private schema: string;

  constructor(url: string, schema = "public") {
    const u = new URL(url);
    this.label = `postgres://${u.host}${u.pathname}`; // never echo credentials
    this.pool = new pg.Pool({ connectionString: url, max: 4 });
    this.schema = schema;
  }

  private ref(table: string) {
    return `${quote(this.schema)}.${quote(table)}`;
  }

  async listTables(): Promise<string[]> {
    const { rows } = await this.pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
      [this.schema],
    );
    return rows.map((r) => r.table_name);
  }

  async sample(table: string, limit: number): Promise<TableSample> {
    const res = await this.pool.query(`SELECT * FROM ${this.ref(table)} LIMIT $1`, [limit]);
    const count = await this.pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${this.ref(table)}`);
    return {
      name: table,
      columns: res.fields.map((f) => f.name),
      rows: res.rows,
      rowCount: Number(count.rows[0]?.n ?? 0),
    };
  }

  async distinctValues(table: string, column: string, limit: number): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ v: unknown }>(
      `SELECT DISTINCT ${quote(column)}::text AS v FROM ${this.ref(table)} WHERE ${quote(column)} IS NOT NULL LIMIT $1`,
      [limit],
    );
    return new Set(rows.filter((r) => !isBlank(r.v)).map((r) => String(r.v)));
  }

  async keyStats(table: string, columns: string[]): Promise<{ rows: number; distinct: number }> {
    const cols = columns.map(quote).join(", ");
    const { rows } = await this.pool.query<{ rows: string; d: string }>(
      `SELECT (SELECT COUNT(*) FROM ${this.ref(table)}) AS rows, (SELECT COUNT(*) FROM (SELECT DISTINCT ${cols} FROM ${this.ref(table)}) k) AS d`,
    );
    return { rows: Number(rows[0]?.rows ?? 0), distinct: Number(rows[0]?.d ?? 0) };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
