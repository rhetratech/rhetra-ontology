import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generateOntology } from "./index.js";
import { openSource } from "./sources/index.js";
import { profileSource, renderProfiles } from "./profile.js";
import { toMarkdown } from "./render.js";

/** Expose the generator to agents: profile a source, then build an ontology for a question. */
export async function runMcpServer(): Promise<void> {
  const server = new McpServer({ name: "rhetra-ontology", version: "0.1.0" });

  server.registerTool(
    "profile_source",
    {
      description: "List the tables in a data source and profile their columns (kinds, uniqueness, nulls, examples). Cheap, no model call.",
      inputSchema: {
        source: z.string().describe("CSV directory, .csv file, .sqlite/.db file, or postgres:// URL"),
        tables: z.array(z.string()).optional(),
      },
    },
    async ({ source, tables }) => {
      const src = await openSource(source);
      try {
        const profiles = await profileSource(src, { tables });
        return { content: [{ type: "text", text: renderProfiles(profiles) }] };
      } finally {
        await src.close();
      }
    },
  );

  server.registerTool(
    "infer_ontology",
    {
      description:
        "Build an ontology (object types, properties, interfaces, links) for a data source, shaped around the problem the user is trying to solve. Every link is checked against the full data. Returns a Markdown report followed by the JSON.",
      inputSchema: {
        source: z.string().describe("CSV directory, .csv file, .sqlite/.db file, or postgres:// URL"),
        problem: z.string().optional().describe("The question the ontology must serve, in the user's words"),
        tables: z.array(z.string()).optional(),
      },
    },
    async ({ source, problem, tables }) => {
      const o = await generateOntology(source, { problem, tables });
      return {
        content: [
          { type: "text", text: toMarkdown(o) },
          { type: "text", text: JSON.stringify(o) },
        ],
      };
    },
  );

  await server.connect(new StdioServerTransport());
}
