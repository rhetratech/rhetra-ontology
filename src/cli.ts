#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { generateOntology } from "./index.js";
import { DEFAULT_CLAUDE_MODEL, DEFAULT_OPENROUTER_MODEL } from "./infer.js";
import { toMarkdown, toMermaid } from "./render.js";

const HELP = `rhetra-ontology: turn your tables into a verified ontology

Usage
  rhetra-ontology <source> [--problem "..."] [options]
  rhetra-ontology mcp                      run as an MCP server (stdio)

Source
  ./data/              a directory of CSV files (one table per file)
  orders.csv           a single CSV
  shop.sqlite          a SQLite file
  postgres://...       a Postgres database

Options
  -p, --problem <text>   the question you're trying to answer; drives the model
  -o, --out <dir>        output directory (default: ./ontology)
  -t, --tables <a,b>     only these tables
      --schema <name>    Postgres schema (default: public)
  -m, --model <id>       claude-* runs on Anthropic, vendor/model on OpenRouter
                         (default: ${DEFAULT_CLAUDE_MODEL} with an Anthropic key,
                          ${DEFAULT_OPENROUTER_MODEL} with an OpenRouter key)
  -e, --effort <level>   Claude only: low | medium | high | xhigh | max (default: medium)
      --json             print the ontology JSON to stdout instead of writing files
  -h, --help

Needs ANTHROPIC_API_KEY or OPENROUTER_API_KEY in the environment.`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      problem: { type: "string", short: "p" },
      out: { type: "string", short: "o", default: "ontology" },
      tables: { type: "string", short: "t" },
      schema: { type: "string" },
      model: { type: "string", short: "m" },
      effort: { type: "string", short: "e" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (positionals[0] === "mcp") {
    const { runMcpServer } = await import("./mcp.js");
    return runMcpServer();
  }
  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }

  const effort = values.effort as "low" | "medium" | "high" | "xhigh" | "max" | undefined;
  if (effort && !["low", "medium", "high", "xhigh", "max"].includes(effort)) throw new Error(`Unknown effort: ${effort}`);

  const started = Date.now();
  const log = (s: string) => process.stderr.write(`\x1b[2m›\x1b[0m ${s}\n`);
  const o = await generateOntology(positionals[0]!, {
    problem: values.problem,
    tables: values.tables?.split(",").map((s) => s.trim()).filter(Boolean),
    schema: values.schema,
    model: values.model,
    effort,
    onStep: log,
  });

  if (values.json) {
    process.stdout.write(JSON.stringify(o, null, 2) + "\n");
    return;
  }

  const dir = values.out!;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "ontology.json"), JSON.stringify(o, null, 2) + "\n");
  await writeFile(join(dir, "ontology.md"), toMarkdown(o));
  await writeFile(join(dir, "ontology.mmd"), toMermaid(o) + "\n");

  const count = (s: string) => o.linkChecks.filter((c) => c.status === s).length;
  const dupKeys = o.keyChecks.filter((k) => k.status === "duplicates").length;
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.error(
    `\n${o.objectTypes.length} object types · ${o.interfaces.length} interfaces · ${o.linkTypes.length} links ` +
      `(${count("verified")} verified, ${count("weak")} weak, ${count("rejected")} rejected)` +
      (dupKeys ? ` · ${dupKeys} key${dupKeys > 1 ? "s" : ""} not unique` : "") +
      ` in ${secs}s`,
  );
  console.error(`Wrote ${join(dir, "ontology.md")}, ontology.json, ontology.mmd`);
}

main().catch((err) => {
  console.error(`\x1b[31merror:\x1b[0m ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
