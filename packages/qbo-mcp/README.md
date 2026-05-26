# qbo-mcp

Multi-tenant MCP server for Intuit QuickBooks Online. Connect once per company, then ask Claude things like "show me Acme's P&L" and "compare Beta's AR aging to last month" without re-authorizing.

Each connected QuickBooks company is stored as a row keyed by `realmId`, with the refresh token AES-256-GCM-encrypted at rest. There is a notion of an "active client" so tools can be called without passing `client` every time.

## Prerequisites

- Node 22+.
- An Intuit Developer app with the **Accounting** scope. Create one at https://developer.intuit.com -> **Dashboard** -> **Create an app**. For real customer data you need **Production** keys (apps start in Development; flip them via the app's **Keys & OAuth** tab once you've added the production redirect URI).
- A registered redirect URI of `http://localhost:8723/callback` (or whatever port you set via `QBO_CALLBACK_PORT`). Intuit allows loopback URIs.

> Intuit's [security requirements page](https://developer.intuit.com/app/developer/qbo/docs/develop/security-requirements) describes what's needed to **publish on the QuickBooks App Store**. If this server is just for your own firm's clients, you don't need to pass that review — but you still need each client to walk through OAuth once.

## Install

From the repo root:

```sh
pnpm install
pnpm --filter qbo-mcp build
```

## Configure

Copy `.env.example` and fill in your Intuit credentials:

```sh
cp packages/qbo-mcp/.env.example packages/qbo-mcp/.env
```

| Var | Required | Notes |
| --- | --- | --- |
| `QBO_CLIENT_ID` | yes | From the Intuit app's Keys & OAuth tab |
| `QBO_CLIENT_SECRET` | yes | Same place |
| `QBO_ENVIRONMENT` | no | `production` (default) or `sandbox` |
| `QBO_REDIRECT_URI` | no | Default `http://localhost:8723/callback` — must match what's registered in the Intuit app |
| `QBO_CALLBACK_PORT` | no | Default `8723` |
| `QBO_DATA_DIR` | no | Where the encrypted SQLite store + AES key live. Default `~/.qbo-mcp/` |

The AES key is generated on first run (`~/.qbo-mcp/key`, mode 0600) and is stored separately from the database, mirroring Intuit's stated best practice of "store your AES key in your app, in a separate configuration file."

## Install into Claude Desktop / Claude Code

Add to your MCP server config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS for Claude Desktop, or your `~/.claude/settings.json` for Claude Code):

```jsonc
{
  "mcpServers": {
    "qbo": {
      "command": "node",
      "args": [
        "/absolute/path/to/derks-intuit-developer-app-details/packages/qbo-mcp/dist/index.js"
      ],
      "env": {
        "QBO_CLIENT_ID": "...",
        "QBO_CLIENT_SECRET": "...",
        "QBO_ENVIRONMENT": "production"
      }
    }
  }
}
```

Restart Claude after editing.

## Connecting your first company

1. In Claude, run the `connect_client` tool (just ask: "connect a new QuickBooks client").
2. Your browser opens to Intuit's authorization screen. Pick the company, click Connect.
3. The redirect closes the loop — the tool returns the realm id and friendly name (the QuickBooks company name).
4. Repeat for each company.

After that:

- `list_clients` shows everything connected.
- `set_active_client "Acme Co"` makes that company the default.
- Any report/entity/write tool takes an optional `client` (realm id or name) to target a specific company.

## Tool surface

**Client management**
- `connect_client` — start OAuth + persist tokens
- `list_clients` — show connected companies & which is active
- `set_active_client` — pick the default for subsequent calls
- `rename_client` — change the friendly name
- `disconnect_client` — delete locally and revoke with Intuit

**Reports**
- `get_profit_loss`, `get_balance_sheet`, `get_cash_flow`
- `get_ar_aging`, `get_ap_aging` (summary or detail)

**Entities (read)**
- `get_company_info`
- `list_customers`, `get_customer`
- `list_vendors`
- `list_invoices`, `get_invoice`
- `list_items`, `get_item`
- `qbo_query` — raw QBQL escape hatch

**Writes**
- `create_invoice`, `send_invoice`
- `create_estimate`
- `create_customer`

**Payroll**
- `list_employees`, `get_employee`

The full QBO Payroll API (payruns, payslips, deductions, etc.) is partner-restricted — those tools require Intuit to grant your developer app special access. If you have it, drop the additional endpoints into `src/tools/payroll.ts` behind the same `resolveClient` flow.

## Logs

Errors from the Intuit OAuth endpoints and QBO API are appended as JSON lines to `~/.qbo-mcp/logs/errors.log`. Each entry includes the `intuit_tid` response header value when present — that's the request ID Intuit support asks for when troubleshooting. The file is created mode 0600 and never logs successful requests, access tokens, or refresh tokens.

## Security notes

- Refresh + access tokens are encrypted with AES-256-GCM at rest. The key is kept in a separate file (`~/.qbo-mcp/key`), not the DB.
- The OAuth callback server only listens on `127.0.0.1`, only accepts a request matching the `state` it generated for the current `connect_client` call, and shuts down on first hit or timeout.
- 401s automatically trigger a token refresh and one retry; rotated refresh tokens are persisted.
- Intuit refresh tokens expire ~100 days after issue — connect once and the rolling refresh keeps you logged in indefinitely, but a company that hasn't been queried in 100 days will need to reconnect.

## Local development

```sh
pnpm --filter qbo-mcp dev    # tsx watch on src/index.ts
pnpm --filter qbo-mcp build  # tsc -> dist/
pnpm --filter qbo-mcp typecheck
```

The `dev` script runs the stdio server directly — useful for piping JSON-RPC at it from a script, less useful inside Claude (which only speaks to the built `dist/index.js`).
