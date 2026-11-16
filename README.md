# rhetra-ontology

Point it at a folder of CSVs, a SQLite file or a Postgres database. It works out the real-world objects in your data, how they relate, and checks every relationship against the actual rows.

```bash
npx rhetra-ontology ./data
```

A database describes how software stores things. An ontology describes the business: customers, orders, suppliers, and the links between them. Teams usually build one by hand over weeks. This gets you a solid first draft in under a minute.

The modelling follows the same rules as operational platforms like Palantir Foundry. Objects are things you could point at. Relationships get names that read naturally in both directions. Fields shared across types become interfaces. A row that describes two different things gets split into two types.

## Example

The Northwind sample database, 7 CSVs and about 3,200 rows:

```
$ npx rhetra-ontology examples/northwind
› Profiling examples/northwind
› Modelling 7 tables
› Checking 7 links against the data

7 object types · 2 interfaces · 7 links (7 verified, 0 weak, 0 rejected) in 39s
Wrote ontology/ontology.md, ontology.json, ontology.mmd
```

```mermaid
erDiagram
  customer ||--o{ order : "Has Orders"
  employee ||--o{ order : "Handled Orders"
  order ||--o{ order_line : "Has Order Lines"
  product ||--o{ order_line : "Ordered In"
  supplier ||--o{ product : "Supplies Products"
  category ||--o{ product : "Contains Products"
  employee ||--o{ employee : "Manages"
```

| Link | From → To | Match | Status |
|---|---|---|---|
| Placed By / Has Orders | order → customer | 100% | verified |
| Handled By / Handled Orders | order → employee | 100% | verified |
| Belongs To / Has Order Lines | order-line → order | 100% | verified |
| Purchases / Ordered In | order-line → product | 100% | verified |
| Supplied By / Supplies Products | product → supplier | 100% | verified |
| Categorized Under / Contains Products | product → category | 100% | verified |
| Reports To / Manages | employee → employee | 100% | verified |

It also pulled out two interfaces, Addressable and Contactable, since customers and suppliers share address and phone fields. Every type and property comes with a one-line description, and the report lists which source column feeds which property, plus any tables it left out and why.

You get three files:

- `ontology.md` is the report you read, diagram included
- `ontology.json` has everything, for code
- `ontology.mmd` is the full Mermaid diagram

## Checked against your data

The model only ever sees a short profile of each table, so it can guess wrong. After it answers, every proposed link is tested against the full data: take the distinct key values on one side and count how many show up on the other.

- **verified**: 95% or more match
- **weak**: 50 to 95%, usually dirty data or partial coverage
- **rejected**: under 50%, left out of the diagram
- **unchecked**: the link refers to a property that no column maps to

If the data suggests a different cardinality than the model picked, the report says so.

Keys get the same treatment. Each type's key is checked for duplicates across the whole table, and when no single column is unique (an order line is identified by order + product), the key can span several columns.

This catches real mistakes. On the same Northwind data, a cheaper model proposed 7 links and 5 of them pointed at properties that didn't exist.

## Asking a question

```bash
npx rhetra-ontology ./data --problem "Which suppliers cause late shipments, and which customers do those delays hit?"
```

Optional. When you pass one, the model reads it before it looks at the data and uses it to decide what's in scope and what to explain. For the question above, the summary spells out that a late shipment means `shippedDate > requiredDate` and walks you through Order Line → Product → Supplier. Tables that don't matter for the question show up under "Not modelled" with a reason.

## Sources

```bash
npx rhetra-ontology ./exports/              # folder of CSVs, one table per file
npx rhetra-ontology orders.csv              # single CSV
npx rhetra-ontology shop.sqlite             # SQLite, opened read-only
npx rhetra-ontology postgres://user:pass@host/db --schema public
```

Use `--tables orders,customers` to limit it to some tables.

## Models

Set whichever key you have:

| Environment variable | Default model |
|---|---|
| `ANTHROPIC_API_KEY` | `claude-opus-5-5` |
| `OPENROUTER_API_KEY` | `google/gemini-3.7-flash` |

Pick another with `--model`. Anything with a slash, like `deepseek/deepseek-v4-pro`, goes through OpenRouter. Anything else goes to Anthropic. With Claude you can also pass `--effort low|medium|high|xhigh|max`.

## Using it from an agent (MCP)

```json
{
  "mcpServers": {
    "ontology": {
      "command": "npx",
      "args": ["-y", "rhetra-ontology", "mcp"],
      "env": { "OPENROUTER_API_KEY": "..." }
    }
  }
}
```

This adds two tools to Claude Desktop, Claude Code, Cursor or anything else that speaks MCP:

- `profile_source` lists tables and profiles their columns, with no model call
- `infer_ontology` returns the full report and the JSON, with an optional `problem`

## Using it as a library

```ts
import { generateOntology } from "rhetra-ontology";

const ontology = await generateOntology("./data", { problem: "Which suppliers are late?" });
console.log(ontology.objectTypes.map((t) => t.label));
console.log(ontology.linkChecks.filter((c) => c.status !== "verified"));
```

The individual steps (`openSource`, `profileSource`, `inferOntology`, `verifyLinks`) are exported too, in case you want your own data source or a review step in between.

## Notes

Column types are guessed from a 200-row sample. CSVs are loaded into memory, so this is meant for exploring datasets, not for scanning a warehouse. Treat the output as a draft and read it before building on it.

Needs Node 22.13 or newer.

## About Rhetra

This is the ontology engine from [Rhetra](https://github.com/rhetratech), a self-hosted operational platform built in Europe. In Rhetra the ontology is the starting point: pipelines fill it with data, actions and workflows update it, AI functions work on top of it, and apps are built on all of that.

If you want to do more with your ontology than read it, [get in touch](https://github.com/rhetratech).

## License

Apache 2.0
