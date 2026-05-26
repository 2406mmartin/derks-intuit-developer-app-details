import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "production";
  redirectUri: string;
  callbackPort: number;
  dataDir: string;
}

export function loadConfig(): Config {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "QBO_CLIENT_ID and QBO_CLIENT_SECRET must be set. See .env.example.",
    );
  }
  const environment = (process.env.QBO_ENVIRONMENT ?? "production") as
    | "sandbox"
    | "production";
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error(`QBO_ENVIRONMENT must be "sandbox" or "production"`);
  }
  const callbackPort = Number(process.env.QBO_CALLBACK_PORT ?? "8723");
  const redirectUri =
    process.env.QBO_REDIRECT_URI ?? `http://localhost:${callbackPort}/callback`;
  const dataDir = process.env.QBO_DATA_DIR ?? join(homedir(), ".qbo-mcp");

  return {
    clientId,
    clientSecret,
    environment,
    redirectUri,
    callbackPort,
    dataDir,
  };
}

export function apiBaseUrl(environment: "sandbox" | "production"): string {
  return environment === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

export const QBO_SCOPES = ["com.intuit.quickbooks.accounting", "openid", "profile", "email"];
export const QBO_API_MINOR_VERSION = "75";
