// The histories Nacli keeps in memory, saved to one gzipped JSON file
// ([server] state_file) on exit and every few minutes, and loaded at start, so
// a restart does not empty the charts.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { gunzipSync, gzip, gzipSync } from "node:zlib";
import type { AreaStatsCounts } from "../shared/types.ts";
import type { SavedInstance } from "./local-metrics.ts";

export interface SavedState {
  savedAt: number;
  /** The charts of the instances Zapdos does not cover, by `instance` label. */
  metrics: Record<string, SavedInstance>;
  /** The Statistics history ([golbat] stats_poll_interval). */
  stats: { t: number; totals: AreaStatsCounts; areas: Record<string, AreaStatsCounts> }[];
  /**
   * From Golbat's pokemon_area_stats, by "area\tfence" (5 min, hourly after a week):
   * verified and unverified encounters, all Pokémon and those with IV, and the
   * 12 buckets of minutes left until despawn.
   */
  encounters?: { t: number; areas: Record<string, number[]> }[];
}

/** What was saved, or nothing when there is no file (or it cannot be read). */
export function loadState(file: string): Partial<SavedState> {
  if (!file || !existsSync(file)) return {};
  try {
    const state = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as Partial<SavedState>;
    const ago = state.savedAt ? `${Math.round((Date.now() - state.savedAt) / 60_000)} min ago` : "earlier";
    console.log(`[state] loaded ${file} (saved ${ago})`);
    return state;
  } catch (e) {
    console.error(`[state] could not read ${file}, starting empty: ${(e as Error).message}`);
    return {};
  }
}

const empty = (state: SavedState) => !Object.keys(state.metrics).length && !state.stats.length && !state.encounters?.length;
let lastError: string | undefined;
let saving = false;

/**
 * Writes the state in the background, through a temporary file so a crash
 * mid-write leaves the previous one. Skipped when there is nothing to keep
 * and no file yet.
 */
export async function saveState(file: string, state: SavedState) {
  if (!file || saving || (empty(state) && !existsSync(file))) return;
  saving = true;
  try {
    const data = await promisify(gzip)(JSON.stringify(state));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, data);
    await rename(`${file}.tmp`, file);
    if (lastError) console.log(`[state] saving to ${file} again`);
    lastError = undefined;
  } catch (e) {
    const msg = (e as Error).message;
    if (lastError !== msg) console.error(`[state] could not save ${file}: ${msg}`);
    lastError = msg;
  } finally {
    saving = false;
  }
}

/** The same, at once: on exit, when there is no time to wait. */
export function saveStateNow(file: string, state: SavedState) {
  if (!file || (empty(state) && !existsSync(file))) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, gzipSync(JSON.stringify(state)));
    renameSync(`${file}.tmp`, file);
    console.log(`[state] saved ${file}`);
  } catch (e) {
    console.error(`[state] could not save ${file}: ${(e as Error).message}`);
  }
}
