import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { renderProfiles, type TableProfile } from "./profile.js";
import { z } from "zod";
import { OntologyProposal } from "./schema.js";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";
export const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.7-flash";
/** Kept for the CLI help text: what runs when no model is named and a Claude key is set. */
export const DEFAULT_MODEL = DEFAULT_CLAUDE_MODEL;

/**
 * Which model runs when none is named: Claude if there's an Anthropic key,
 * otherwise a strong open-weight model through OpenRouter.
 */
export function defaultModel(): string {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return DEFAULT_CLAUDE_MODEL;
  if (process.env.OPENROUTER_API_KEY) return DEFAULT_OPENROUTER_MODEL;
  throw new Error("No model key found. Set ANTHROPIC_API_KEY (Claude) or OPENROUTER_API_KEY (any OpenRouter model).");
}

/** OpenRouter ids are vendor/model; Claude ids have no slash. */
export const isOpenRouterModel = (model: string) => model.includes("/");

export const MODELING_PRINCIPLES = `## Modeling principles

**Model reality, not tables.** Object types are real-world things (Customer, Order, Product), not database tables. If one row describes two kinds of thing (a company and its factory, a person and their account), split it into two types.

**Never create abstraction types.** A type named node, edge, item, record, entry or element is an analysis artifact. Find the noun a domain person would say out loud.

**The correction test.** Pick a likely future fact ("this supplier went out of business"). It must land as one edit on one object. If it would mean editing several rows, or a text column on some other type, the entities are conflated: split them.

**A relationship with data is a junction object.** When an edge carries its own properties (quantity, price, contract status, dates), model it as an object type with links to both ends.

**Curate.** Every property needs business value. Skip system and audit columns (created_by, row_version) unless they mean something, and skip redundant or computed columns. Foreign-key columns a link captures stay, marked internal.

**Interfaces for shared capabilities.** When two or more types share a group of properties (street/city/country → Addressable, phone/email → Contactable), extract an interface. Never create one only a single type implements. Implementing types don't repeat its properties.

**Links are relationships, not FK artifacts.** Business verb phrases: "Placed By" (Order → Customer) with reverse "Has Orders"; "Reports To" (Employee → Employee) with reverse "Manages". Both must read naturally as [source] [label] [target].

**Cardinality from the data.** order → customer is many-to-one; product ↔ order through an order line is many-to-many via a junction; employee → manager is a self-referential many-to-one.

**Primary key ≠ display name.** The primary key links (customer-id). The display name is what people read (company-name). Choose both deliberately.

**Business language everywhere.** Slugs like last-inspection-date, never dtLastInspMod. Every type, property, interface and link gets a one-sentence description of what it means in the business: "Amount" must say gross or net, which currency, as of when, when the data lets you tell.`;

const SYSTEM = `You are a senior ontology engineer. You turn raw tables into an ontology: the real-world things a business operates on, their properties, and how they relate. The output becomes a production semantic layer that people and AI agents query, so model the world, not the source system.

${MODELING_PRINCIPLES}

## Output mechanics
- Use exact table and column names from the profile in \`mappings\`. Map every table you model; a column that carries nothing worth keeping maps to null.
- A table you leave out goes in \`skippedTables\` with a one-sentence reason (irrelevant to the problem, a log or system table, duplicated elsewhere). Every source table appears in exactly one of the two.
- A property referenced by a mapping, primaryKey, displayNameProperty or a link must exist on that type or one of its interfaces.
- primaryKey must identify exactly one row. Use one property when a column is unique; when none is (junction tables such as order lines), list the properties that are unique together. Keys are checked against the full data.
- Mark the source-side key column of every link \`internal: true\`.
- Links are checked against the full data after you answer, by matching values of fromProperty's column against toProperty's column. Propose a link only where the values actually join.`;

export interface InferOptions {
  /** The question the person is trying to answer. Drives what gets modelled. */
  problem?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  client?: Anthropic;
}

export interface InferResult {
  proposal: OntologyProposal;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export async function inferOntology(profiles: TableProfile[], opts: InferOptions = {}): Promise<InferResult> {
  const model = opts.model ?? defaultModel();

  // The problem goes FIRST. A model that reads the schema first models the
  // schema; one that reads the question first models the question and treats
  // the columns as evidence.
  const problem = opts.problem?.trim();
  const problemBlock = problem
    ? `The problem this ontology must serve, in the person's own words:\n"""\n${problem}\n"""\nModel what this problem needs. The tables below are evidence about the domain, not the agenda: a column nobody asked about is still worth modelling if it belongs to a concept the problem touches, and a table that holds two concepts is still two types.\n\n`
    : "";
  const user = `${problemBlock}Here is a profile of the source data (types and uniqueness are from a sample):\n\n${renderProfiles(profiles)}\n\nPropose the ontology.`;

  return isOpenRouterModel(model) ? inferViaOpenRouter(model, user) : inferViaClaude(model, user, opts);
}

async function inferViaClaude(model: string, user: string, opts: InferOptions): Promise<InferResult> {
  const client = opts.client ?? new Anthropic();
  const stream = client.beta.messages.stream({
    model,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort ?? "medium", format: zodOutputFormat(OntologyProposal) },
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  const msg = await stream.finalMessage();

  if (msg.stop_reason === "refusal") throw new Error("The model declined to answer this request.");
  if (msg.stop_reason === "max_tokens") throw new Error("The proposal was cut off (max_tokens). Try fewer tables with --tables.");

  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return {
    proposal: parseProposal(text),
    model: msg.model,
    usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
  };
}

/**
 * Any OpenRouter model, through its chat-completions API. Structured output
 * support varies by model, so the schema is also spelled out in the prompt and
 * a reply that fails validation gets one repair round with the errors.
 */
async function inferViaOpenRouter(model: string, user: string): Promise<InferResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error(`${model} runs through OpenRouter: set OPENROUTER_API_KEY.`);
  const schema = z.toJSONSchema(OntologyProposal);
  const messages: { role: string; content: string }[] = [
    { role: "system", content: `${SYSTEM}\n\nAnswer with one JSON object matching this JSON Schema, nothing else:\n${JSON.stringify(schema)}` },
    { role: "user", content: user },
  ];
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "rhetra-ontology",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 32000,
        response_format: { type: "json_schema", json_schema: { name: "ontology_proposal", strict: true, schema } },
        provider: { require_parameters: false },
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    if (data.error) throw new Error(`OpenRouter: ${data.error.message}`);
    usage.inputTokens += data.usage?.prompt_tokens ?? 0;
    usage.outputTokens += data.usage?.completion_tokens ?? 0;
    const text = data.choices?.[0]?.message?.content ?? "";
    if (data.choices?.[0]?.finish_reason === "length") throw new Error("The proposal was cut off. Try fewer tables with --tables.");
    try {
      return { proposal: parseProposal(text), model: data.model ?? model, usage };
    } catch (err) {
      if (attempt === 1) throw err;
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: `That reply did not validate: ${err instanceof Error ? err.message.slice(0, 1500) : err}\nReturn the corrected JSON object only.` });
    }
  }
  throw new Error("unreachable");
}

function parseProposal(text: string): OntologyProposal {
  // Some models wrap JSON in a code fence even when asked not to.
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("The model returned something that isn't JSON.");
  }
  return OntologyProposal.parse(parsed);
}
