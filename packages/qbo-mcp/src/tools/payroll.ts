import { z } from "zod";
import { qboQuery, qboRequest, resolveClient } from "../qbo-client.js";
import { schemaToJson } from "./json-schema.js";
import { tool, type ToolDef } from "./types.js";

// Note: the full QBO Payroll API (payruns, payslips, deductions) is
// partner-restricted and not enabled on standard developer apps. The tools
// below use the public /v3 Employee endpoints, which work on any Accounting
// scope. Partner-restricted endpoints would slot in here later behind the
// same realm-resolution flow.

const ClientField = z.string().optional().describe("Realm id or friendly name. Omit for active client.");

function sanitize(value: string): string {
  return value.replace(/'/g, "\\'");
}

const ListEmployeesInput = z.object({
  client: ClientField,
  search: z.string().optional().describe("Partial DisplayName match."),
  active_only: z.boolean().default(true),
  limit: z.number().int().positive().max(1000).default(100),
  offset: z.number().int().min(1).default(1),
});

const GetEmployeeInput = z.object({
  client: ClientField,
  id: z.string(),
});

export const payrollTools: ToolDef[] = [
  tool({
    name: "list_employees",
    description:
      "List employees from the QuickBooks Employee table. Works on standard Accounting scope (partner Payroll API not required).",
    schema: ListEmployeesInput,
    jsonSchema: schemaToJson(ListEmployeesInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      const filters: Array<string | null> = [];
      if (input.active_only) filters.push("Active = true");
      if (input.search)
        filters.push(`DisplayName LIKE '%${sanitize(input.search)}%'`);
      const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
      const sql = `SELECT * FROM Employee${where} ORDERBY DisplayName STARTPOSITION ${input.offset} MAXRESULTS ${input.limit}`;
      return qboQuery(config, store, client, sql);
    },
  }),
  tool({
    name: "get_employee",
    description: "Fetch a single employee by id.",
    schema: GetEmployeeInput,
    jsonSchema: schemaToJson(GetEmployeeInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      return qboRequest(config, store, client, `/employee/${input.id}`);
    },
  }),
];
