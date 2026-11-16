import { z } from "zod";

// The shape the model must return. Kept free of open-ended records (column
// mappings are arrays of pairs) so it works under strict structured outputs.

export const Property = z.object({
  slug: z.string().describe("lowercase kebab-case, e.g. last-inspection-date"),
  label: z.string().describe("Business-language label, e.g. Last Inspection Date"),
  kind: z.enum(["text", "number", "boolean", "date"]),
  required: z.boolean(),
  description: z.string().describe("One sentence on what this property means in the business"),
  internal: z
    .boolean()
    .describe("true for foreign-key columns a link type fully captures: needed for linking, hidden from people"),
});

export const Interface = z.object({
  slug: z.string().describe("kebab-case, e.g. addressable"),
  label: z.string(),
  description: z.string().describe("What capability this interface models"),
  properties: z.array(Property),
});

export const ObjectType = z.object({
  slug: z.string().describe("kebab-case noun, e.g. customer, order-line"),
  label: z.string().describe("Business-language label, e.g. Customer (not tbl_customer)"),
  description: z.string().describe("One sentence on what real-world thing this is"),
  primaryKey: z
    .array(z.string())
    .describe("slug(s) of the properties that together identify one object. Usually one. Several only when no single column is unique, e.g. an order line identified by order + product"),
  displayNameProperty: z.string().describe("slug of the most human-readable property, shown as the object's name"),
  interfaces: z.array(z.string()).describe("slugs of interfaces this type implements; their properties are not repeated here"),
  properties: z.array(Property),
});

export const ColumnMapping = z.object({
  column: z.string().describe("Exact column name in the source table"),
  property: z.string().nullable().describe("Property slug (on the type or one of its interfaces), or null to skip the column"),
});

export const TableMapping = z.object({
  table: z.string().describe("Exact source table name"),
  type: z.string().describe("slug of the object type these rows become"),
  columns: z.array(ColumnMapping),
});

export const LinkType = z.object({
  slug: z.string().describe("kebab-case, e.g. order-placed-by"),
  label: z.string().describe("Business verb phrase read as [source] [label] [target], e.g. Placed By"),
  reverseLabel: z.string().describe("Reads as [target] [reverse label] [source], e.g. Has Orders"),
  from: z.string().describe("source object type slug"),
  to: z.string().describe("target object type slug"),
  fromProperty: z.string().describe("property slug on the source type holding the key value"),
  toProperty: z.string().describe("property slug on the target type it matches, usually the target's primary key"),
  cardinality: z.enum(["one-to-one", "one-to-many", "many-to-one", "many-to-many"]),
  description: z.string(),
});

export const OntologyProposal = z.object({
  summary: z.string().describe("Two or three sentences: what this ontology models and how it answers the problem, if one was given"),
  interfaces: z.array(Interface),
  objectTypes: z.array(ObjectType),
  linkTypes: z.array(LinkType),
  mappings: z.array(TableMapping),
  skippedTables: z
    .array(z.object({ table: z.string(), reason: z.string().describe("One sentence: why this table isn't modelled") }))
    .describe("Every source table not covered by mappings, with the reason"),
});

export type Property = z.infer<typeof Property>;
export type ObjectType = z.infer<typeof ObjectType>;
export type LinkType = z.infer<typeof LinkType>;
export type TableMapping = z.infer<typeof TableMapping>;
export type OntologyProposal = z.infer<typeof OntologyProposal>;

/** What the data said about a proposed link. */
export interface LinkCheck {
  link: string;
  fromColumn: string | null;
  toColumn: string | null;
  /** Share of distinct source key values found among the target's values. */
  matchRate: number | null;
  sourceKeys: number;
  observedCardinality: "one-to-one" | "many-to-one" | null;
  status: "verified" | "weak" | "rejected" | "unchecked";
  note?: string;
}

/** Whether a type's key really identifies one row, checked on the full table. */
export interface KeyCheck {
  type: string;
  table: string;
  columns: string[];
  rows: number;
  distinct: number;
  status: "unique" | "duplicates" | "unchecked";
  note?: string;
}

export interface Ontology extends OntologyProposal {
  source: string;
  problem: string | null;
  model: string;
  generatedAt: string;
  linkChecks: LinkCheck[];
  keyChecks: KeyCheck[];
}
