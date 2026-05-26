import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { decrypt, encrypt, loadOrCreateKey } from "./crypto.js";

export interface ClientRow {
  realm_id: string;
  name: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: number | null;
  environment: string;
  created_at: number;
  updated_at: number;
}

export interface ClientRecord {
  realmId: string;
  name: string;
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
  environment: string;
  createdAt: number;
  updatedAt: number;
}

export class Store {
  private db: Database.Database;
  private key: Buffer;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.key = loadOrCreateKey(join(dataDir, "key"));
    this.db = new Database(join(dataDir, "qbo.db"));
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clients (
        realm_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        access_token TEXT,
        access_token_expires_at INTEGER,
        environment TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kv (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      );
    `);
  }

  upsertClient(input: {
    realmId: string;
    name: string;
    refreshToken: string;
    accessToken: string;
    accessTokenExpiresAt: number;
    environment: string;
  }): void {
    const now = Date.now();
    const existing = this.db
      .prepare("SELECT created_at FROM clients WHERE realm_id = ?")
      .get(input.realmId) as { created_at: number } | undefined;
    const createdAt = existing?.created_at ?? now;
    this.db
      .prepare(
        `INSERT INTO clients
          (realm_id, name, refresh_token, access_token, access_token_expires_at, environment, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(realm_id) DO UPDATE SET
           name=excluded.name,
           refresh_token=excluded.refresh_token,
           access_token=excluded.access_token,
           access_token_expires_at=excluded.access_token_expires_at,
           environment=excluded.environment,
           updated_at=excluded.updated_at`,
      )
      .run(
        input.realmId,
        input.name,
        encrypt(input.refreshToken, this.key),
        encrypt(input.accessToken, this.key),
        input.accessTokenExpiresAt,
        input.environment,
        createdAt,
        now,
      );
  }

  updateTokens(input: {
    realmId: string;
    refreshToken: string;
    accessToken: string;
    accessTokenExpiresAt: number;
  }): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE clients SET
           refresh_token = ?,
           access_token = ?,
           access_token_expires_at = ?,
           updated_at = ?
         WHERE realm_id = ?`,
      )
      .run(
        encrypt(input.refreshToken, this.key),
        encrypt(input.accessToken, this.key),
        input.accessTokenExpiresAt,
        now,
        input.realmId,
      );
  }

  renameClient(realmId: string, name: string): void {
    this.db
      .prepare("UPDATE clients SET name = ?, updated_at = ? WHERE realm_id = ?")
      .run(name, Date.now(), realmId);
  }

  deleteClient(realmId: string): void {
    this.db.prepare("DELETE FROM clients WHERE realm_id = ?").run(realmId);
    const active = this.getActiveRealmId();
    if (active === realmId) this.setActiveRealmId(null);
  }

  getClient(realmId: string): ClientRecord | null {
    const row = this.db
      .prepare("SELECT * FROM clients WHERE realm_id = ?")
      .get(realmId) as ClientRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  findClientByName(name: string): ClientRecord | null {
    const row = this.db
      .prepare("SELECT * FROM clients WHERE name = ? COLLATE NOCASE")
      .get(name) as ClientRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  listClients(): ClientRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM clients ORDER BY name")
      .all() as ClientRow[];
    return rows.map((r) => this.toRecord(r));
  }

  setActiveRealmId(realmId: string | null): void {
    if (realmId === null) {
      this.db.prepare("DELETE FROM kv WHERE k = 'active_realm_id'").run();
    } else {
      this.db
        .prepare(
          "INSERT INTO kv (k, v) VALUES ('active_realm_id', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        )
        .run(realmId);
    }
  }

  getActiveRealmId(): string | null {
    const row = this.db
      .prepare("SELECT v FROM kv WHERE k = 'active_realm_id'")
      .get() as { v: string } | undefined;
    return row?.v ?? null;
  }

  private toRecord(row: ClientRow): ClientRecord {
    return {
      realmId: row.realm_id,
      name: row.name,
      refreshToken: decrypt(row.refresh_token, this.key),
      accessToken: row.access_token ? decrypt(row.access_token, this.key) : null,
      accessTokenExpiresAt: row.access_token_expires_at,
      environment: row.environment,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
