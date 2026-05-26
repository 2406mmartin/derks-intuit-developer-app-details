import { z } from "zod";
import open from "open";
import {
  buildAuthUrl,
  exchangeCodeForTokens,
  generateState,
  revokeToken,
  waitForCallback,
} from "../oauth.js";
import { fetchCompanyInfo } from "../qbo-client.js";
import { schemaToJson } from "./json-schema.js";
import { tool, type ToolDef } from "./types.js";

const ConnectInput = z.object({
  name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Friendly name for this QuickBooks company. If omitted, the company's QuickBooks name is used.",
    ),
  open_browser: z
    .boolean()
    .default(true)
    .describe(
      "Whether to auto-open the authorization URL in the user's browser.",
    ),
  timeout_seconds: z
    .number()
    .int()
    .positive()
    .max(600)
    .default(180)
    .describe("How long to wait for the OAuth callback before giving up."),
  set_active: z
    .boolean()
    .default(true)
    .describe(
      "Set this newly connected client as the active one after authorization.",
    ),
});

const ListInput = z.object({});

const SetActiveInput = z.object({
  client: z
    .string()
    .describe("Realm id or friendly name of the client to make active."),
});

const DisconnectInput = z.object({
  client: z.string().describe("Realm id or friendly name to disconnect."),
  revoke: z
    .boolean()
    .default(true)
    .describe(
      "Also call Intuit's revoke endpoint to invalidate the refresh token.",
    ),
});

const RenameInput = z.object({
  client: z.string().describe("Realm id or current name to rename."),
  new_name: z.string().min(1).describe("New friendly name."),
});

export const clientTools: ToolDef[] = [
  tool({
    name: "connect_client",
    description:
      "Start the Intuit OAuth flow to connect a new QuickBooks company. Opens a browser, waits for the redirect callback, and stores the encrypted refresh token. Run this once per company you manage.",
    schema: ConnectInput,
    jsonSchema: schemaToJson(ConnectInput),
    handler: async (input, { config, store }) => {
      const state = generateState();
      const authUrl = await buildAuthUrl(config, state);
      const callbackPromise = waitForCallback(
        config.callbackPort,
        state,
        input.timeout_seconds * 1000,
      );
      if (input.open_browser) {
        open(authUrl).catch(() => {
          // ignore — user can paste manually
        });
      }
      const cb = await callbackPromise;
      const tokens = await exchangeCodeForTokens(config, cb.code);
      const expiresAt = Date.now() + tokens.expires_in * 1000;
      // Persist a placeholder name first so we can hit the API for the real one.
      let name = input.name ?? `Realm ${cb.realmId}`;
      store.upsertClient({
        realmId: cb.realmId,
        name,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        accessTokenExpiresAt: expiresAt,
        environment: config.environment,
      });
      if (!input.name) {
        try {
          const record = store.getClient(cb.realmId)!;
          const info = await fetchCompanyInfo(config, store, record);
          const companyName = info.CompanyInfo?.CompanyName;
          if (companyName) {
            store.renameClient(cb.realmId, companyName);
            name = companyName;
          }
        } catch {
          // keep placeholder name
        }
      }
      if (input.set_active) store.setActiveRealmId(cb.realmId);
      return {
        ok: true,
        realm_id: cb.realmId,
        name,
        environment: config.environment,
        active: input.set_active,
        authorization_url: authUrl,
      };
    },
  }),
  tool({
    name: "list_clients",
    description:
      "List all connected QuickBooks companies, including which one is currently active.",
    schema: ListInput,
    jsonSchema: schemaToJson(ListInput),
    handler: async (_input, { store }) => {
      const active = store.getActiveRealmId();
      return {
        active_realm_id: active,
        clients: store.listClients().map((c) => ({
          realm_id: c.realmId,
          name: c.name,
          environment: c.environment,
          active: c.realmId === active,
          connected_at: new Date(c.createdAt).toISOString(),
          updated_at: new Date(c.updatedAt).toISOString(),
        })),
      };
    },
  }),
  tool({
    name: "set_active_client",
    description:
      "Set the currently active QuickBooks company. Subsequent tool calls without an explicit `client` use this one.",
    schema: SetActiveInput,
    jsonSchema: schemaToJson(SetActiveInput),
    handler: async (input, { store }) => {
      const found = /^[0-9]+$/.test(input.client)
        ? store.getClient(input.client)
        : store.findClientByName(input.client);
      if (!found) {
        throw new Error(`No client matches "${input.client}"`);
      }
      store.setActiveRealmId(found.realmId);
      return { ok: true, realm_id: found.realmId, name: found.name };
    },
  }),
  tool({
    name: "rename_client",
    description: "Rename a connected QuickBooks company.",
    schema: RenameInput,
    jsonSchema: schemaToJson(RenameInput),
    handler: async (input, { store }) => {
      const found = /^[0-9]+$/.test(input.client)
        ? store.getClient(input.client)
        : store.findClientByName(input.client);
      if (!found) throw new Error(`No client matches "${input.client}"`);
      store.renameClient(found.realmId, input.new_name);
      return { ok: true, realm_id: found.realmId, name: input.new_name };
    },
  }),
  tool({
    name: "disconnect_client",
    description:
      "Disconnect a QuickBooks company. Optionally also revokes the refresh token with Intuit so it can't be reused.",
    schema: DisconnectInput,
    jsonSchema: schemaToJson(DisconnectInput),
    handler: async (input, { config, store }) => {
      const found = /^[0-9]+$/.test(input.client)
        ? store.getClient(input.client)
        : store.findClientByName(input.client);
      if (!found) throw new Error(`No client matches "${input.client}"`);
      if (input.revoke) {
        try {
          await revokeToken(config, found.refreshToken);
        } catch (err) {
          return {
            ok: true,
            realm_id: found.realmId,
            revoked: false,
            revoke_error: (err as Error).message,
          };
        }
      }
      store.deleteClient(found.realmId);
      return { ok: true, realm_id: found.realmId, revoked: input.revoke };
    },
  }),
];

