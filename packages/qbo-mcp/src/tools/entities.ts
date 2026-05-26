import { z } from "zod";
import { qboQuery, qboRequest, resolveClient } from "../qbo-client.js";
import { schemaToJson } from "./json-schema.js";
import { tool, type ToolDef } from "./types.js";

const ClientField = z.string().optional().describe("Realm id or friendly name. Omit for active client.");

function sanitize(value: string): string {
  // QuickBooks Query Language strings are wrapped in single quotes; escape inner quotes.
  return value.replace(/'/g, "\\'");
}

function buildWhereClause(parts: Array<string | null | undefined>): string {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length ? ` WHERE ${kept.join(" AND ")}` : "";
}

const CustomersInput = z.object({
  client: ClientField,
  search: z
    .string()
    .optional()
    .describe("Partial display name match (case-insensitive)."),
  active_only: z.boolean().default(true).describe("Only return Active customers."),
  limit: z.number().int().positive().max(1000).default(100),
  offset: z.number().int().min(1).default(1).describe("1-based offset for pagination."),
});

const InvoicesInput = z.object({
  client: ClientField,
  customer_id: z.string().optional().describe("Filter to a specific customer id."),
  start_date: z.string().optional().describe("TxnDate >= this date (YYYY-MM-DD)."),
  end_date: z.string().optional().describe("TxnDate <= this date (YYYY-MM-DD)."),
  status: z
    .enum(["Open", "Paid", "Overdue", "All"])
    .default("All")
    .describe("Filter by payment status. 'Overdue' = open and past DueDate."),
  limit: z.number().int().positive().max(1000).default(50),
  offset: z.number().int().min(1).default(1),
});

const ItemsInput = z.object({
  client: ClientField,
  search: z.string().optional().describe("Partial name match (case-insensitive)."),
  active_only: z.boolean().default(true),
  limit: z.number().int().positive().max(1000).default(100),
  offset: z.number().int().min(1).default(1),
});

const GetByIdInput = z.object({
  client: ClientField,
  id: z.string().describe("Entity id."),
});

const VendorsInput = z.object({
  client: ClientField,
  search: z.string().optional(),
  active_only: z.boolean().default(true),
  limit: z.number().int().positive().max(1000).default(100),
  offset: z.number().int().min(1).default(1),
});

const CompanyInfoInput = z.object({ client: ClientField });

export const entityTools: ToolDef[] = [
  tool({
    name: "get_company_info",
    description:
      "Fetch CompanyInfo for the active (or specified) QuickBooks company — useful for verifying which company is connected.",
    schema: CompanyInfoInput,
    jsonSchema: schemaToJson(CompanyInfoInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      return qboRequest(config, store, client, `/companyinfo/${client.realmId}`);
    },
  }),
  tool({
    name: "list_customers",
    description: "List customers via the QBO Query API.",
    schema: CustomersInput,
    jsonSchema: schemaToJson(CustomersInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      const where = buildWhereClause([
        input.active_only ? "Active = true" : null,
        input.search
          ? `DisplayName LIKE '%${sanitize(input.search)}%'`
          : null,
      ]);
      const sql = `SELECT * FROM Customer${where} ORDERBY DisplayName STARTPOSITION ${input.offset} MAXRESULTS ${input.limit}`;
      return qboQuery(config, store, client, sql);
    },
  }),
  tool({
    name: "get_customer",
    description: "Fetch a single customer by id.",
    schema: GetByIdInput,
    jsonSchema: schemaToJson(GetByIdInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      return qboRequest(config, store, client, `/customer/${input.id}`);
    },
  }),
  tool({
    name: "list_vendors",
    description: "List vendors via the QBO Query API.",
    schema: VendorsInput,
    jsonSchema: schemaToJson(VendorsInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      const where = buildWhereClause([
        input.active_only ? "Active = true" : null,
        input.search
          ? `DisplayName LIKE '%${sanitize(input.search)}%'`
          : null,
      ]);
      const sql = `SELECT * FROM Vendor${where} ORDERBY DisplayName STARTPOSITION ${input.offset} MAXRESULTS ${input.limit}`;
      return qboQuery(config, store, client, sql);
    },
  }),
  tool({
    name: "list_invoices",
    description:
      "List invoices via the QBO Query API. Filter by customer, date range, and status.",
    schema: InvoicesInput,
    jsonSchema: schemaToJson(InvoicesInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      const today = new Date().toISOString().slice(0, 10);
      const filters: Array<string | null> = [
        input.customer_id ? `CustomerRef = '${sanitize(input.customer_id)}'` : null,
        input.start_date ? `TxnDate >= '${sanitize(input.start_date)}'` : null,
        input.end_date ? `TxnDate <= '${sanitize(input.end_date)}'` : null,
      ];
      if (input.status === "Open") filters.push("Balance > '0'");
      if (input.status === "Paid") filters.push("Balance = '0'");
      if (input.status === "Overdue")
        filters.push(`Balance > '0' AND DueDate < '${today}'`);
      const where = buildWhereClause(filters);
      const sql = `SELECT * FROM Invoice${where} ORDERBY TxnDate DESC STARTPOSITION ${input.offset} MAXRESULTS ${input.limit}`;
      return qboQuery(config, store, client, sql);
    },
  }),
  tool({
    name: "get_invoice",
    description: "Fetch a single invoice by id.",
    schema: GetByIdInput,
    jsonSchema: schemaToJson(GetByIdInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      return qboRequest(config, store, client, `/invoice/${input.id}`);
    },
  }),
  tool({
    name: "list_items",
    description: "List products & services (items) via the QBO Query API.",
    schema: ItemsInput,
    jsonSchema: schemaToJson(ItemsInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      const where = buildWhereClause([
        input.active_only ? "Active = true" : null,
        input.search ? `Name LIKE '%${sanitize(input.search)}%'` : null,
      ]);
      const sql = `SELECT * FROM Item${where} ORDERBY Name STARTPOSITION ${input.offset} MAXRESULTS ${input.limit}`;
      return qboQuery(config, store, client, sql);
    },
  }),
  tool({
    name: "get_item",
    description: "Fetch a single item by id.",
    schema: GetByIdInput,
    jsonSchema: schemaToJson(GetByIdInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      return qboRequest(config, store, client, `/item/${input.id}`);
    },
  }),
  tool({
    name: "qbo_query",
    description:
      "Run a raw QuickBooks Query Language (QBQL) statement against the active company. Read-only. Example: SELECT * FROM Invoice WHERE Balance > '0' MAXRESULTS 5.",
    schema: z.object({
      client: ClientField,
      sql: z.string().describe("QBQL statement, e.g. SELECT * FROM Customer."),
    }),
    jsonSchema: schemaToJson(
      z.object({
        client: ClientField,
        sql: z.string(),
      }),
    ),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      return qboQuery(config, store, client, input.sql);
    },
  }),
];
