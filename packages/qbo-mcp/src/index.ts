#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { initLogger } from "./logger.js";
import { Store } from "./store.js";
import { clientTools } from "./tools/clients.js";
import { reportTools } from "./tools/reports.js";
import { entityTools } from "./tools/entities.js";
import { writeTools } from "./tools/writes.js";
import { payrollTools } from "./tools/payroll.js";
import type { ToolDef, ToolContext } from "./tools/types.js";

async function main(): Promise<void> {
  const config = loadConfig();
  initLogger(config.dataDir);
  const store = new Store(config.dataDir);
  const ctx: ToolContext = { config, store };

  const allTools: ToolDef[] = [
    ...clientTools,
    ...reportTools,
    ...entityTools,
    ...writeTools,
    ...payrollTools,
  ];
  const byName = new Map(allTools.map((t) => [t.name, t]));

  const server = new Server(
    { name: "qbo-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.jsonSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = byName.get(req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      };
    }
    try {
      const parsed = tool.schema.parse(req.params.arguments ?? {});
      const result = await tool.handler(parsed, ctx);
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("qbo-mcp fatal:", err);
  process.exit(1);
});
