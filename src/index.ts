import { inferOntology, type InferOptions } from "./infer.js";
import { profileSource } from "./profile.js";
import type { Ontology } from "./schema.js";
import { openSource, type Source } from "./sources/index.js";
import { verifyKeys, verifyLinks } from "./verify.js";

export * from "./schema.js";
export { inferOntology, defaultModel, MODELING_PRINCIPLES, DEFAULT_CLAUDE_MODEL, DEFAULT_OPENROUTER_MODEL } from "./infer.js";
export { profileSource, renderProfiles } from "./profile.js";
export { verifyKeys, verifyLinks } from "./verify.js";
export { toMarkdown, toMermaid } from "./render.js";
export { openSource, CsvSource } from "./sources/index.js";
export type { Source, TableSample } from "./sources/index.js";

export interface GenerateOptions extends InferOptions {
  tables?: string[];
  schema?: string;
  sampleRows?: number;
  onStep?: (step: string) => void;
}

/** Profile → infer → verify, end to end. */
export async function generateOntology(target: string | Source, opts: GenerateOptions = {}): Promise<Ontology> {
  const step = opts.onStep ?? (() => {});
  const source = typeof target === "string" ? await openSource(target, { schema: opts.schema }) : target;
  try {
    step(`Profiling ${source.label}`);
    const profiles = await profileSource(source, { tables: opts.tables, sampleRows: opts.sampleRows });
    if (profiles.length === 0) throw new Error("No tables found.");
    step(`Modelling ${profiles.length} tables${opts.problem ? " around your problem" : ""}`);
    const { proposal, model } = await inferOntology(profiles, opts);
    step(`Checking ${proposal.objectTypes.length} keys and ${proposal.linkTypes.length} links against the data`);
    const linkChecks = await verifyLinks(source, proposal);
    const keyChecks = await verifyKeys(source, proposal);
    // The model is asked to account for every table; fill in any it forgot.
    const covered = new Set([...proposal.mappings.map((m) => m.table), ...proposal.skippedTables.map((t) => t.table)]);
    for (const t of profiles) if (!covered.has(t.name)) proposal.skippedTables.push({ table: t.name, reason: "Not modelled; the model gave no reason." });
    return {
      ...proposal,
      source: source.label,
      problem: opts.problem?.trim() || null,
      model,
      generatedAt: new Date().toISOString(),
      linkChecks,
      keyChecks,
    };
  } finally {
    if (typeof target === "string") await source.close();
  }
}
