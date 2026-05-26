import { z } from "zod";
import { qboRequest, resolveClient } from "../qbo-client.js";
import { schemaToJson } from "./json-schema.js";
import { tool, type ToolDef } from "./types.js";

const ClientField = z
  .string()
  .optional()
  .describe(
    "Realm id or friendly name. Omit to use the active client (see set_active_client).",
  );

const DateRange = {
  start_date: z
    .string()
    .optional()
    .describe("YYYY-MM-DD start date. Ignored if date_macro is set."),
  end_date: z
    .string()
    .optional()
    .describe("YYYY-MM-DD end date. Ignored if date_macro is set."),
  date_macro: z
    .enum([
      "Today",
      "Yesterday",
      "This Week",
      "Last Week",
      "This Month",
      "Last Month",
      "This Fiscal Quarter",
      "Last Fiscal Quarter",
      "This Fiscal Year",
      "Last Fiscal Year",
      "This Fiscal Year-to-date",
      "Year-to-date",
    ])
    .optional()
    .describe(
      "Preset date range. When set, overrides start_date/end_date. Match QuickBooks' canonical macro names.",
    ),
};

function reportQuery(input: {
  start_date?: string;
  end_date?: string;
  date_macro?: string;
  accounting_method?: string;
  summarize_column_by?: string;
}): Record<string, string | undefined> {
  if (input.date_macro) {
    return {
      date_macro: input.date_macro,
      accounting_method: input.accounting_method,
      summarize_column_by: input.summarize_column_by,
    };
  }
  return {
    start_date: input.start_date,
    end_date: input.end_date,
    accounting_method: input.accounting_method,
    summarize_column_by: input.summarize_column_by,
  };
}

const PnLInput = z.object({
  client: ClientField,
  ...DateRange,
  accounting_method: z
    .enum(["Cash", "Accrual"])
    .optional()
    .describe("Cash or Accrual basis. Defaults to the company's setting."),
  summarize_column_by: z
    .enum(["Total", "Month", "Quarter", "Year", "Customers", "Vendors", "Classes", "Departments"])
    .optional()
    .describe("How to break out columns. Default Total."),
});

const BalanceSheetInput = z.object({
  client: ClientField,
  as_of: z
    .string()
    .optional()
    .describe("YYYY-MM-DD report date. Defaults to today."),
  accounting_method: z.enum(["Cash", "Accrual"]).optional(),
});

const ArAgingInput = z.object({
  client: ClientField,
  as_of: z
    .string()
    .optional()
    .describe("YYYY-MM-DD report date. Defaults to today."),
  detail: z
    .boolean()
    .default(false)
    .describe("Return invoice-level detail instead of customer summary."),
});

const ApAgingInput = z.object({
  client: ClientField,
  as_of: z.string().optional(),
  detail: z
    .boolean()
    .default(false)
    .describe("Return bill-level detail instead of vendor summary."),
});

const CashFlowInput = z.object({
  client: ClientField,
  ...DateRange,
});

export const reportTools: ToolDef[] = [
  tool({
    name: "get_profit_loss",
    description:
      "Fetch the Profit & Loss report for a connected QuickBooks company. Supports date macros or explicit start/end dates and column breakouts.",
    schema: PnLInput,
    jsonSchema: schemaToJson(PnLInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      return qboRequest(config, store, client, `/reports/ProfitAndLoss`, {
        query: reportQuery(input),
      });
    },
  }),
  tool({
    name: "get_balance_sheet",
    description:
      "Fetch the Balance Sheet report for a connected QuickBooks company.",
    schema: BalanceSheetInput,
    jsonSchema: schemaToJson(BalanceSheetInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      return qboRequest(config, store, client, `/reports/BalanceSheet`, {
        query: {
          end_date: input.as_of,
          accounting_method: input.accounting_method,
        },
      });
    },
  }),
  tool({
    name: "get_ar_aging",
    description:
      "Accounts receivable aging. Customer-level summary by default; pass detail=true for invoice-level rows.",
    schema: ArAgingInput,
    jsonSchema: schemaToJson(ArAgingInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      const report = input.detail ? "AgedReceivableDetail" : "AgedReceivables";
      return qboRequest(config, store, client, `/reports/${report}`, {
        query: { report_date: input.as_of },
      });
    },
  }),
  tool({
    name: "get_ap_aging",
    description:
      "Accounts payable aging. Vendor-level summary by default; pass detail=true for bill-level rows.",
    schema: ApAgingInput,
    jsonSchema: schemaToJson(ApAgingInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      const report = input.detail ? "AgedPayableDetail" : "AgedPayables";
      return qboRequest(config, store, client, `/reports/${report}`, {
        query: { report_date: input.as_of },
      });
    },
  }),
  tool({
    name: "get_cash_flow",
    description:
      "Cash Flow Statement for a connected QuickBooks company. Supports date macros or explicit date ranges.",
    schema: CashFlowInput,
    jsonSchema: schemaToJson(CashFlowInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      return qboRequest(config, store, client, `/reports/CashFlow`, {
        query: reportQuery(input),
      });
    },
  }),
];
