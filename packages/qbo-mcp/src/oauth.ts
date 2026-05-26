import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { QBO_SCOPES, type Config } from "./config.js";
import { getDiscovery } from "./discovery.js";
import { logError } from "./logger.js";

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
}

export interface AuthorizationResult {
  code: string;
  realmId: string;
  state: string;
}

export async function buildAuthUrl(
  config: Config,
  state: string,
  scopes: string[] = QBO_SCOPES,
): Promise<string> {
  const { authorization_endpoint } = await getDiscovery(config.environment);
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: scopes.join(" "),
    redirect_uri: config.redirectUri,
    state,
  });
  return `${authorization_endpoint}?${params.toString()}`;
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}

export async function waitForCallback(
  port: number,
  expectedState: string,
  timeoutMs: number,
): Promise<AuthorizationResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      fn: () => void,
      handler: () => void,
    ) => {
      if (settled) return;
      settled = true;
      handler();
      fn();
    };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (!req.url) {
        res.writeHead(400).end("Bad request");
        return;
      }
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        res
          .writeHead(400, { "Content-Type": "text/html" })
          .end(`<h1>Authorization failed</h1><p>${escapeHtml(error)}</p>`);
        finish(
          () => reject(new Error(`Authorization error: ${error}`)),
          () => {
            clearTimeout(timer);
            server.close();
          },
        );
        return;
      }
      const code = url.searchParams.get("code");
      const realmId = url.searchParams.get("realmId");
      const state = url.searchParams.get("state");
      if (!code || !realmId || !state) {
        res.writeHead(400).end("Missing params");
        return;
      }
      if (state !== expectedState) {
        res.writeHead(400).end("Bad state");
        finish(
          () => reject(new Error("OAuth state mismatch")),
          () => {
            clearTimeout(timer);
            server.close();
          },
        );
        return;
      }
      res
        .writeHead(200, { "Content-Type": "text/html" })
        .end(
          `<!doctype html><html><body style="font-family:system-ui;padding:2rem;"><h1>Connected!</h1><p>You can close this window and return to Claude.</p></body></html>`,
        );
      finish(
        () => resolve({ code, realmId, state }),
        () => {
          clearTimeout(timer);
          server.close();
        },
      );
    });

    const timer = setTimeout(() => {
      finish(
        () => reject(new Error("OAuth callback timed out")),
        () => server.close(),
      );
    }, timeoutMs);

    server.on("error", (err: Error) => {
      finish(
        () => reject(err),
        () => clearTimeout(timer),
      );
    });

    server.listen(port, "127.0.0.1");
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function basicAuthHeader(config: Config): string {
  return (
    "Basic " +
    Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")
  );
}

export async function exchangeCodeForTokens(
  config: Config,
  code: string,
): Promise<TokenResponse> {
  const { token_endpoint } = await getDiscovery(config.environment);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });
  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    const tid = res.headers.get("intuit_tid") ?? undefined;
    logError("oauth_exchange_failed", { status: res.status, intuit_tid: tid, body: text });
    const tidPart = tid ? ` (intuit_tid=${tid})` : "";
    throw new Error(`Token exchange failed: ${res.status}${tidPart} ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshTokens(
  config: Config,
  refreshToken: string,
): Promise<TokenResponse> {
  const { token_endpoint } = await getDiscovery(config.environment);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    const tid = res.headers.get("intuit_tid") ?? undefined;
    logError("oauth_refresh_failed", { status: res.status, intuit_tid: tid, body: text });
    const tidPart = tid ? ` (intuit_tid=${tid})` : "";
    throw new Error(`Refresh failed: ${res.status}${tidPart} ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function revokeToken(
  config: Config,
  token: string,
): Promise<void> {
  const { revocation_endpoint } = await getDiscovery(config.environment);
  const res = await fetch(revocation_endpoint, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    const tid = res.headers.get("intuit_tid") ?? undefined;
    logError("oauth_revoke_failed", { status: res.status, intuit_tid: tid, body: text });
    const tidPart = tid ? ` (intuit_tid=${tid})` : "";
    throw new Error(`Revoke failed: ${res.status}${tidPart} ${text}`);
  }
}
