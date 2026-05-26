import { z } from "zod";
import { qboRequest, resolveClient } from "../qbo-client.js";
import { schemaToJson } from "./json-schema.js";
import { tool, type ToolDef } from "./types.js";

const ClientField = z.string().optional().describe("Realm id or friendly name. Omit for active client.");

const LineItem = z.object({
  item_id: z
    .string()
    .describe(
      "QuickBooks Item id. Use list_items to find it.",
    ),
  description: z.string().optional().describe("Free-text line description."),
  quantity: z.number().positive().default(1),
  unit_price: z
    .number()
    .nonnegative()
    .optional()
    .describe(
      "Per-unit price. If omitted, QuickBooks uses the item's default price.",
    ),
  amount: z
    .number()
    .optional()
    .describe(
      "Total amount for the line. If omitted, QuickBooks computes quantity * unit_price.",
    ),
  tax_code_id: z.string().optional(),
});

function buildSalesItemLines(lines: z.infer<typeof LineItem>[]): unknown[] {
  return lines.map((line, idx) => {
    const detail: Record<string, unknown> = {
      ItemRef: { value: line.item_id },
      Qty: line.quantity,
    };
    if (line.unit_price !== undefined) detail.UnitPrice = line.unit_price;
    if (line.tax_code_id) detail.TaxCodeRef = { value: line.tax_code_id };
    const computedAmount =
      line.amount ??
      (line.unit_price !== undefined ? line.unit_price * line.quantity : undefined);
    return {
      LineNum: idx + 1,
      DetailType: "SalesItemLineDetail",
      Description: line.description,
      Amount: computedAmount,
      SalesItemLineDetail: detail,
    };
  });
}

const CreateInvoiceInput = z.object({
  client: ClientField,
  customer_id: z.string().describe("QuickBooks Customer id."),
  line_items: z.array(LineItem).min(1),
  due_date: z.string().optional().describe("YYYY-MM-DD due date."),
  txn_date: z.string().optional().describe("YYYY-MM-DD transaction date. Defaults to today."),
  customer_memo: z.string().optional().describe("Message visible to the customer."),
  private_note: z.string().optional().describe("Internal note (not shown to customer)."),
  doc_number: z.string().optional().describe("Override the auto-assigned invoice number."),
  email_to: z
    .string()
    .optional()
    .describe(
      "Override BillEmail. Use send_invoice afterwards to actually email it.",
    ),
});

const CreateEstimateInput = z.object({
  client: ClientField,
  customer_id: z.string(),
  line_items: z.array(LineItem).min(1),
  txn_date: z.string().optional(),
  expiration_date: z.string().optional().describe("YYYY-MM-DD estimate expiration."),
  customer_memo: z.string().optional(),
  private_note: z.string().optional(),
  doc_number: z.string().optional(),
});

const CreateCustomerInput = z.object({
  client: ClientField,
  display_name: z.string().describe("DisplayName — must be unique within the company."),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
  company_name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  bill_address: z
    .object({
      line1: z.string().optional(),
      city: z.string().optional(),
      country_sub_division_code: z.string().optional().describe("State/region code, e.g. CA."),
      postal_code: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),
});

const SendInvoiceInput = z.object({
  client: ClientField,
  invoice_id: z.string(),
  email_to: z
    .string()
    .email()
    .optional()
    .describe("Override recipient. If omitted, uses the invoice's BillEmail."),
});

export const writeTools: ToolDef[] = [
  tool({
    name: "create_invoice",
    description:
      "Create an invoice. Will not auto-send — call send_invoice if you also want to email it.",
    schema: CreateInvoiceInput,
    jsonSchema: schemaToJson(CreateInvoiceInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      const body: Record<string, unknown> = {
        CustomerRef: { value: input.customer_id },
        Line: buildSalesItemLines(input.line_items),
      };
      if (input.txn_date) body.TxnDate = input.txn_date;
      if (input.due_date) body.DueDate = input.due_date;
      if (input.customer_memo)
        body.CustomerMemo = { value: input.customer_memo };
      if (input.private_note) body.PrivateNote = input.private_note;
      if (input.doc_number) body.DocNumber = input.doc_number;
      if (input.email_to)
        body.BillEmail = { Address: input.email_to };
      return qboRequest(config, store, client, `/invoice`, {
        method: "POST",
        body,
      });
    },
  }),
  tool({
    name: "create_estimate",
    description: "Create an estimate (quote) for a customer.",
    schema: CreateEstimateInput,
    jsonSchema: schemaToJson(CreateEstimateInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      const body: Record<string, unknown> = {
        CustomerRef: { value: input.customer_id },
        Line: buildSalesItemLines(input.line_items),
      };
      if (input.txn_date) body.TxnDate = input.txn_date;
      if (input.expiration_date) body.ExpirationDate = input.expiration_date;
      if (input.customer_memo)
        body.CustomerMemo = { value: input.customer_memo };
      if (input.private_note) body.PrivateNote = input.private_note;
      if (input.doc_number) body.DocNumber = input.doc_number;
      return qboRequest(config, store, client, `/estimate`, {
        method: "POST",
        body,
      });
    },
  }),
  tool({
    name: "create_customer",
    description: "Create a new customer record.",
    schema: CreateCustomerInput,
    jsonSchema: schemaToJson(CreateCustomerInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      const body: Record<string, unknown> = {
        DisplayName: input.display_name,
      };
      if (input.given_name) body.GivenName = input.given_name;
      if (input.family_name) body.FamilyName = input.family_name;
      if (input.company_name) body.CompanyName = input.company_name;
      if (input.email) body.PrimaryEmailAddr = { Address: input.email };
      if (input.phone) body.PrimaryPhone = { FreeFormNumber: input.phone };
      if (input.notes) body.Notes = input.notes;
      if (input.bill_address) {
        const addr: Record<string, unknown> = {};
        if (input.bill_address.line1) addr.Line1 = input.bill_address.line1;
        if (input.bill_address.city) addr.City = input.bill_address.city;
        if (input.bill_address.country_sub_division_code)
          addr.CountrySubDivisionCode =
            input.bill_address.country_sub_division_code;
        if (input.bill_address.postal_code)
          addr.PostalCode = input.bill_address.postal_code;
        if (input.bill_address.country) addr.Country = input.bill_address.country;
        body.BillAddr = addr;
      }
      return qboRequest(config, store, client, `/customer`, {
        method: "POST",
        body,
      });
    },
  }),
  tool({
    name: "send_invoice",
    description:
      "Email an existing invoice to the customer. If email_to is omitted, uses the invoice's BillEmail.",
    schema: SendInvoiceInput,
    jsonSchema: schemaToJson(SendInvoiceInput),
    handler: async (input, { config, store }) => {
      const client = resolveClient(store, input.client);
      const path = `/invoice/${input.invoice_id}/send`;
      return qboRequest(config, store, client, path, {
        method: "POST",
        query: input.email_to ? { sendTo: input.email_to } : {},
        body: {},
      });
    },
  }),
];
