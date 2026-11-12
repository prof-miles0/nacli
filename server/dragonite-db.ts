// Dragonite's own databases on the stack's MariaDB ([database] plus each
// [stack.dragonite] database): moving accounts from one stack to another, and
// reading and editing one account.
// Both databases of a move live on the same server, so one transaction covers both.

import type { RowDataPacket } from "mysql2/promise";
import type { AccountRow } from "../shared/types.ts";
import type { DatabaseConfig } from "./config.ts";
import { dbPool } from "./db.ts";

const quote = (name: string) => `\`${name.replace(/`/g, "``")}\``;
/** IN lists stay short: a few hundred usernames per statement. */
const CHUNK = 500;

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

export interface AccountMoveResult {
  /** Usernames now in the target and gone from the source. */
  moved: string[];
  /** Already in the target: left where they were. */
  inTarget: string[];
  /** No longer in the source. */
  missing: string[];
}

/**
 * Moves accounts (whole rows, every column both tables share) from one
 * Dragonite database to another: all or none of them.
 */
export async function moveAccountRows(db: DatabaseConfig, from: string, to: string, usernames: string[]): Promise<AccountMoveResult> {
  const conn = await dbPool(db, from).getConnection();
  try {
    // The columns both have, in the source's order: the same Dragonite version has them all.
    const [cols] = await conn.query<RowDataPacket[]>(
      "SELECT TABLE_SCHEMA AS s, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA IN (?, ?) AND TABLE_NAME = 'account' ORDER BY ORDINAL_POSITION",
      [from, to],
    );
    const target = new Set(cols.filter((r) => r.s === to).map((r) => String(r.c)));
    if (!target.size) throw Object.assign(new Error("no account table"), { code: "ER_NO_SUCH_TABLE", db: to });
    const shared = cols.filter((r) => r.s === from && target.has(String(r.c))).map((r) => quote(String(r.c)));
    if (!shared.includes("`username`")) throw Object.assign(new Error("no account table"), { code: "ER_NO_SUCH_TABLE", db: from });
    const list = shared.join(", ");
    const src = `${quote(from)}.account`;
    const dst = `${quote(to)}.account`;

    await conn.beginTransaction();
    const here = new Map<string, string>();
    const there = new Set<string>();
    for (const part of chunks(usernames)) {
      const [a] = await conn.query<RowDataPacket[]>(`SELECT username FROM ${src} WHERE username IN (?) FOR UPDATE`, [part]);
      for (const r of a) here.set(String(r.username).toLowerCase(), String(r.username));
      const [b] = await conn.query<RowDataPacket[]>(`SELECT username FROM ${dst} WHERE username IN (?)`, [part]);
      for (const r of b) there.add(String(r.username).toLowerCase());
    }
    const move = [...here].filter(([k]) => !there.has(k)).map(([, u]) => u);
    for (const part of chunks(move)) {
      await conn.query(`INSERT INTO ${dst} (${list}) SELECT ${list} FROM ${src} WHERE username IN (?)`, [part]);
      await conn.query(`DELETE FROM ${src} WHERE username IN (?)`, [part]);
    }
    await conn.commit();
    return {
      moved: move,
      inTarget: [...here].filter(([k]) => there.has(k)).map(([, u]) => u),
      missing: usernames.filter((u) => !here.has(u.toLowerCase())),
    };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

/** The columns read as they are; the flags come back as booleans. */
const PLAIN = [
  "username", "email", "provider", "level", "warn_expiration", "auth_banned", "ar_ban_state", "ar_ban_last_checked",
  "last_selected", "last_released", "last_disabled", "last_banned", "last_suspended", "consecutive_disable_count",
  "last_refreshed", "next_available_time",
];
const FLAGS = ["warn", "suspended", "banned", "invalid"];

/** The account, or undefined when this database does not have it. */
export async function readAccount(db: DatabaseConfig, database: string, username: string): Promise<AccountRow | undefined> {
  const cols = [...PLAIN, ...FLAGS].map(quote).join(", ");
  const [rows] = await dbPool(db, database).query<RowDataPacket[]>({
    sql: `SELECT ${cols}, refresh_token <> '' AS has_refresh_token FROM account WHERE username = ?`,
    values: [username],
    timeout: 8000,
  });
  const r = rows[0];
  if (!r) return undefined;
  const out: Record<string, unknown> = {};
  for (const c of PLAIN) out[c] = r[c] ?? null;
  for (const c of [...FLAGS, "has_refresh_token"]) out[c] = !!Number(r[c]);
  return out as unknown as AccountRow;
}

/**
 * Checks what the browser sent and turns it into columns: unknown fields
 * and values out of range are refused, not ignored.
 */
export function accountUpdates(body: Record<string, unknown>): { set: Record<string, unknown> } | { error: string } {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    switch (k) {
      case "password":
        if (typeof v !== "string" || !v || v.length > 64 || v.trim() !== v) return { error: "the password must be 1 to 64 characters, without spaces at the ends" };
        set.password = v;
        break;
      case "email":
        if (v !== null && (typeof v !== "string" || v.length > 320 || /\s/.test(v))) return { error: "the email must be up to 320 characters, without spaces" };
        set.email = v || null;
        break;
      case "provider":
        if (typeof v !== "string" || !/^[a-z0-9_]{1,32}$/.test(v)) return { error: "unknown provider" };
        set.provider = v;
        break;
      case "level":
        if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 80) return { error: "the level must be a whole number from 0 to 80" };
        set.level = v;
        break;
      case "warn_expiration":
        if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 4_294_967_295) return { error: "invalid warning expiry" };
        set.warn_expiration = v;
        break;
      case "warn":
      case "suspended":
      case "banned":
      case "invalid":
        if (typeof v !== "boolean") return { error: `${k} must be true or false` };
        set[k] = v ? 1 : 0;
        break;
      case "clear_auth_ban":
        if (v !== true) return { error: "clear_auth_ban can only be true" };
        set.auth_banned = 0;
        break;
      case "clear_refresh_token":
        if (v !== true) return { error: "clear_refresh_token can only be true" };
        set.refresh_token = "";
        break;
      default:
        return { error: `${k} cannot be changed` };
    }
  }
  if (!Object.keys(set).length) return { error: "nothing to change" };
  return { set };
}

/** Writes the changes; false when the account is not there any more. */
export async function updateAccount(db: DatabaseConfig, database: string, username: string, set: Record<string, unknown>): Promise<boolean> {
  const cols = Object.keys(set);
  const [r] = await dbPool(db, database).query({
    sql: `UPDATE account SET ${cols.map((c) => `${quote(c)} = ?`).join(", ")} WHERE username = ?`,
    values: [...cols.map((c) => set[c]), username],
    timeout: 8000,
  });
  return (r as { affectedRows: number }).affectedRows > 0;
}
