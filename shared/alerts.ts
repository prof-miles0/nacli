// The alerts: everything that is not working right now. The Status page and
// the sidebar count compute them in the browser, the Discord notifier on the
// server, from the same API answers, so both say the same.

import { fmt } from "./format.ts";
import type { AccountOwner, AppInfo, DragoniteStatus, DragoniteSummary, GolbatSummary } from "./types.ts";

export interface Alert {
  key: string;
  level: "critical" | "warning";
  /** Who has the problem, in bold. */
  subject: string;
  text: string;
  /** The page that shows it. */
  to: string;
  /** The Help step that explains the setting behind it, when it is one. */
  help?: string;
  /** The [[stack]] it belongs to (Rotom and Dragonite take their stack's name); none for Golbat and the like. */
  stack?: string;
}

/** What the alerts are made from: the answers of the API routes of the same names. */
export interface AlertInputs {
  app: AppInfo;
  /** /api/controller-demand */
  demand?: { instances: Record<string, { attempts: number; served: number; rejected: number }> };
  /** /api/dragonite/summary */
  dragonite?: DragoniteSummary;
  /** /api/golbat/summary */
  golbat?: GolbatSummary;
  /** /api/dragonite-rate-limits */
  rates?: { id: string; name: string; rateLimit: NonNullable<DragoniteStatus["rateLimit"]> }[];
  /** /api/dragonite-accounts/duplicates */
  duplicates?: AccountOwner[];
}

export type DragoniteRow = DragoniteSummary["instances"][number];

/** Zapdos scrapes every few seconds; two minutes without data means it is down. */
export const isUp = (d: DragoniteRow) => d.lastSeenS != null && d.lastSeenS < 120;

/**
 * How the Rotom link looks right now: "ok" when its controllers sit on the
 * configured Rotom (or one is detected and none configured), "mismatch" when
 * they show up elsewhere, "none" when no Rotom sees any of its controllers.
 */
export function linkState(d: DragoniteRow): "ok" | "mismatch" | "none" {
  const live = d.links.filter((l) => l.controllers > 0);
  // A stack with no [stack.rotom] expects its controllers on no Rotom.
  if (!live.length) return d.rotom ? "none" : "ok";
  if (!d.rotom) return "ok";
  return live.every((l) => l.rotomId === d.rotom) ? "ok" : "mismatch";
}

const ago = (s?: number) => (s != null ? ` (last seen ${fmt.ago(Date.now() - s * 1000)})` : "");

