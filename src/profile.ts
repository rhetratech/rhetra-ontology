import type { Source } from "./sources/index.js";
import { isBlank } from "./sources/types.js";

export interface ColumnProfile {
  name: string;
  kind: "text" | "number" | "boolean" | "date";
  nullRate: number;
  /** Every non-null sample value was distinct: a primary-key candidate. */
  uniqueInSample: boolean;
  examples: string[];
}

export interface TableProfile {
  name: string;
  rowCount: number;
  columns: ColumnProfile[];
}

const DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?|^\d{1,2}\/\d{1,2}\/\d{4}$/;
const BOOL = new Set(["true", "false", "yes", "no", "t", "f", "y", "n"]);

function kindOf(values: unknown[]): ColumnProfile["kind"] {
  if (values.length === 0) return "text";
  const s = values.map((v) => (v instanceof Date ? v.toISOString() : String(v).trim()));
  const share = (pred: (x: string) => boolean) => s.filter(pred).length / s.length;
  if (values.every((v) => typeof v === "boolean") || share((x) => BOOL.has(x.toLowerCase())) === 1) return "boolean";
  if (share((x) => x !== "" && !isNaN(Number(x))) > 0.9) return "number";
  if (values.some((v) => v instanceof Date) || share((x) => DATE.test(x)) > 0.8) return "date";
  return "text";
}

export function profileColumns(columns: string[], rows: Record<string, unknown>[]): ColumnProfile[] {
  return columns.map((name) => {
    const all = rows.map((r) => r[name]);
    const present = all.filter((v) => !isBlank(v));
    const distinct = new Set(present.map(String));
    return {
      name,
      kind: kindOf(present),
      nullRate: all.length ? 1 - present.length / all.length : 0,
      uniqueInSample: present.length > 1 && distinct.size === present.length,
      examples: [...distinct].slice(0, 3).map((v) => (v.length > 60 ? v.slice(0, 57) + "..." : v)),
    };
  });
}

export async function profileSource(
  source: Source,
  opts: { tables?: string[]; sampleRows?: number } = {},
): Promise<TableProfile[]> {
  const names = opts.tables?.length ? opts.tables : await source.listTables();
  const out: TableProfile[] = [];
  for (const name of names) {
    const s = await source.sample(name, opts.sampleRows ?? 200);
    out.push({ name, rowCount: s.rowCount, columns: profileColumns(s.columns, s.rows) });
  }
  return out;
}

/** The profile as the model reads it: compact, one line per column. */
export function renderProfiles(profiles: TableProfile[]): string {
  return profiles
    .map((t) => {
      const cols = t.columns
        .map((c) => {
          const flags = [c.kind, c.uniqueInSample ? "unique in sample" : null, c.nullRate > 0 ? `${Math.round(c.nullRate * 100)}% null` : null]
            .filter(Boolean)
            .join(", ");
          return `  - ${c.name} (${flags}): ${c.examples.map((e) => JSON.stringify(e)).join(", ")}`;
        })
        .join("\n");
      return `### Table "${t.name}" (${t.rowCount.toLocaleString("en-US")} rows)\n${cols}`;
    })
    .join("\n\n");
}
