import type { Ontology } from "./schema.js";

const mermaidId = (slug: string) => slug.replace(/[^a-zA-Z0-9_]/g, "_");

const CARD: Record<string, string> = {
  "many-to-one": "}o--||",
  "one-to-many": "||--o{",
  "one-to-one": "||--||",
  "many-to-many": "}o--o{",
};

export function toMermaid(o: Ontology): string {
  const rejected = new Set(o.linkChecks.filter((c) => c.status === "rejected").map((c) => c.link));
  const lines = ["erDiagram"];
  for (const t of o.objectTypes) {
    lines.push(`  ${mermaidId(t.slug)} {`);
    const inherited = o.interfaces.filter((i) => t.interfaces.includes(i.slug)).flatMap((i) => i.properties);
    for (const p of [...t.properties, ...inherited]) {
      if (p.internal && !t.primaryKey.includes(p.slug)) continue;
      const key = t.primaryKey.includes(p.slug) ? " PK" : "";
      lines.push(`    ${p.kind} ${mermaidId(p.slug)}${key}`);
    }
    lines.push("  }");
  }
  for (const l of o.linkTypes) {
    if (rejected.has(l.slug)) continue;
    lines.push(`  ${mermaidId(l.from)} ${CARD[l.cardinality]} ${mermaidId(l.to)} : "${l.label.replace(/"/g, "'")}"`);
  }
  return lines.join("\n");
}

const pct = (n: number | null) => (n == null ? "–" : `${(n * 100).toFixed(n === 1 ? 0 : 1)}%`);

function keyNote(o: Ontology, type: string): string {
  const bad = o.keyChecks.filter((k) => k.type === type && k.status === "duplicates");
  if (bad.length === 0) return "";
  return " (not unique: " + bad.map((k) => `${k.distinct.toLocaleString("en-US")} distinct in ${k.rows.toLocaleString("en-US")} rows of ${k.table}`).join("; ") + ")";
}

export function toMarkdown(o: Ontology): string {
  const out: string[] = [];
  out.push(`# Ontology: ${o.source}`, "");
  if (o.problem) out.push(`> **Problem:** ${o.problem}`, "");
  out.push(o.summary, "");
  out.push("```mermaid", toMermaid(o), "```", "");

  out.push("## Object types", "");
  for (const t of o.objectTypes) {
    const ifaces = t.interfaces.length ? ` · implements ${t.interfaces.join(", ")}` : "";
    out.push(`### ${t.label} (\`${t.slug}\`)`, "", `${t.description}`, "", `Key: ${t.primaryKey.map((k) => `\`${k}\``).join(" + ")}${keyNote(o, t.slug)} · Name: \`${t.displayNameProperty}\`${ifaces}`, "");
    out.push("| Property | Kind | Description |", "|---|---|---|");
    for (const p of t.properties) out.push(`| \`${p.slug}\`${p.internal ? " _(internal)_" : ""} | ${p.kind} | ${p.description} |`);
    out.push("");
  }

  if (o.interfaces.length) {
    out.push("## Interfaces", "");
    for (const i of o.interfaces) out.push(`- **${i.label}** (\`${i.slug}\`): ${i.description} Properties: ${i.properties.map((p) => `\`${p.slug}\``).join(", ")}`);
    out.push("");
  }

  out.push("## Links (checked against the data)", "");
  out.push("| Link | From → To | Cardinality | Match | Status | Columns |", "|---|---|---|---|---|---|");
  for (const l of o.linkTypes) {
    const c = o.linkChecks.find((c) => c.link === l.slug);
    const card = c?.observedCardinality && c.observedCardinality !== l.cardinality && l.cardinality !== "many-to-many"
      ? `${l.cardinality} (data says ${c.observedCardinality})`
      : l.cardinality;
    out.push(
      `| ${l.label} / ${l.reverseLabel} | ${l.from} → ${l.to} | ${card} | ${pct(c?.matchRate ?? null)} | ${c?.status ?? "unchecked"} | ${c?.fromColumn ?? "?"} → ${c?.toColumn ?? "?"} |`,
    );
  }
  out.push("");

  out.push("## Source mappings", "");
  for (const m of o.mappings) {
    const used = m.columns.filter((c) => c.property).map((c) => `${c.column}→${c.property}`);
    const skipped = m.columns.filter((c) => !c.property).map((c) => c.column);
    out.push(`- **${m.table}** → \`${m.type}\`: ${used.join(", ")}${skipped.length ? ` · skipped: ${skipped.join(", ")}` : ""}`);
  }
  if (o.skippedTables.length) {
    out.push("", "## Not modelled", "");
    for (const t of o.skippedTables) out.push(`- **${t.table}**: ${t.reason}`);
  }
  out.push("", `_Generated ${o.generatedAt} by rhetra-ontology with ${o.model}._`, "");
  return out.join("\n");
}
