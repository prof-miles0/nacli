// Dragonite's own databases on the stack's MariaDB ([database] plus each
// [stack.dragonite] database): moving accounts from one stack to another.
// Both databases live on the same server, so one transaction covers both.

import type { RowDataPacket } from "mysql2/promise";
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
