import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, CheckCircle2, CircleAlert, CirclePause, CircleX, Gauge, Group, type LucideIcon, MemoryStick, RefreshCw, Router, TrafficCone, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { DragoniteStatus, InstanceInfo, SystemStatus } from "@shared/types";
import { OneLine } from "@/components/one-line";
import { toast } from "@/components/toaster";
import { Button, Card, HoverCard, Input, Label, Modal, Spinner } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAppInfo, useInstanceColor } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";

type Level = "ok" | "info" | "warn" | "error" | "off";

const LEVEL: Record<Level, { color: string; icon: typeof CheckCircle2 }> = {
  ok: { color: "#22c55e", icon: CheckCircle2 },
  info: { color: "#3b82f6", icon: Gauge },
  warn: { color: "#f59e0b", icon: TriangleAlert },
  error: { color: "#ef4444", icon: CircleX },
  off: { color: "var(--muted-foreground)", icon: CircleAlert },
};

/** The admin's colours for the global rate limit: full, half, a quarter, less. */
const rateLevel = (ratio: number): Level => (ratio >= 1 ? "ok" : ratio >= 0.5 ? "info" : ratio >= 0.25 ? "warn" : "error");

const RELEASES = "https://github.com/UnownHash/Dragonite-Public/releases/tag/dragonite-v";
const ROTOM_RELEASES = "https://github.com/UnownHash/RotomNG/releases/tag/rotom-ng-v";
const ago = (s?: number) => (s ? fmt.ago(s * 1000) : "never");

/**
 * One line of a status card: icon, what it is and its state on the first line,
 * a detail on the second (kept, empty, when there is none) and, for some, a
 * third. Every row has the same shape, so cards side by side line up row by
 * row; text too long for its line slides instead of wrapping.
 */
function Row({ label, level, value, detail, extra }: { label: string; level: Level; value: ReactNode; detail?: ReactNode; extra?: ReactNode }) {
  const L = LEVEL[level];
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 py-1.5">
      <L.icon className="size-4" style={{ color: L.color }} />
      <OneLine className="text-sm leading-5 text-muted-foreground">{label}</OneLine>
      <span className="flex h-5 items-center justify-self-end text-sm font-medium whitespace-nowrap">{value}</span>
      <div className="col-start-2 col-end-4 h-4 min-w-0 text-xs leading-4 text-muted-foreground">{typeof detail === "string" ? <OneLine>{detail}</OneLine> : detail}</div>
      {extra !== undefined ? <div className="col-start-2 col-end-4 h-4 min-w-0 text-xs leading-4 text-muted-foreground">{typeof extra === "string" ? <OneLine>{extra}</OneLine> : extra}</div> : null}
    </div>
  );
}

