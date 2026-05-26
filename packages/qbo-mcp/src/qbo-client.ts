import {
  QBO_API_MINOR_VERSION,
  apiBaseUrl,
  type Config,
} from "./config.js";
import { logError } from "./logger.js";
import { refreshTokens } from "./oauth.js";
import type { Store, ClientRecord } from "./store.js";

const ACCESS_TOKEN_SAFETY_WINDOW_MS = 60_000;

export interface ResolvedClient {
  realmId: string;
  name: string;
  environment: "sandbox" | "production";
}

export function resolveClient(
  store: Store,
  hint: string | undefined,
): ClientRecord {
  if (hint) {
    const byRealm = /^[0-9]+$/.test(hint) ? store.getClient(hint) : null;
    const found = byRealm ?? store.findClientByName(hint);
    if (!found) {
      throw new Error(
        `No connected QuickBooks client matches "${hint}". Use list_clients to see what's available, or connect_client to add a new one.`,
      );
    }
    return found;
  }
  const activeId = store.getActiveRealmId();
  if (!activeId) {
    throw new Error(
      "No active client. Pass `client` (realm id or name) or call set_active_client first.",
    );
  }
  const found = store.getClient(activeId);
  if (!found) {
    throw new Error(
      "Active client points to a missing record; use set_active_client to pick a valid one.",
    );
  }
  return found;
}

async function ensureFreshAccessToken(
  config: Config,
  store: Store,
  client: ClientRecord,
): Promise<ClientRecord> {
  const expiresAt = client.accessTokenExpiresAt ?? 0;
  if (
    client.accessToken &&
    expiresAt - Date.now() > ACCESS_TOKEN_SAFETY_WINDOW_MS
  ) {
    return client;
  }
  const tokens = await refreshTokens(config, client.refreshToken);
  const next = {
    realmId: client.realmId,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
  };
  store.updateTokens(next);
  return { ...client, ...next };
}

interface RequestOpts {
  method?: "GET" | "POST";
  query?: Record<string, string | undefined>;
  body?: unknown;
  // accept header override; default application/json
  accept?: string;
}

export async function qboRequest<T>(
  config: Config,
  store: Store,
  client: ClientRecord,
  path: string,
  opts: RequestOpts = {},
): Promise<T> {
  const fresh = await ensureFreshAccessToken(config, store, client);
  const doFetch = async (
    bearer: string,
  ): Promise<{
    ok: boolean;
    status: number;
    text: string;
    intuitTid: string | undefined;
  }> => {
    const base = apiBaseUrl(
      fresh.environment === "sandbox" ? "sandbox" : "production",
    );
    const url = new URL(`${base}/v3/company/${fresh.realmId}${path}`);
    url.searchParams.set("minorversion", QBO_API_MINOR_VERSION);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${bearer}`,
      Accept: opts.accept ?? "application/json",
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const res = await fetch(url.toString(), {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body,
    });
    return {
      ok: res.ok,
      status: res.status,
      text: await res.text(),
      intuitTid: res.headers.get("intuit_tid") ?? undefined,
    };
  };

  let attempt = await doFetch(fresh.accessToken!);
  if (attempt.status === 401) {
    const tokens = await refreshTokens(config, fresh.refreshToken);
    store.updateTokens({
      realmId: fresh.realmId,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    });
    attempt = await doFetch(tokens.access_token);
  }
  if (!attempt.ok) {
    logError("qbo_api_error", {
      realm_id: fresh.realmId,
      environment: fresh.environment,
      path,
      status: attempt.status,
      intuit_tid: attempt.intuitTid,
      body: attempt.text,
    });
    const tidPart = attempt.intuitTid
      ? ` (intuit_tid=${attempt.intuitTid})`
      : "";
    throw new Error(
      `QBO API error ${attempt.status} on ${path}${tidPart}: ${attempt.text}`,
    );
  }
  if (!attempt.text) return undefined as T;
  return JSON.parse(attempt.text) as T;
}

export async function qboQuery<T = unknown>(
  config: Config,
  store: Store,
  client: ClientRecord,
  sql: string,
): Promise<T> {
  return qboRequest<T>(config, store, client, `/query`, {
    method: "GET",
    query: { query: sql },
  });
}

export async function fetchCompanyInfo(
  config: Config,
  store: Store,
  client: ClientRecord,
): Promise<{ CompanyInfo?: { CompanyName?: string } }> {
  return qboRequest(
    config,
    store,
    client,
    `/companyinfo/${client.realmId}`,
  );
}