/** Every alert, critical first. */
export function computeAlerts({ app, demand, dragonite, golbat, rates, duplicates }: AlertInputs): Alert[] {
  const out: Alert[] = [];

  // What the watchdog did in the last hour: a restart says the device was failing.
  for (const e of app.watchdog?.events ?? []) {
    if (Date.now() - e.t > 3_600_000) continue;
    const when = fmt.ago(e.t);
    out.push({
      key: `watchdog:${e.instanceId}:${e.deviceId}:${e.t}`,
      level: e.error ? "critical" : "warning",
      subject: `Device ${e.device}`,
      stack: e.stack,
      text: e.error
        ? `the watchdog could not ${e.action} it ${when} (${e.reason}): ${e.error}`
        : e.dryRun
          ? `the watchdog would have ${e.action === "reboot" ? "rebooted" : "restarted"} it ${when} (dry_run): ${e.reason}`
          : `${e.action === "reboot" ? "rebooted" : "restarted"} by the watchdog ${when}: ${e.reason}`,
      to: "/devices",
      help: "watchdog",
    });
  }

  const rotomName = (id: string) => app.instances.find((i) => i.id === id)?.name ?? id;

  // Alive, but working on nothing: no location handled for an hour.
  for (const d of app.dragoniteIdle ?? []) {
    out.push({
      key: `dragonite-idle:${d.id}`,
      level: "warning",
      subject: `Dragonite ${d.name}`,
      stack: d.name,
      text: "has handled no locations in the last hour: check its areas, workers and accounts",
      to: "/dragonite/areas",
    });
  }

  // Charts still come from Zapdos, but nothing new has arrived for 30 minutes.
  for (const z of app.zapdosQuiet ?? []) {
    const label = z.kind === "rotom" ? `Rotom ${z.name}` : z.kind === "dragonite" ? `Dragonite ${z.name}` : "Golbat";
    out.push({
      key: `zapdos-quiet:${z.kind}:${z.zapdosInstance}`,
      level: "warning",
      subject: label,
      stack: z.kind === "golbat" ? undefined : z.name,
      text: `has sent nothing to Zapdos in the last 30 minutes (as "${z.zapdosInstance}"): check that Zapdos still scrapes it`,
      to: "/status",
      help: "zapdos",
    });
  }

  for (const i of app.instances) {
    if (!i.reachable) {
      out.push({
        key: `rotom:${i.id}`,
        level: "critical",
        subject: `Rotom ${i.name}`,
        stack: i.name,
        text: `offline${i.lastError ? ` (${i.lastError})` : ""}`,
        to: `/instances#${i.id}`,
        help: "stacks",
      });
      continue;
    }
    const d = demand?.instances[i.id];
    // Same threshold as the Workers page badge: ignore the odd reconnect.
    if (d && d.rejected >= Math.max(5, d.attempts * 0.05)) {
      out.push({
        key: `rejected:${i.id}`,
        level: "warning",
        subject: `Rotom ${i.name}`,
        stack: i.name,
        text: `rejects ≈${fmt.int(d.rejected)} controllers/h for lack of free workers`,
        to: "/workers",
      });
    }
  }

  for (const d of dragonite?.instances ?? []) {
    const subject = `Dragonite ${d.name}`;
    if (!isUp(d)) {
      out.push({ key: `dragonite:${d.id}`, level: "critical", subject, stack: d.name, text: `isn't sending metrics${ago(d.lastSeenS)}`, to: "/", help: "zapdos" });
      continue;
    }
    const state = linkState(d);
    if (state === "none") {
      out.push({
        key: `dragonite-link:${d.id}`,
        level: "warning",
        subject,
        stack: d.name,
        text: `no Rotom sees its controllers${d.rotom ? ` (should be on ${rotomName(d.rotom)})` : ""}`,
        to: "/",
        help: "stack-links",
      });
    } else if (state === "mismatch") {
      const where = d.links.filter((l) => l.controllers > 0 && l.rotomId !== d.rotom).map((l) => rotomName(l.rotomId));
      out.push({
        key: `dragonite-link:${d.id}`,
        level: "warning",
        subject,
        stack: d.name,
        text: `has controllers on ${where.join(", ")}, but is configured for ${rotomName(d.rotom!)}`,
        to: "/",
        help: "stack-links",
      });
    }
  }
  // Dragonite slowed itself down: the admin's "Global Rate Limit Degraded" banner.
  for (const r of rates ?? []) {
    const l = r.rateLimit;
    if (l.ratio >= 1) continue;
    out.push({
      key: `rate:${r.id}`,
      level: l.ratio < 0.25 ? "critical" : "warning",
      subject: `Dragonite ${r.name}`,
      stack: r.name,
      text: `global rate limit degraded to ${fmt.dec2(l.allowedPerSecond)}/s (${fmt.pct(l.ratio * 100)} of base): ${l.lastDecreaseReason || "unknown reason"}${
        l.lastDecreaseAt ? ` · ${fmt.ago(l.lastDecreaseAt * 1000)}` : ""
      }`,
      to: "/status",
    });
  }
  for (const u of dragonite?.unmatched ?? []) {
    out.push({
      key: `unmatched:${u.rotomId}:${u.source}`,
      level: "warning",
      subject: `Rotom ${rotomName(u.rotomId)}`,
      stack: rotomName(u.rotomId),
      text: `has ${u.controllers} controller${u.controllers === 1 ? "" : "s"} from "${u.source}", which matches no [[stack]]`,
      to: "/",
      help: "stack-links",
    });
  }

  // An account in two stacks: both use it and get in each other's way.
  const dup = duplicates ?? [];
  if (dup.length) {
    const names = dup.slice(0, 3).map((o) => o.username).join(", ");
    out.push({
      key: "account-duplicates",
      level: "warning",
      subject: `${dup.length} account${dup.length === 1 ? "" : "s"}`,
      text: `in more than one stack: ${names}${dup.length > 3 ? "…" : ""}`,
      to: "/dragonite/accounts",
    });
  }

  const g = golbat;
  if (g && (g.lastSeenS == null || g.lastSeenS >= 120)) {
    out.push({ key: "golbat", level: "critical", subject: "Golbat", text: `isn't sending metrics${ago(g.lastSeenS)}`, to: "/golbat/metrics", help: "golbat" });
  }

  // Critical first; stable otherwise.
  // Critical first; stable otherwise.
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1));
}