/** Warnings at the top, as the admin's banners: degraded rate limit, missing Kōji/Golbat, updates. */
function Banners({ data }: { data: SystemStatus }) {
  const items: { key: string; level: Level; text: ReactNode }[] = [];
  for (const d of data.dragonite) {
    if (!d.reachable) {
      items.push({ key: `down:${d.id}`, level: "error", text: <><b>Dragonite {d.name}</b> isn't answering{d.error ? `: ${d.error}` : ""}</> });
      continue;
    }
    // A degraded rate limit is in the alert box on every page (and in its card below).
    if (d.hasKoji === false) items.push({ key: `koji:${d.id}`, level: "warn", text: <><b>{d.name}</b>: Kōji is not configured — routes and geofences may be stale.</> });
    const lost = Object.entries(d.golbat?.discarded ?? {}).filter(([, n]) => n > 0);
    if (lost.length) {
      items.push({
        key: `golbat:${d.id}`,
        level: "warn",
        text: (
          <>
            <b>{d.name}</b> is discarding data for Golbat: {lost.map(([k, n]) => `${fmt.int(n)} ${k.replaceAll("_", " ")}`).join(", ")} in the last 15 min.
          </>
        ),
      });
    }
    if (d.update) {
      items.push({
        key: `update:${d.id}`,
        level: "info",
        text: (
          <>
            <b>{d.name}</b> runs v{d.version}:{" "}
            <a href={`${RELEASES}${d.update}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              v{d.update}
            </a>{" "}
            is available.
          </>
        ),
      });
    }
  }
  for (const r of data.rotom) {
    if (!r.update) continue;
    items.push({
      key: `rotom-update:${r.id}`,
      level: "info",
      text: (
        <>
          <b>Rotom {r.name}</b> runs v{r.version}:{" "}
          <a href={`${ROTOM_RELEASES}${r.update}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            v{r.update}
          </a>{" "}
          is available.
        </>
      ),
    });
  }
  if (data.golbat?.api && data.golbat.apiOk === false) {
    items.push({ key: "golbat-api", level: "error", text: <><b>Golbat</b> API isn't answering{data.golbat.apiError ? `: ${data.golbat.apiError}` : ""}</> });
  }
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {items.map((b) => {
        const L = LEVEL[b.level];
        return (
          <div
            key={b.key}
            className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: `color-mix(in oklab, ${L.color} 40%, var(--border))`, background: `color-mix(in oklab, ${L.color} 10%, transparent)` }}
          >
            <L.icon className="mt-0.5 size-4 shrink-0" style={{ color: L.color }} />
            <div className="min-w-0">{b.text}</div>
          </div>
        );
      })}
    </div>
  );
}

/** A green "Up to date" tag, so it shows at a glance. */
function UpToDate() {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full border border-green-500/40 bg-green-500/15 px-2 text-[11px] font-semibold text-green-400">
      <CheckCircle2 className="size-3" />
      Up to date
    </span>
  );
}

/**
 * Versions at a glance: a green card when every Dragonite and Rotom runs the
 * newest release of its channel, blue (listing only what is behind) when
 * something can be updated.
 */
function VersionsSummary({ data, instances }: { data: SystemStatus; instances: InstanceInfo[] }) {
  const drag = data.dragonite.filter((d) => d.reachable && d.version);
  const rot = data.rotom.filter((r) => r.version && instances.find((i) => i.id === r.id)?.reachable);
  const known = (drag.length ? !!(data.releases?.stable || data.releases?.testing) : true) && (rot.length ? !!data.rotomReleases?.stable : true);
  if (!drag.length && !rot.length) return null;
  const updates = [
    ...drag.filter((d) => d.update).map((d) => ({ key: `d:${d.id}`, text: `Dragonite ${d.name}: v${d.version} → v${d.update}`, href: `${RELEASES}${d.update}` })),
    ...rot.filter((r) => r.update).map((r) => ({ key: `r:${r.id}`, text: `Rotom ${r.name}: v${r.version} → v${r.update}`, href: `${ROTOM_RELEASES}${r.update}` })),
  ];
  const tone = !known ? "var(--muted-foreground)" : updates.length ? "#3b82f6" : "#22c55e";
  const Icon = !known ? CircleAlert : updates.length ? ArrowUpCircle : CheckCircle2;
  return (
    <div
      className={cn("flex gap-3 rounded-xl border px-4 py-3", updates.length ? "items-start" : "items-center")}
      style={{ borderColor: `color-mix(in oklab, ${tone} 45%, var(--border))`, background: `color-mix(in oklab, ${tone} 12%, var(--card))` }}
    >
      <Icon className={cn("size-6 shrink-0", updates.length && "mt-0.5")} style={{ color: tone }} />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold" style={{ color: tone }}>
          {!known ? "Checking for updates…" : updates.length ? `${updates.length} update${updates.length === 1 ? "" : "s"} available` : "Everything is up to date"}
        </p>
        {updates.length ? (
          <ul className="flex flex-col gap-0.5 text-sm">
            {updates.map((u) => (
              <li key={u.key}>
                <a href={u.href} target="_blank" rel="noreferrer" className="hover:underline">
                  {u.text}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mt-2 text-lg font-bold">{children}</h2>;
}

function DragoniteCard({ d, releases, color }: { d: DragoniteStatus; releases: SystemStatus["releases"]; color: string }) {
  const r = d.rateLimit;
  const lost = Object.entries(d.golbat?.discarded ?? {}).filter(([, n]) => n > 0);
  const latest = d.channel === "stable" ? releases?.stable : releases?.testing;
  return (
    <Card className="gap-1 p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 font-semibold">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
          <OneLine>{d.name}</OneLine>
        </h3>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap", d.reachable ? "text-green-400" : "text-red-400")}>
          <span className={cn("size-2 rounded-full", d.reachable ? "bg-green-500" : "bg-red-500")} />
          {d.reachable ? `online · ${d.latencyMs} ms` : "offline"}
        </span>
      </div>
      {!d.reachable ? (
        <OneLine className="text-sm text-red-300">{d.error ?? "no answer"}</OneLine>
      ) : (
        <div className="flex flex-col divide-y divide-border/60">
          <Row
            label="Version"
            level={d.update ? "info" : latest ? "ok" : "off"}
            value={
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                v{d.version}
                {!d.update && latest ? <UpToDate /> : null}
                {d.update ? (
                  <a href={`${RELEASES}${d.update}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-400 hover:underline">
                    <ArrowUpCircle className="size-3.5" />v{d.update}
                  </a>
                ) : null}
              </span>
            }
            // Nothing to say when it is up to date, unless testing already has something newer.
            detail={
              d.update
                ? `Update available on the ${d.channel} channel.`
                : latest
                  ? d.testing
                    ? `v${d.testing} is out on testing.`
                    : undefined
                  : releases?.error
                    ? `Couldn't check for updates: ${releases.error}`
                    : "Checking for updates…"
            }
          />
          <Row label="Kōji" level={d.hasKoji ? "ok" : "warn"} value={d.hasKoji ? "Configured" : "Not configured"} />
          <Row
            label="Golbat"
            level={!d.golbat ? "off" : !d.golbat.configured ? "warn" : lost.length ? "warn" : "ok"}
            value={!d.golbat ? "Unknown" : !d.golbat.configured ? "No target" : lost.length ? "Discarding data" : "Sending"}
            detail={
              !d.golbat
                ? "Needs Dragonite's metrics to tell."
                : !d.golbat.configured
                  ? "Dragonite has no Golbat to send raw data to."
                  : lost.length
                    ? `${lost.map(([k, n]) => `${fmt.int(n)} ${k.replaceAll("_", " ")}`).join(", ")} in the last 15 min`
                    : "Nothing discarded in the last 15 min."
            }
          />
          {r ? (
            <Row
              label="Global rate limit"
              level={rateLevel(r.ratio)}
              value={<span className="tabular-nums">{fmt.dec2(r.allowedPerSecond)}/s</span>}
              detail={
                <div className="flex h-4 items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, r.ratio * 100)}%`, background: LEVEL[rateLevel(r.ratio)].color }} />
                  </div>
                  <span className="shrink-0 tabular-nums">{fmt.pct(r.ratio * 100)} of base</span>
                </div>
              }
              extra={`Last decrease ${ago(r.lastDecreaseAt)}${r.lastDecreaseReason ? ` (${r.lastDecreaseReason})` : ""} · last recovery ${ago(r.lastRecoveryAt)}${
                r.waiters ? ` · ${r.waiters} waiting` : ""
              }${r.pauseSecondsRemaining ? ` · paused ${fmt.duration(r.pauseSecondsRemaining * 1000)} more` : ""}`}
            />
          ) : null}
          {d.rateEvents.length ? (
            <div className="flex flex-col gap-1 py-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase">Rate-limit drops seen</span>
              <ul className="flex flex-col gap-0.5 text-xs">
                {d.rateEvents.slice(0, 8).map((e) => (
                  <li key={e.at} className="flex items-baseline justify-between gap-3">
                    <OneLine className="flex-1">{e.reason || "unknown reason"}</OneLine>
                    <HoverCard content={<span>{fmt.time(e.at * 1000)}</span>}>
                      <span className="shrink-0 text-muted-foreground tabular-nums">{fmt.ago(e.at * 1000)}</span>
                    </HoverCard>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
      {d.reachable ? <DragoniteControls d={d} /> : null}
    </Card>
  );
}

type Control = "pause-limit" | "reset-limit" | "reload-proxies" | "reload-accounts" | "reload-dragonite";
/** Dragonite Admin's controls, with its icons and in its order. */
const CONTROLS: { action: Control; label: string; hint: string; icon: LucideIcon; done: string }[] = [
  { action: "pause-limit", label: "Pause global limit", hint: "Lifts the global rate limit for a while", icon: CirclePause, done: "global rate limit paused" },
  { action: "reset-limit", label: "Reset global limit", hint: "Puts the global rate limit back to its base rate", icon: TrafficCone, done: "global rate limit reset" },
  { action: "reload-proxies", label: "Reload proxies", hint: "Reads the proxy list again", icon: Router, done: "proxies reloaded" },
  { action: "reload-accounts", label: "Reload accounts", hint: "Reads the accounts again", icon: Group, done: "accounts reloaded" },
  { action: "reload-dragonite", label: "Reload Dragonite", hint: "Reloads its configuration", icon: MemoryStick, done: "reloading its configuration" },
];

/** The admin's top-right controls, for this Dragonite only. */
function DragoniteControls({ d }: { d: DragoniteStatus }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<Control>();
  const [pausing, setPausing] = useState(false);
  const [seconds, setSeconds] = useState("60");
  const run = async (c: (typeof CONTROLS)[number], secs?: number) => {
    setBusy(c.action);
    try {
      await endpoints.dragoniteControl(d.id, c.action, secs);
      toast({ text: `${d.name}: ${c.done}${secs ? ` for ${fmt.int(secs)} s` : ""}` });
      qc.invalidateQueries({ queryKey: ["system-status"] });
      qc.invalidateQueries({ queryKey: ["dragonite-rate-limits"] });
    } catch (e) {
      toast({ text: `${d.name}: couldn't ${c.label.toLowerCase()} — ${(e as Error).message}`, error: true });
    } finally {
      setBusy(undefined);
    }
  };
  const n = Number(seconds);
  const okSeconds = Number.isInteger(n) && n >= 1 && n <= 86_400;
  return (
    // At the bottom of the card, so the buttons of cards side by side line up.
    <div className="mt-auto flex flex-wrap gap-1 border-t pt-3">
      {CONTROLS.map((c) => (
        <HoverCard
          key={c.action}
          className="inline-flex"
          content={
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{c.label}</span>
              <span className="text-muted-foreground">{c.hint}</span>
            </span>
          }
        >
          <Button
            size="icon"
            variant="ghost"
            className="relative size-9 text-muted-foreground hover:text-foreground"
            disabled={!!busy}
            aria-label={c.label}
            onClick={() => (c.action === "pause-limit" ? setPausing(true) : run(c))}
          >
            <c.icon className="size-4.5!" />
            {/* The admin's small refresh badge, spinning while it runs. */}
            <RefreshCw className={cn("absolute right-1 bottom-1 size-3! rounded-full bg-card p-px", busy === c.action && "animate-spin")} />
          </Button>
        </HoverCard>
      ))}
      {pausing ? (
        <Modal
          open
          onClose={() => setPausing(false)}
          title={`Pause ${d.name}'s global rate limit`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPausing(false)}>
                Cancel
              </Button>
              <Button
                disabled={!okSeconds}
                onClick={() => {
                  setPausing(false);
                  run(CONTROLS[0], n);
                }}
              >
                <CirclePause />
                Pause
              </Button>
            </>
          }
        >
          <form
            className="flex flex-col gap-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (!okSeconds) return;
              setPausing(false);
              run(CONTROLS[0], n);
            }}
          >
            <label className="flex flex-col gap-1.5">
              <Label>Seconds</Label>
              <Input type="number" min={1} max={86400} value={seconds} onChange={(e) => setSeconds(e.target.value)} autoFocus className="w-40" />
            </label>
            {!okSeconds ? <span className="text-[11px] text-amber-400">At least 1 second (up to a day).</span> : null}
            <p className="text-xs text-muted-foreground">Same as Pause Global Limit in Dragonite Admin, for this Dragonite only.</p>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

function RotomCard({ i, color, v, releases }: { i: InstanceInfo; color: string; v?: SystemStatus["rotom"][number]; releases: SystemStatus["rotomReleases"] }) {
  const s = i.summary;
  return (
    <Card className="gap-1 p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 font-semibold">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
          <OneLine>{i.name}</OneLine>
        </h3>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap", i.reachable ? "text-green-400" : "text-red-400")}>
          <span className={cn("size-2 rounded-full", i.reachable ? "bg-green-500" : "bg-red-500")} />
          {i.reachable ? `online${i.latencyMs != null ? ` · ${Math.round(i.latencyMs)} ms` : ""}` : "offline"}
        </span>
      </div>
      {!i.reachable ? (
        <OneLine className="text-sm text-red-300">{i.lastError ?? "no answer"}</OneLine>
      ) : (
        <div className="flex flex-col divide-y divide-border/60">
          <Row
            label="Version"
            level={!i.config?.version ? "off" : v?.update ? "info" : releases?.stable ? "ok" : "off"}
            value={
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                {i.config?.version ? `v${i.config.version}` : "unknown"}
                {i.config?.version && !v?.update && releases?.stable ? <UpToDate /> : null}
                {v?.update ? (
                  <a href={`${ROTOM_RELEASES}${v.update}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-400 hover:underline">
                    <ArrowUpCircle className="size-3.5" />v{v.update}
                  </a>
                ) : null}
              </span>
            }
            detail={
              !i.config?.version
                ? undefined
                : v?.update
                  ? "Update available."
                  : releases?.stable
                    ? v?.preRelease
                      ? `Pre-release v${v.preRelease} is out.`
                      : undefined
                    : releases?.error
                      ? `Couldn't check for updates: ${releases.error}`
                      : "Checking for updates…"
            }
          />
          {s ? (
            <>
              <Row
                label="Devices"
                level={s.devicesConnected < s.devices ? "warn" : "ok"}
                value={<span className="tabular-nums">{`${s.devicesConnected}/${s.devices}`}</span>}
                detail={s.devicesConnected < s.devices ? `${s.devices - s.devicesConnected} offline` : undefined}
              />
              <Row label="Workers in use" level="ok" value={<span className="tabular-nums">{`${s.workersInUse}/${s.workersConnected}`}</span>} />
              <Row label="Controllers" level={s.controllers ? "ok" : "warn"} value={<span className="tabular-nums">{s.controllers}</span>} />
            </>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function GolbatCard({ g }: { g: NonNullable<SystemStatus["golbat"]> }) {
  const fresh = g.lastSeenS != null && g.lastSeenS < 120;
  return (
    <Card className="gap-1 p-4">
      {/* One column per check, split by lines: across on phones, down on wider screens. */}
      <div className="flex flex-col divide-y divide-border/60 md:flex-row md:divide-x md:divide-y-0 [&>*]:min-w-0 [&>*]:flex-1 md:[&>*]:px-5 md:[&>*:first-child]:pl-0 md:[&>*:last-child]:pr-0">
        {g.api ? (
          <Row label="API" level={g.apiOk ? "ok" : "error"} value={g.apiOk ? <span className="text-green-400">Healthy · {g.apiLatencyMs} ms</span> : "Not answering"} detail={g.apiOk ? undefined : g.apiError} />
        ) : null}
        {g.metrics ? (
          <Row
            label="Metrics"
            level={fresh ? "ok" : "error"}
            value={g.lastSeenS == null ? "None" : fresh ? "Fresh" : "Stale"}
            detail={g.lastSeenS != null ? `last sample ${fmt.duration(g.lastSeenS * 1000)} ago` : undefined}
          />
        ) : null}
        {g.metrics ? (
          <Row
            label="Raw data · 1h"
            level={g.rawErrors ? "warn" : "ok"}
            value={<span className="tabular-nums">{fmt.int(g.rawOk ?? 0)} ok</span>}
            detail={g.rawErrors ? `${fmt.int(g.rawErrors)} with errors` : undefined}
          />
        ) : null}
      </div>
    </Card>
  );
}

const KIND_LABEL = { rotom: "Rotom", dragonite: "Dragonite", golbat: "Golbat" } as const;

/**
 * Zapdos (its VictoriaMetrics): whether it answers, and which instances' charts
 * it holds. Full width: its health, then a column per kind of instance.
 */
function ZapdosCard({ z }: { z: SystemStatus["zapdos"] }) {
  const ok = !!z.health?.ok;
  const groups = (["rotom", "dragonite", "golbat"] as const)
    .map((kind) => [kind, z.instances.filter((x) => x.kind === kind)] as const)
    .filter(([, list]) => list.length);
  return (
    <Card className="gap-1 p-4">
      <div className="flex flex-col gap-3">
        <Row
          label="VictoriaMetrics"
          level={ok ? "ok" : "error"}
          value={
            ok ? (
              <span className="text-green-400">Healthy · {z.health?.latencyMs} ms</span>
            ) : (
              "Not answering"
            )
          }
          detail={ok ? undefined : z.health?.error}
        />
        {/* Its data, one column per kind of instance. */}
        {groups.length ? (
          // Separated by lines: across on phones, down between columns on wider screens.
          <div className="flex flex-col divide-y divide-border/60 border-t border-border/60 md:flex-row md:divide-x md:divide-y-0">
            {groups.map(([kind, list]) => (
              <div key={kind} className="flex min-w-0 flex-1 flex-col py-3 md:px-5 md:first:pl-0 md:last:pr-0">
                <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{KIND_LABEL[kind]}</span>
                <div className="flex flex-col divide-y divide-border/60">
                  {list.map((x) => (
                    <Row
                      key={x.zapdosInstance}
                      label={kind === "golbat" ? x.zapdosInstance : x.name}
                      level={x.hasData === undefined ? "off" : x.hasData && !x.quiet ? "ok" : "warn"}
                      value={x.hasData === undefined ? "Checking…" : x.quiet ? "Quiet" : x.hasData ? "Data" : "No data"}
                      detail={
                        x.quiet ? (
                          <span title={`Data as “${x.zapdosInstance}”, but none in the last hour: check that Zapdos still scrapes it`}>Nothing in the last hour</span>
                        ) : x.hasData === false ? (
                          <span title={`Nothing as “${x.zapdosInstance}” in the last 30 days`}>Charts from memory</span>
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function StatusPage() {
  const { data: app } = useAppInfo();
  const color = useInstanceColor();
  const q = useQuery({ queryKey: ["system-status"], queryFn: endpoints.systemStatus, refetchInterval: 15_000 });
  if (!app || (!q.data && !q.error)) return <Spinner className="mx-auto mt-20" />;
  if (q.error) return <p className="text-sm text-red-300">{(q.error as Error).message}</p>;
  const data = q.data!;
  const stackColor = (rotom?: string) => (rotom ? color(rotom) : "var(--muted-foreground)");
  return (
    <div className="animate-in flex flex-col gap-4">
      <VersionsSummary data={data} instances={app.instances} />
      <Banners data={data} />
      {data.dragonite.length ? (
        <>
          <SectionTitle>Dragonite</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {data.dragonite.map((d) => (
              <DragoniteCard key={d.id} d={d} releases={data.releases} color={stackColor(d.rotom)} />
            ))}
          </div>
        </>
      ) : null}
      {app.instances.length ? (
        <>
          <SectionTitle>Rotom</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {app.instances.map((i) => (
              <RotomCard key={i.id} i={i} color={color(i.id)} v={data.rotom.find((r) => r.id === i.id)} releases={data.rotomReleases} />
            ))}
          </div>
        </>
      ) : null}
      {data.golbat ? (
        <>
          <SectionTitle>Golbat</SectionTitle>
          <GolbatCard g={data.golbat} />
        </>
      ) : null}
      {data.zapdos.configured ? (
        <>
          <SectionTitle>Zapdos</SectionTitle>
          <ZapdosCard z={data.zapdos} />
        </>
      ) : null}
      <footer className="mt-2 flex flex-col items-center gap-1 border-t border-border/60 pt-4 text-center text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <RefreshCw className="size-3" />
          Checked {fmt.ago(data.checkedAt)} · updates every 15 s
        </span>
        <span>
          Releases from GitHub{data.releases?.checkedAt ? `, checked ${fmt.ago(data.releases.checkedAt)}` : ""} · rate-limit drops since Nacli started
        </span>
      </footer>
    </div>
  );
}
