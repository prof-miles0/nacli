// Golbat's own database ([golbat] database on the [database] server): what its
// API does not list, starting with every spawnpoint it knows. Read by each
// Dragonite area's bounding box (Golbat indexes lat/lon), then narrowed to the
// area's geofence here.

import { once } from "node:events";
import type { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { SpawnpointCounts } from "../shared/types.ts";
import { bbox, inside } from "./golbat-stats.ts";

type Geometry = { type: "Polygon" | "MultiPolygon"; coordinates: unknown };

/** One spawnpoint: lat, lon, despawn second of the hour (-1 unknown), last seen (unix s). */
export type SpawnpointTuple = [number, number, number, number];

const round = (x: number) => Math.round(x * 1e6) / 1e6;

export async function spawnpointsIn(pool: Pool, geometry: Geometry): Promise<SpawnpointTuple[]> {
  const b = bbox(geometry);
  const [rows] = await pool.query<RowDataPacket[]>({
    sql: "SELECT lat, lon, despawn_sec, last_seen FROM spawnpoint WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
    rowsAsArray: true,
    timeout: 30_000,
    values: [b.min.lat, b.max.lat, b.min.lon, b.max.lon],
  });
  const out: SpawnpointTuple[] = [];
  for (const r of rows as unknown as [number, number, number | null, number][]) {
    const [lat, lon, despawn, seen] = r;
    if (inside(lat, lon, geometry)) out.push([round(lat), round(lon), despawn ?? -1, Number(seen)]);
  }
  return out;
}

const DAY = 86_400;

/** How many there are, with a known despawn time, and how recently they were seen. */
export function countSpawnpoints(points: SpawnpointTuple[], nowS: number): SpawnpointCounts {
  const c: SpawnpointCounts = { total: points.length, known: 0, seen24h: 0, seen7d: 0, seen30d: 0, older: 0 };
  for (const [, , despawn, seen] of points) {
    if (despawn >= 0) c.known++;
    const age = nowS - seen;
    if (age <= DAY) c.seen24h++;
    else if (age <= 7 * DAY) c.seen7d++;
    else if (age <= 30 * DAY) c.seen30d++;
    else c.older++;
  }
  return c;
}

/** Which spawnpoints the delete tool is aimed at. All the conditions given must hold. */
export interface SpawnpointFilter {
  /** Inside these geofences, or outside every one of them. */
  where: "inside" | "outside";
  geometries: Geometry[];
  /** Last seen before this (unix s). */
  seenBefore?: number;
  despawn: "any" | "known" | "unknown";
}

/**
 * The ids of the spawnpoints a filter picks. Inside an area it reads only the
 * area's bounding box; "outside" has to read the whole table.
 */
export async function findSpawnpoints(pool: Pool, f: SpawnpointFilter): Promise<string[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (f.seenBefore) {
    where.push("last_seen < ?");
    values.push(f.seenBefore);
  }
  if (f.despawn === "known") where.push("despawn_sec IS NOT NULL");
  if (f.despawn === "unknown") where.push("despawn_sec IS NULL");
  if (f.where === "inside" && f.geometries.length === 1) {
    const b = bbox(f.geometries[0]);
    where.push("lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?");
    values.push(b.min.lat, b.max.lat, b.min.lon, b.max.lon);
  }
  const [rows] = await pool.query<RowDataPacket[]>({
    sql: `SELECT id, lat, lon FROM spawnpoint${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`,
    rowsAsArray: true,
    timeout: 60_000,
    values,
  });
  const ids: string[] = [];
  for (const [id, lat, lon] of rows as unknown as [string, number, number][]) {
    const hit = f.geometries.some((g) => inside(lat, lon, g));
    if (hit === (f.where === "inside")) ids.push(String(id));
  }
  return ids;
}

/** Deletes these spawnpoints, a thousand at a time; how many went. */
export async function deleteSpawnpoints(pool: Pool, ids: string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 1000) {
    const [res] = await pool.query<ResultSetHeader>({ sql: "DELETE FROM spawnpoint WHERE id IN (?)", timeout: 60_000, values: [ids.slice(i, i + 1000)] });
    deleted += res.affectedRows;
  }
  return deleted;
}

/** How many rows the spawnpoint table has. */
export async function spawnpointRows(pool: Pool): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>({ sql: "SELECT COUNT(*) AS n FROM spawnpoint", timeout: 30_000 });
  return Number(rows[0]?.n ?? 0);
}

/**
 * The whole spawnpoint table as gzipped SQL, streamed: its definition (if the
 * table is missing) and its rows as INSERT IGNORE, so restoring brings back
 * the missing spawnpoints and leaves the ones there as they are. Only reads.
 * Access is checked before the stream starts, so a refusal is an error, not a
 * broken download.
 */
export async function spawnpointBackup(pool: Pool, database: string): Promise<{ rows: number; stream: Readable }> {
  const [created] = await pool.query<RowDataPacket[]>({ sql: "SHOW CREATE TABLE spawnpoint", timeout: 30_000 });
  const ddl = String(created[0]?.["Create Table"] ?? "").replace(/^CREATE TABLE/, "CREATE TABLE IF NOT EXISTS");
  const rows = await spawnpointRows(pool);
  const gz = createGzip();
  const write = async (s: string) => {
    if (!gz.write(s)) await once(gz, "drain");
  };
  // Numbers as they are (ids arrive as strings so 64 bits are not rounded), the rest escaped.
  const value = (v: unknown) =>
    v === null || v === undefined ? "NULL" : typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) ? String(v) : pool.escape(v);
  void (async () => {
    try {
      await write(
        `-- Nacli backup of Golbat's spawnpoint table (database ${database})\n` +
          `-- ${new Date().toISOString()} · ${rows} rows\n` +
          "-- Restore into Golbat's database (missing rows come back, existing ones stay):\n" +
          `--   gunzip -c <this file> | mariadb -h <host> -u <user> -p ${database}\n\n` +
          "SET NAMES utf8mb4;\n\n" +
          `${ddl};\n\n`,
      );
      let cols: string[] | undefined;
      let batch: string[] = [];
      const flush = async () => {
        if (!batch.length || !cols) return;
        await write(`INSERT IGNORE INTO \`spawnpoint\` (${cols.map((c) => `\`${c}\``).join(", ")}) VALUES\n${batch.join(",\n")};\n`);
        batch = [];
      };
      for await (const row of pool.pool.query("SELECT * FROM spawnpoint").stream() as AsyncIterable<Record<string, unknown>>) {
        cols ??= Object.keys(row);
        batch.push(`(${cols.map((c) => value(row[c])).join(",")})`);
        if (batch.length === 1000) await flush();
      }
      await flush();
      gz.end();
    } catch (e) {
      gz.destroy(e as Error);
    }
  })();
  return { rows, stream: gz };
}
