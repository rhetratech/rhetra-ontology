import type { Source } from "./sources/index.js";
import type { KeyCheck, LinkCheck, OntologyProposal } from "./schema.js";

const MAX_KEYS = 200_000;

/** Where a type's property physically lives: the first table/column mapped to it. */
function locate(p: OntologyProposal, type: string, property: string): { table: string; column: string } | null {
  for (const m of p.mappings) {
    if (m.type !== type) continue;
    const c = m.columns.find((c) => c.property === property);
    if (c) return { table: m.table, column: c.column };
  }
  return null;
}

/**
 * Check every proposed link against the full data. The model only saw a
 * profile, so a link is a hypothesis until the key values actually join.
 *
 * matchRate = share of distinct source-side key values that exist on the target side.
 *   ≥ 0.95 verified · ≥ 0.5 weak (dirty data or partial coverage) · below that rejected.
 */
export async function verifyLinks(source: Source, p: OntologyProposal): Promise<LinkCheck[]> {
  const checks: LinkCheck[] = [];
  for (const link of p.linkTypes) {
    const from = locate(p, link.from, link.fromProperty);
    const to = locate(p, link.to, link.toProperty);
    if (!from || !to) {
      checks.push({
        link: link.slug,
        fromColumn: from ? `${from.table}.${from.column}` : null,
        toColumn: to ? `${to.table}.${to.column}` : null,
        matchRate: null,
        sourceKeys: 0,
        observedCardinality: null,
        status: "unchecked",
        note: "a key property isn't mapped to any column",
      });
      continue;
    }

    const [fromKeys, toKeys] = await Promise.all([
      source.distinctValues(from.table, from.column, MAX_KEYS),
      source.distinctValues(to.table, to.column, MAX_KEYS),
    ]);
    // CSV and SQL disagree on "5" vs "5.0"; compare numbers as numbers.
    const norm = (v: string) => (v.trim() !== "" && !isNaN(Number(v)) ? String(Number(v)) : v.trim());
    const target = new Set([...toKeys].map(norm));
    let hit = 0;
    for (const k of fromKeys) if (target.has(norm(k))) hit++;
    const matchRate = fromKeys.size ? hit / fromKeys.size : 0;

    // One-to-one if every source row has its own key; otherwise many share a target.
    const { rowCount } = await source.sample(from.table, 0);
    const observedCardinality = matchRate >= 0.5 ? (fromKeys.size === rowCount ? "one-to-one" : "many-to-one") : null;

    checks.push({
      link: link.slug,
      fromColumn: `${from.table}.${from.column}`,
      toColumn: `${to.table}.${to.column}`,
      matchRate,
      sourceKeys: fromKeys.size,
      observedCardinality,
      status: fromKeys.size === 0 ? "rejected" : matchRate >= 0.95 ? "verified" : matchRate >= 0.5 ? "weak" : "rejected",
      note: fromKeys.size === 0 ? "source column is empty" : undefined,
    });
  }
  return checks;
}

/**
 * Check that each type's key identifies one row in every table mapped to it.
 * A key with duplicates would merge distinct objects when the data is loaded.
 */
export async function verifyKeys(source: Source, p: OntologyProposal): Promise<KeyCheck[]> {
  const checks: KeyCheck[] = [];
  for (const t of p.objectTypes) {
    for (const m of p.mappings.filter((m) => m.type === t.slug)) {
      const columns = t.primaryKey.map((prop) => m.columns.find((c) => c.property === prop)?.column);
      if (t.primaryKey.length === 0 || columns.some((c) => !c)) {
        checks.push({ type: t.slug, table: m.table, columns: columns.filter((c): c is string => !!c), rows: 0, distinct: 0, status: "unchecked", note: "a key property isn't mapped to a column in this table" });
        continue;
      }
      const cols = columns as string[];
      const { rows, distinct } = await source.keyStats(m.table, cols);
      checks.push({ type: t.slug, table: m.table, columns: cols, rows, distinct, status: distinct === rows ? "unique" : "duplicates" });
    }
  }
  return checks;
}
