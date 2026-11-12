// [watchdog]: restarts the devices of the chosen stacks that keep failing.
// A device fails when, while connected to its RotomNG, it has no worker
// connected (no_workers) or its Dragonite workers have sent nothing
// (no_data), for failing_for. Off unless `enabled = true`; with dry_run it
// only says what it would do.

import type { WatchdogEvent } from "../shared/types.ts";
import type { WatchdogConfig } from "./config.ts";

/** One device as one check sees it. */
export interface WatchedDevice {
  stack: string;
  instanceId: string;
  deviceId: string;
  /** Its name in Rotom. */
  name: string;
  /** Connected, enabled and in a stack the watchdog looks after. */
  watched: boolean;
  /** How many of its workers are connected to Rotom. */
  workersConnected: number;
  /**
   * The newest data any of its Dragonite workers sent (ms), when Dragonite
   * has workers on it; undefined when it has none or Dragonite did not answer.
   */
  lastData?: number;
}

/** A failing stack is not a failing device: past this share, nothing is restarted. */
const STACK_SHARE = 0.5;
const DAY = 86_400_000;

const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;

export class Watchdog {
  /** Since when each device has been failing, by "instance\tdevice", and why. */
  private failing = new Map<string, { since: number; check: string }>();
  /** The restarts of the last 24 h, newest last. */
  private events: WatchdogEvent[] = [];
  /** A stack the watchdog held back on, so the log says it once. */
  private heldBack = new Set<string>();

  restore(events: WatchdogEvent[] | undefined) {
    this.events = (events ?? []).filter((e) => e.t > Date.now() - DAY);
  }

  dump() {
    return this.events;
  }

  recent() {
    this.events = this.events.filter((e) => e.t > Date.now() - DAY);
    return this.events;
  }

  /**
   * One check: which devices have failed long enough, and the restart of
   * each (through `act`). Returns the new events.
   */
  async check(
    cfg: WatchdogConfig,
    devices: WatchedDevice[],
    act: (d: WatchedDevice, action: WatchdogConfig["action"]) => Promise<void>,
  ): Promise<WatchdogEvent[]> {
    const now = Date.now();
    const seen = new Set<string>();
    const due: { d: WatchedDevice; reason: string }[] = [];
    const failingIn = new Map<string, number>();
    const watchedIn = new Map<string, number>();
    for (const d of devices) {
      const key = `${d.instanceId}\t${d.deviceId}`;
      seen.add(key);
      if (!d.watched) {
        this.failing.delete(key);
        continue;
      }
      watchedIn.set(d.stack, (watchedIn.get(d.stack) ?? 0) + 1);
      // What fails now, and since when: no_data from the last data itself.
      let check: string | undefined;
      let since = now;
      if (cfg.checks.includes("no_workers") && d.workersConnected === 0) check = "no worker connected";
      else if (cfg.checks.includes("no_data") && d.lastData !== undefined && now - d.lastData >= cfg.failingForMs) {
        check = "its Dragonite workers sent no data";
        since = d.lastData;
      }
      if (!check) {
        this.failing.delete(key);
        continue;
      }
      const old = this.failing.get(key);
      const from = old?.check === check ? Math.min(old.since, since) : since;
      this.failing.set(key, { since: from, check });
      failingIn.set(d.stack, (failingIn.get(d.stack) ?? 0) + 1);
      if (now - from >= cfg.failingForMs) due.push({ d, reason: `${check} for ${minutes(now - from)}` });
    }
    for (const k of this.failing.keys()) if (!seen.has(k)) this.failing.delete(k);

    const out: WatchdogEvent[] = [];
    for (const { d, reason } of due) {
      // Half a stack failing at once is its Dragonite or network, not its devices.
      const watched = watchedIn.get(d.stack) ?? 0;
      if (watched > 1 && (failingIn.get(d.stack) ?? 0) / watched > STACK_SHARE) {
        if (!this.heldBack.has(d.stack)) console.warn(`[watchdog] ${d.stack}: most of its devices fail at once, restarting none`);
        this.heldBack.add(d.stack);
        continue;
      }
      this.heldBack.delete(d.stack);
      const mine = this.recent().filter((e) => e.instanceId === d.instanceId && e.deviceId === d.deviceId);
      const last = mine.at(-1);
      if (last && now - last.t < cfg.cooldownMs) continue;
      if (mine.length >= cfg.maxPerDay) continue;
      const e: WatchdogEvent = {
        t: now,
        stack: d.stack,
        instanceId: d.instanceId,
        deviceId: d.deviceId,
        device: d.name,
        action: cfg.action,
        reason,
        ...(cfg.dryRun ? { dryRun: true } : {}),
      };
      if (!cfg.dryRun) {
        try {
          await act(d, cfg.action);
        } catch (err) {
          e.error = (err as Error).message;
        }
      }
      // It starts over: the restart needs its time before it can fail again.
      this.failing.delete(`${d.instanceId}\t${d.deviceId}`);
      console.log(
        `[watchdog] ${cfg.dryRun ? "would " : ""}${cfg.action} ${d.name} (${d.stack}): ${reason}${e.error ? ` — failed: ${e.error}` : ""}`,
      );
      this.events.push(e);
      out.push(e);
    }
    return out;
  }
}
