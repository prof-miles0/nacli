// The stack's MariaDB ([database] in config.toml): one small pool per database
// on it (Golbat's for now), rebuilt when the server or its credentials change.
// Every query here only reads.

import mysql, { type Pool } from "mysql2/promise";
import type { DatabaseConfig } from "./config.ts";

let pools = new Map<string, Pool>();
let signature = "";

export function dbPool(db: DatabaseConfig, name: string): Pool {
  const sig = JSON.stringify([db.host, db.port, db.user, db.password]);
  if (sig !== signature) {
    for (const p of pools.values()) p.end().catch(() => {});
    pools = new Map();
    signature = sig;
  }
  let pool = pools.get(name);
  if (!pool) {
    pool = mysql.createPool({
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      database: name,
      connectionLimit: 4,
      connectTimeout: 8000,
      enableKeepAlive: true,
      // Spawnpoint ids are 64-bit; as strings they cannot lose digits.
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    pools.set(name, pool);
  }
  return pool;
}

/** Closes every pool, e.g. when [database] is removed from config.toml. */
export function closeDbPools() {
  for (const p of pools.values()) p.end().catch(() => {});
  pools = new Map();
  signature = "";
}

/**
 * What went wrong, in words fit for the browser: the driver's own messages
 * name the server's address, which must not leave Nacli.
 */
export function dbError(e: unknown, name: string, part = "Golbat"): string {
  const code = (e as { code?: string }).code ?? "";
  switch (code) {
    case "ECONNREFUSED":
      return "the database server refuses the connection (host or port?)";
    case "ETIMEDOUT":
    case "PROTOCOL_SEQUENCE_TIMEOUT":
      return "the database server does not answer";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "the database host cannot be found";
    case "ER_ACCESS_DENIED_ERROR":
      return "access denied: check username and password in [database]";
    case "ER_DBACCESS_DENIED_ERROR":
      // MariaDB says the same whether the database is missing or not granted.
      return `the [database] user cannot use "${name}" (does it exist, with SELECT granted on it?)`;
    case "ER_TABLEACCESS_DENIED_ERROR":
    case "ER_COLUMNACCESS_DENIED_ERROR":
      return `the [database] user cannot read "${name}" (needs SELECT on it)`;
    case "ER_BAD_DB_ERROR":
      return `no database named "${name}"`;
    case "ER_NO_SUCH_TABLE":
      return `"${name}" is missing a table Nacli reads (is it ${part}'s database?)`;
    default:
      return code ? `database error (${code})` : "database error";
  }
}

const DENIED = new Set(["ER_DBACCESS_DENIED_ERROR", "ER_TABLEACCESS_DENIED_ERROR", "ER_COLUMNACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR", "ER_NO_SUCH_TABLE"]);

/**
 * Whether the database can be read, and how fast: `probe` is a query on a
 * table Nacli needs, so a user that connects but may not read it fails too.
 */
export async function dbCheck(
  db: DatabaseConfig,
  name: string,
  probe = "SELECT 1",
  part?: string,
): Promise<{ ok: boolean; ms?: number; error?: string; denied?: boolean }> {
  const started = Date.now();
  try {
    await dbPool(db, name).query({ sql: probe, timeout: 8000 });
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    // The server answers and takes the login, but not this database or its tables.
    const denied = DENIED.has((e as { code?: string }).code ?? "");
    return { ok: false, error: dbError(e, name, part), ...(denied ? { denied } : {}) };
  }
}
