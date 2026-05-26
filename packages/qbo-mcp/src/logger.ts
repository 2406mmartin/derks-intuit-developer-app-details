import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

let logFilePath: string | null = null;

export function initLogger(dataDir: string): void {
  const dir = join(dataDir, "logs");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  logFilePath = join(dir, "errors.log");
}

export function logError(
  event: string,
  details: Record<string, unknown>,
): void {
  if (!logFilePath) return;
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      event,
      ...details,
    }) + "\n";
  try {
    appendFileSync(logFilePath, line, { mode: 0o600 });
  } catch {
    // logging must never break the request
  }
}
