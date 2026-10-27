import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Check, ChevronRight, CirclePlay, CircleStop, Copy, Eye, Minus, Pencil, Plus, PowerOff } from "lucide-react";
import { Fragment, useState } from "react";
import { Link } from "react-router";
import type { AreaQuests, DragoniteArea, DragoniteAreas, DragoniteInfo, DragoniteLiveGroup, DragoniteLiveWorker } from "@shared/types";
import { useNotify } from "@/components/actions";
import { toast } from "@/components/toaster";
import { CreateAreaModal } from "@/components/area-create";
import { KOJI_OPTIONS, KojiModal } from "@/components/area-form";
import { AreaEditModal, AreaViewModal } from "@/components/area-view";
import { QuestModal, questsStarted, type QuestRequest } from "@/components/quest-actions";
import { type FolderTab, FolderTabs, tabTint } from "@/components/folder-tabs";
import { HeadStat, MiniProgress } from "@/components/head-stat";
import { MenuButton } from "@/components/menu-button";
import { useStacks } from "@/components/stack-tag";
import { StatusDot, type StatusTone } from "@/components/status-dot";
import { matches, SearchBox, useSorted } from "@/components/table-tools";
import { Button, Card, HoverCard, Input, Label, Modal, Spinner, Table } from "@/components/ui";
import { expectSaved } from "@/lib/area-pending";
import { ApiError, endpoints } from "@/lib/api";
import { useAppInfo, useInstanceColor } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";
import { useChosenStack } from "@/lib/stack-choice";

/** Running at full strength, short of workers, idle, or switched off. */
function areaState(a: DragoniteArea): { tone: StatusTone; label: string; detail?: string } {
  if (!a.enabled) return { tone: "off", label: "Disabled" };
  const l = a.live;
  if (!l || l.expected === 0) return { tone: "warn", label: "Enabled, no workers" };
  if (l.active < l.expected) return { tone: "warn", label: "Short of workers", detail: `${l.active} of ${l.expected}` };
  return { tone: "good", label: "Running", detail: `${l.active} workers` };
}

/**
 * How many of the area's Pokéstops Golbat has a quest for, as on Statistics:
 * the share, a bar and, on hover, AR and non-AR of all the stops.
 */
function QuestsScanned({ q, inline, scanning }: { q?: AreaQuests[number]; inline?: boolean; scanning?: boolean }) {
  if (!q) return <span className="text-muted-foreground/60">…</span>;
  if ("error" in q) return <span className="text-xs text-red-400" title={q.error}>error</span>;
  if (!q.stops) return <span className="text-muted-foreground/60">no stops</span>;
  const done = q.ar + q.noAr;
  const p = (done / q.stops) * 100;
  const color = p >= 99 ? "#22c55e" : p >= 80 ? "#f59e0b" : "#ef4444";
  return (
    <HoverCard
      content={
        <div className="flex flex-col gap-0.5 tabular-nums">
          <span>
            AR quests <b>{fmt.int(q.ar)}</b>
          </span>
          <span>
            Non-AR quests <b>{fmt.int(q.noAr)}</b>
          </span>
          <span className="text-muted-foreground">Of {fmt.int(q.stops)} Pokéstops, from Golbat</span>
          {scanning ? <span className="text-sky-400">Quest scan running · updated every 15 s</span> : null}
        </div>
      }
    >
      {inline ? (
        // One line, as the workers bar beside it on a phone card.
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, p)}%`, background: color }} />
          </div>
          <span className="inline-flex w-12 items-center justify-end gap-1 text-xs font-semibold tabular-nums">
            {scanning ? <ScanDot /> : null}
            {fmt.pct(p)}
          </span>
        </div>
      ) : (
        <div className="flex min-w-24 flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 tabular-nums">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              {fmt.pct(p)}
              {scanning ? <ScanDot /> : null}
            </span>
            <span className="text-[11px] whitespace-nowrap text-muted-foreground">
              {fmt.int(done)} / {fmt.int(q.stops)}
            </span>
          </div>
          <MiniProgress value={done} max={q.stops} color={color} />
        </div>
      )}
    </HoverCard>
  );
}

/** A quest scan is running in the area. */
const ScanDot = () => (
  <span className="relative flex size-2 shrink-0" aria-label="Quest scan running">
    <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-60" />
    <span className="relative inline-flex size-2 rounded-full bg-sky-400" />
  </span>
);

const Flag = ({ on }: { on: boolean }) =>
  on ? <Check className="size-4 text-green-400" /> : <Minus className="size-4 text-muted-foreground/50" />;

/** Live workers vs. what the area asks for. */
export function LiveBar({ l }: { l?: DragoniteLiveGroup }) {
  if (!l || l.expected === 0) return <span className="text-muted-foreground">—</span>;
  const pct = Math.min(100, (l.active / l.expected) * 100);
  return (
    <div className="flex min-w-28 items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", l.active < l.expected ? "bg-amber-500" : "bg-green-500")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs font-semibold tabular-nums">
        {l.active}/{l.expected}
      </span>
    </div>
  );
}

const MODES: Record<string, string> = {
  PokemonMode: "Pokémon",
  QuestMode: "Quests",
  FortMode: "Forts",
  InvasionMode: "Invasions",
  ScoutMode: "Scout",
  RarePokemonMode: "Rare",
  LevelMode: "Level",
};

export function WorkersTable({ workers, color }: { workers: DragoniteLiveWorker[]; color: (id: string) => string }) {
  if (!workers.length) {
    return <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">No workers assigned right now.</p>;
  }
  const now = Date.now();
  const th = "px-2.5 py-1 font-medium";
  return (
    <div className="overflow-hidden rounded-lg border bg-background/40">
      <div className="flex items-center gap-2 border-b px-2.5 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Workers now
        <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums normal-case">{workers.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] tracking-wide text-muted-foreground/80 uppercase">
            <tr>
              <th className={th}>Worker</th>
              <th className={th}>Device</th>
              <th className={th}>Account</th>
              <th className={th}>Mode</th>
              <th className={th}>Route</th>
              <th className={th}>Last data</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {[...workers]
              .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
              .map((w) => {
                const stale = w.lastData && now - w.lastData * 1000 > 5 * 60_000;
                return (
                  <tr key={`${w.name}:${w.deviceId}`} className="border-t border-border/40 transition-colors hover:bg-foreground/5">
                    <td className="px-2.5 py-1 font-medium whitespace-nowrap">{w.name || "—"}</td>
                    <td className="px-2.5 py-1 whitespace-nowrap">
                      <HoverCard
                        content={
                          <span className="flex flex-col gap-0.5">
                            <span className="font-mono">{w.deviceId || "no device"}</span>
                            {w.rotom ? <span className="text-muted-foreground">Open it in Rotom › Devices</span> : null}
                          </span>
                        }
                      >
                        {w.rotom ? (
                          // To the device in its own stack's RotomNG.
                          <Link
                            to={`/devices?${new URLSearchParams({ instance: w.rotom.rotomId, device: w.rotom.deviceId, worker: w.deviceId })}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline"
                          >
                            <span className="size-2 rounded-full" style={{ background: color(w.rotom.rotomId) }} />
                            {w.rotom.device}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{w.deviceId ? "unknown" : "—"}</span>
                        )}
                      </HoverCard>
                    </td>
                    <td className="px-2.5 py-1 font-mono text-[11px] text-muted-foreground">{w.account || "—"}</td>
                    <td className="px-2.5 py-1 whitespace-nowrap">{MODES[w.mode] ?? (w.mode || "—")}</td>
                    <td className="px-2.5 py-1">
                      {w.task && w.task.total ? (
                        <HoverCard
                          content={
                            <span className="tabular-nums">
                              {w.task.name}: point {w.task.pos} of {w.task.part} in this leg ({w.task.total} on the route) ·{" "}
                              {fmt.duration(w.task.seconds * 1000)} on the route
                            </span>
                          }
                        >
                          <div className="flex min-w-24 items-center gap-2">
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-blue-500"
                                style={{ width: `${Math.min(100, (w.task.pos / Math.max(1, w.task.part)) * 100)}%` }}
                              />
                            </div>
                            <span className="tabular-nums text-muted-foreground">
                              {w.task.pos}/{w.task.part}
                            </span>
                          </div>
                        </HoverCard>
                      ) : (
                        <span className="text-muted-foreground">{w.task?.name ?? "—"}</span>
                      )}
                    </td>
                    <td className={cn("px-2.5 py-1 whitespace-nowrap tabular-nums", stale ? "text-amber-400" : "text-muted-foreground")}>
                      {w.lastData ? fmt.ago(w.lastData * 1000) : "—"}
                    </td>
                    <td className="px-2.5 py-1 whitespace-nowrap">
                      {w.status ? <span className="rounded bg-muted/70 px-1.5 py-px text-[10px] text-muted-foreground">{w.status}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}



export function DragoniteAreasPage() {
  const { data: app } = useAppInfo();
  const withApi = (app?.dragonite ?? []).filter((d) => d.accounts);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  // One stack at a time: the one picked last on any page, else the first.
  const [chosen, choose] = useChosenStack();
  const current = withApi.find((d) => d.id === chosen) ?? withApi[0];

  if (!app) return <Spinner className="mx-auto mt-20" />;
  if (!withApi.length || !current) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        No <code className="rounded bg-muted px-1">[stack.dragonite]</code> has a <code className="rounded bg-muted px-1">url</code> in config.toml.
      </Card>
    );
  }

  return (
    <div className="animate-in flex flex-col">
      <StackAreas
        key={current.id}
        stack={current}
        stacks={withApi}
        search={search}
        tabs={withApi.length > 1 ? <StackTabs stacks={withApi} value={current.id} onChange={choose} /> : undefined}
        tabbed={withApi.length > 1}
        toolbar={<SearchBox value={search} onChange={setSearch} placeholder="Search areas…" />}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            New
          </Button>
        }
      />
      {creating ? <CreateAreaModal stacks={withApi} initial={current.id} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

/** The stacks as folder tabs, each one with its enabled areas out of all. */
function StackTabs({ stacks, value, onChange }: { stacks: DragoniteInfo[]; value: string; onChange: (id: string) => void }) {
  return <FolderTabs label="Stack" tabs={useStackTabs(stacks)} value={value} onChange={onChange} />;
}

export function useStackTabs(stacks: DragoniteInfo[]): FolderTab[] {
  const color = useInstanceColor();
  const areas = useQueries({
    queries: stacks.map((d) => ({
      queryKey: ["dragonite-areas", d.id],
      queryFn: () => endpoints.dragoniteAreas(d.id),
      refetchInterval: 15_000,
    })),
  });
  return stacks.map((d, i) => {
    const data = areas[i].data;
    const on = data?.areas.filter((a) => a.enabled).length;
    return {
      id: d.id,
      label: d.name,
      color: d.rotom ? color(d.rotom) : undefined,
      summary: data ? `${on}/${data.areas.length} areas` : undefined,
    };
  });
}

/** One stack's areas: its summary, its table and its modes without an area. */
function StackAreas({
  stack,
  stacks,
  search,
  tabs,
  tabbed,
  toolbar,
  actions,
}: {
  stack: DragoniteInfo;
  stacks: DragoniteInfo[];
  search: string;
  /** Folder tabs drawn on top of the header, the selected one joined to it. */
  tabs?: React.ReactNode;
  /** Which outer corner the selected tab sits on (that corner goes square). */
  /** Under folder tabs: square top corners, since the tabs cover its whole top edge. */
  tabbed?: boolean;
  /** Shown between the header and the areas (the search box). */
  toolbar?: React.ReactNode;
  /** Buttons at the right of that row (e.g. "New"). */
  actions?: React.ReactNode;
}) {
  const color = useInstanceColor();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<DragoniteArea>();
  const [viewing, setViewing] = useState<DragoniteArea>();
  /** The area's name, which opens its View (the admin's "Show"); the rest of the row expands it. */
  const nameLink = (a: DragoniteArea, className: string) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setViewing(a);
      }}
      title="View its geofence, routes and settings"
      className={cn("min-w-0 truncate text-left underline-offset-4 hover:underline", !a.enabled && "text-muted-foreground", className)}
    >
      {a.name}
    </button>
  );
  // The switch acts at once (no confirmation): it shows the new state while
  // Dragonite applies it, and goes back with a message if it fails.
  const [pendingOn, setPendingOn] = useState<Record<number, boolean>>({});
  const { notify, node: notice } = useNotify();
  const switchArea = async (a: DragoniteArea) => {
    if (a.id in pendingOn) return;
    const next = !a.enabled;
    setPendingOn((p) => ({ ...p, [a.id]: next }));
    try {
      await endpoints.setAreaEnabled(stack.id, a.id, next);
      // Its new target at once (all its workers, or none); the reload shows Dragonite taking it up.
      qc.setQueryData<DragoniteAreas>(["dragonite-areas", stack.id], (old) =>
        old ? { ...old, areas: old.areas.map((x) => (x.id === a.id ? expectSaved(stack.id, x, { ...x, enabled: next }) : x)) } : old,
      );
      await qc.invalidateQueries({ queryKey: ["dragonite-areas", stack.id] });
      notify({ text: `${a.name} ${next ? "enabled" : "disabled"} on ${stack.name}` });
    } catch (e) {
      // A conflict (409) is a warning (e.g. the area is busy), not a failure.
      notify({ text: `${a.name}: ${(e as Error).message}`, tone: e instanceof ApiError && e.status === 409 ? "warning" : "error" });
    } finally {
      setPendingOn(({ [a.id]: _, ...rest }) => rest);
    }
  };
  const [transfer, setTransfer] = useState<{ area: DragoniteArea; move: boolean }>();
  const [disablingAll, setDisablingAll] = useState(false);
  const others = stacks.filter((x) => x.id !== stack.id);
  const [quest, setQuest] = useState<QuestRequest>();
  /** Why an area cannot scan quests now, if it cannot. */
  const noQuests = (a: DragoniteArea) => (!a.enabled ? "The area is disabled" : !a.quest.enabled ? "Its quest mode is off" : undefined);
  /** The "…" menu of an area: edit it, its quests, and copy/move it to another stack (only with more than one). */
  const menu = (a: DragoniteArea) => (
    <MenuButton
      kind="Area"
      subject={a.name}
      items={[
        { key: "view", label: "View", hint: "Its geofence, routes and settings", icon: Eye, onSelect: () => setViewing(a) },
        { key: "edit", label: "Edit", hint: "Geofence, routes, workers and every mode", icon: Pencil, onSelect: () => setEditing(a) },
        {
          key: "quest-start",
          label: "Start quests",
          hint: noQuests(a) ?? "Scans its Pokéstops' quests now",
          icon: CirclePlay,
          positive: true,
          disabled: !!noQuests(a),
          onSelect: () => setQuest({ action: "start", area: a }),
        },
        {
          key: "quest-stop",
          label: "Stop quests",
          hint: noQuests(a) ?? "Stops its quest scan",
          icon: CircleStop,
          danger: true,
          disabled: !!noQuests(a),
          onSelect: () => setQuest({ action: "stop", area: a }),
        },
        ...(others.length
          ? [
              {
                key: "copy",
                label: "Copy to another stack",
                hint: "Creates a copy, with its route, in another Dragonite",
                icon: Copy,
                onSelect: () => setTransfer({ area: a, move: false }),
              },
              {
                key: "move",
                label: "Move to another stack",
                // An area that is scanning must be stopped first: moving it would cut
                // its workers off mid-route.
                hint: a.enabled ? "Disable it first to move it" : "Copies it, then deletes it from this stack",
                icon: ArrowRightLeft,
                danger: true,
                disabled: a.enabled,
                onSelect: () => setTransfer({ area: a, move: true }),
              },
            ]
          : []),
      ]}
    />
  );
  const q = useQuery({
    queryKey: ["dragonite-areas", stack.id],
    queryFn: () => endpoints.dragoniteAreas(stack.id),
    // Every 15 s; a change shows its new target at once (see area-pending), and the bar follows Dragonite.
    refetchInterval: 15_000,
  });
  const enabledAreas = (q.data?.areas ?? []).filter((a) => a.enabled);
  const rows = (q.data?.areas ?? []).filter((a) => matches(search, a.name));
  const { sorted, header } = useSorted(
    rows,
    {
      name: (a) => a.name,
      enabled: (a) => (a.enabled ? 0 : 1),
      live: (a) => a.live?.active ?? -1,
    },
    "name",
  );
  const stackColor = stack.rotom ? color(stack.rotom) : "var(--muted-foreground)";
  const refresh = () => qc.invalidateQueries({ queryKey: ["dragonite-areas", stack.id] });
  // Golbat's quests per area, when [golbat] has its url.
  const { data: app } = useAppInfo();
  const withQuests = !!app?.golbatMap;
  // Areas scanning quests right now (or just started here): their share is read every 15 s, so it climbs as the scan goes.
  const questing = (q.data?.areas ?? []).filter((a) => a.live?.workers.some((w) => w.mode === "QuestMode")).map((a) => a.id);
  const scanning = [...new Set([...questing, ...questsStarted(stack.id)])];
  const quests = useQuery({
    queryKey: ["area-quests", stack.id],
    queryFn: () => endpoints.areaQuests(stack.id, scanning),
    enabled: withQuests,
    refetchInterval: scanning.length ? 15_000 : 2 * 60_000,
  });
  // Whether this Dragonite has a Kōji, for the route buttons (the same check as the area editor).
  const kojiOn = useQuery({ queryKey: ["dragonite-koji", stack.id], queryFn: () => endpoints.kojiAvailable(stack.id), staleTime: 60_000 });
  const koji = !!kojiOn.data?.available;

  const all = q.data?.areas ?? [];
  const on = all.filter((a) => a.enabled);
  const expected = on.reduce((s, a) => s + (a.live?.expected ?? 0), 0);
  const active = on.reduce((s, a) => s + (a.live?.active ?? 0), 0);
  const short = on.filter((a) => (a.live?.active ?? 0) < (a.live?.expected ?? 0));
  const toggle = (areaId: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(areaId)) n.delete(areaId);
      else n.add(areaId);
      return n;
    });

  /** Phone: one card per area instead of a table that would not fit. */
  const renderCards = (list: DragoniteArea[], empty: string) => (
    <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card sm:hidden">
      {list.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p> : null}
      {list.map((a) => {
        const st = areaState(a);
        const open = expanded.has(a.id);
        return (
          <div key={a.id} className="flex flex-col gap-2 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <button type="button" onClick={() => toggle(a.id)} className="flex shrink-0 items-center gap-2" aria-expanded={open} aria-label={`Details of ${a.name}`}>
                  <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
                  <StatusDot tone={st.tone} label={st.label} detail={st.detail} />
                </button>
                {nameLink(a, "text-sm font-medium")}
              </div>
              <Switch
                on={pendingOn[a.id] ?? a.enabled}
                busy={a.id in pendingOn}
                label={a.enabled ? "Disable area" : "Enable area"}
                onChange={() => switchArea(a)}
              />
              {menu(a)}
            </div>
            {/* The same two figures as the table, one under the other with their names; the modes are inside. */}
            {a.enabled || withQuests ? (
              <div className="flex flex-col gap-1">
                {a.enabled ? (
                  <div className="flex items-center gap-3">
                    <span className="w-14 shrink-0 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Workers</span>
                    <div className="min-w-0 flex-1">
                      <LiveBar l={a.live} />
                    </div>
                  </div>
                ) : null}
                {withQuests ? (
                  <div className="flex items-center gap-3">
                    <span className="w-14 shrink-0 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Quests</span>
                    <div className="min-w-0 flex-1">
                      <QuestsScanned q={quests.data?.[a.id]} inline scanning={scanning.includes(a.id)} />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {open ? (
              <div className="rounded-lg bg-muted/30 p-2">
                <AreaDetail a={a} color={color} stack={stack} koji={koji} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  /** Areas as a table on wider screens, as cards on a phone. */
  const renderAreas = (list: DragoniteArea[], empty: string) => (
    <>
      <div className="hidden sm:block">{renderTable(list, empty)}</div>
      {renderCards(list, empty)}
    </>
  );

  /** The table, used for the active areas and again for the disabled ones. */
  const renderTable = (list: DragoniteArea[], empty: string) => (
      <Table>
        <thead>
          <tr>
            <th className="w-8" />
            {header("name", "Area")}
            {header("enabled", "Enabled")}
            {header("live", "Workers now")}
            {withQuests ? <th>Quests scanned</th> : null}
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {list.length === 0 ? (
            <tr>
              <td colSpan={withQuests ? 6 : 5} className="py-8 text-center text-muted-foreground">
                {empty}
              </td>
            </tr>
          ) : null}
          {list.map((a) => {
            const st = areaState(a);
            const open = expanded.has(a.id);
            return (
              <Fragment key={a.id}>
                <tr className="cursor-pointer" onClick={() => toggle(a.id)}>
                  <td>
                    <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
                  </td>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <StatusDot tone={st.tone} label={st.label} detail={st.detail} />
                      {nameLink(a, "font-medium whitespace-nowrap")}
                    </div>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Switch
                on={pendingOn[a.id] ?? a.enabled}
                busy={a.id in pendingOn}
                label={a.enabled ? "Disable area" : "Enable area"}
                onChange={() => switchArea(a)}
              />
                  </td>
                  <td>
                    <LiveBar l={a.enabled ? a.live : undefined} />
                  </td>
                  {withQuests ? (
                    <td onClick={(e) => e.stopPropagation()}>
                      <QuestsScanned q={quests.data?.[a.id]} scanning={scanning.includes(a.id)} />
                    </td>
                  ) : null}
                  <td onClick={(e) => e.stopPropagation()} className="text-right">
                    {menu(a)}
                  </td>
                </tr>
                {open ? (
                  <tr className="bg-muted/20 hover:bg-muted/20!">
                    {/* Full width: no empty chevron column on the left; width 0 so its tables do not widen this one. */}
                    <td colSpan={withQuests ? 6 : 5} className="px-3! pb-4!">
                      <div className="w-0 min-w-full">
                        <AreaDetail a={a} color={color} stack={stack} koji={koji} />
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
  );
  const activeRows = sorted.filter((a) => a.enabled);
  const offRows = sorted.filter((a) => !a.enabled);

  return (
    <section className="flex flex-col gap-3">
      {/* Folder tabs, then the stack header they open: the selected tab and
          the header share one background, so they read as a single piece. */}
      <div className="flex flex-col">
      {tabs}
      <div
        className={cn(
          "relative flex flex-col gap-3 overflow-hidden rounded-xl border px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5",
          tabbed && "rounded-t-none",
        )}
        style={{ background: tabs ? `linear-gradient(180deg, ${tabTint(stackColor)}, var(--card) 85%)` : `linear-gradient(90deg, color-mix(in oklab, ${stackColor} 14%, var(--card)), var(--card) 55%)` }}
      >
        {tabs ? null : <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: stackColor }} />}
        {/* With tabs the open tab already names the stack, and with a single stack
            there is nothing to tell apart: keep the name only for screen readers. */}
        <div className={cn("flex min-w-36 flex-col gap-0.5 pl-1", (tabs || stacks.length < 2) && "sr-only")}>
          <Label>Stack</Label>
          <h2 className="text-lg leading-tight font-bold">{stack.name}</h2>
        </div>
        {q.data ? (
          <div
            className={cn(
              "grid flex-1 grid-cols-2 gap-2",
              // Without the title the figures share the whole width.
              tabs || stacks.length < 2 ? "sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]" : "sm:flex sm:flex-wrap sm:items-stretch sm:justify-end",
            )}
          >
            <HeadStat label="Enabled areas" value={`${on.length}/${all.length}`}>
              <MiniProgress value={on.length} max={all.length} color={stackColor} />
            </HeadStat>
            <HeadStat
              label="Workers"
              value={`${active}/${expected}`}
              tone={short.length ? "warn" : undefined}
              hint={short.length ? `Short in ${short.map((x) => x.name).join(", ")}` : "All areas fully staffed"}
            >
              <MiniProgress value={active} max={expected} color={short.length ? "#f59e0b" : "#22c55e"} />
            </HeadStat>
            {q.data.unbounds.map((u) => (
              <HeadStat key={u.name} label={u.name} value={`${u.active}/${u.expected}`} tone={u.active < u.expected ? "warn" : undefined}>
                <MiniProgress value={u.active} max={u.expected} color={u.active < u.expected ? "#f59e0b" : "#22c55e"} />
              </HeadStat>
            ))}
            {q.data.queues.length ? (
              <HeadStat label="Queues" value={fmt.int(q.data.queues.reduce((n, x) => n + x.size, 0))}>
                <span className="text-[11px] text-muted-foreground">
                  {q.data.queues.map((x) => `${x.name} ${x.size}`).join(" · ")}
                </span>
              </HeadStat>
            ) : null}
          </div>
        ) : null}
      </div>

      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {toolbar}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {/* For every area of this stack: the admin's quest buttons, and switching them all off. */}
          <MenuButton
            kind="All areas"
            subject={`${fmt.int(q.data?.areas.length ?? 0)} areas`}
            label="All areas"
            disabled={!q.data}
            items={[
              {
                key: "disable-all",
                label: "Disable every area",
                hint: enabledAreas.length ? `Turns off the ${fmt.int(enabledAreas.length)} enabled` : "None is enabled",
                icon: PowerOff,
                danger: true,
                disabled: !enabledAreas.length,
                onSelect: () => setDisablingAll(true),
              },
              { key: "quest-start", label: "Start all quests", hint: "Every active area scans its quests now", icon: CirclePlay, positive: true, onSelect: () => setQuest({ action: "start" }) },
              { key: "quest-stop", label: "Stop all quests", hint: "Stops every quest scan", icon: CircleStop, danger: true, onSelect: () => setQuest({ action: "stop" }) },
            ]}
          />
          {actions}
        </div>
      </div>

      {q.error ? (
        <p className="text-sm text-red-300">{(q.error as Error).message}</p>
      ) : !q.data ? (
        <Spinner />
      ) : (
        <>
          {renderAreas(activeRows, search ? "No enabled areas match." : "No enabled areas.")}
          {offRows.length ? (
            // Closed by default; a search that only matches disabled areas opens it.
            <details key={search ? "searching" : "normal"} open={!!search} className="group rounded-lg border">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
                Disabled
                <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums">{offRows.length}</span>
              </summary>
              <div className="border-t p-2">{renderAreas(offRows, "")}</div>
            </details>
          ) : null}
        </>
      )}

      {notice}
      {disablingAll ? (
        <DisableAllModal
          stack={stack}
          areas={enabledAreas}
          onClose={() => setDisablingAll(false)}
          onDone={(text, tone) => {
            void qc.invalidateQueries({ queryKey: ["dragonite-areas", stack.id] });
            notify({ text, tone });
          }}
        />
      ) : null}
      {quest ? <QuestModal stack={stack} areas={q.data?.areas ?? []} request={quest} onClose={() => setQuest(undefined)} /> : null}
      {viewing ? (
        <AreaViewModal
          stack={stack}
          area={viewing}
          onClose={() => setViewing(undefined)}
          onEdit={() => {
            setEditing(viewing);
            setViewing(undefined);
          }}
        />
      ) : null}
      {editing ? (
        <AreaEditModal stack={stack} area={editing} onClose={() => setEditing(undefined)} />
      ) : null}
      {transfer ? (
        <TransferModal
          from={stack}
          others={others}
          area={transfer.area}
          move={transfer.move}
          onClose={() => setTransfer(undefined)}
        />
      ) : null}
    </section>
  );
}

/**
 * Copy or move an area to another stack. The copy keeps its routes and
 * geofence; it is created disabled unless "enable" is ticked.
 */
function TransferModal({
  from,
  others,
  area,
  move,
  onClose,
}: {
  from: DragoniteInfo;
  others: DragoniteInfo[];
  area: DragoniteArea;
  move: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const color = useInstanceColor();
  const [to, setTo] = useState(others[0]?.id ?? "");
  const [name, setName] = useState(area.name);
  // Copies and moves arrive disabled unless asked (only disabled areas move).
  const [enable, setEnable] = useState(false);
  const target = others.find((x) => x.id === to);
  const m = useMutation({
    mutationFn: () => endpoints.transferArea(from.id, area.id, { to, name: name.trim(), mode: move ? "move" : "copy", enable }),
    onSuccess: () => {
      for (const id of [from.id, to]) qc.invalidateQueries({ queryKey: ["dragonite-areas", id] });
      toast({ text: `${area.name} ${move ? "moved" : "copied"} to ${target?.name ?? to}${enable ? " and enabled" : ", disabled"}` });
      onClose();
    },
  });
  const dot = (d: DragoniteInfo) => (d.rotom ? color(d.rotom) : "var(--muted-foreground)");

  return (
    <Modal
      open
      onClose={onClose}
      title={`${move ? "Move" : "Copy"} ${area.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={move ? "destructive" : "default"} onClick={() => m.mutate()} disabled={!target || !name.trim() || m.isPending}>
            {m.isPending ? <Spinner className="size-4" /> : null}
            {move ? "Move" : "Copy"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-1.5">
          <Label>Destination</Label>
          <div className="flex flex-wrap gap-2">
            {others.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={to === d.id}
                onClick={() => setTo(d.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-accent",
                  to === d.id && "border-primary bg-accent",
                )}
              >
                <span className="size-2.5 rounded-full" style={{ background: dot(d) }} />
                {d.name}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <Label>Name at the destination</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={enable} onChange={(e) => setEnable(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          Enable it on {target?.name ?? "the destination"}
        </label>
        <div className="rounded-lg bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
          It is copied with its route, its geofence and each mode's settings
          {enable ? `, and ${target?.name ?? "the destination"} will start assigning it workers` : ", disabled"}.
          {move ? (
            <span className="mt-1 block font-medium text-red-400">
              It will be deleted from {from.name} once the copy exists.
            </span>
          ) : null}
        </div>
        {m.error ? <p className="text-red-300">{(m.error as Error).message}</p> : null}
      </div>
    </Modal>
  );
}

/** A small on/off switch. */
export function Switch({
  on,
  onChange,
  label,
  disabled,
  busy,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  /** Waiting for the change to apply: pulses and ignores clicks. */
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-busy={busy || undefined}
      aria-label={label}
      disabled={disabled || busy}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed",
        on ? "bg-green-500" : "bg-muted-foreground/30",
        busy ? "animate-pulse" : "disabled:opacity-50",
      )}
    >
      <span className={cn("absolute size-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-4.5" : "translate-x-0.5")} />
    </button>
  );
}

/** A yes/no setting of a mode, as a small chip: lit when on. */
function Opt({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1 py-px text-[10px] leading-4 whitespace-nowrap",
        on ? "bg-green-500/10 text-green-400" : "bg-muted/60 text-muted-foreground/70",
      )}
    >
      {on ? <Check className="size-2.5" strokeWidth={3} /> : <Minus className="size-2.5" strokeWidth={3} />}
      {children}
    </span>
  );
}

/**
 * Kōji's 70 m Pokémon route of an area, or its bootstrap (over the whole
 * geofence): the area editor's icons and its confirmation, as only an icon
 * here with its name on hover. Dragonite saves the new route at once.
 */
function KojiButton({ stack, area, bootstrap }: { stack: DragoniteInfo; area: DragoniteArea; bootstrap: boolean }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const option = KOJI_OPTIONS.pokemon.find((o) => o.bootstrap === bootstrap)!;
  const run = async () => {
    const r = await endpoints.kojiRoute(stack.id, area.id, "pokemon", bootstrap);
    qc.invalidateQueries({ queryKey: ["dragonite-areas", stack.id] });
    qc.invalidateQueries({ queryKey: ["dragonite-area-full", stack.id, area.id] });
    return r.route.length;
  };
  return (
    <>
      {/* As the area editor's: violet on hover, and the same card. */}
      <HoverCard
        className="inline-flex"
        content={
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5 font-medium">
              <option.icon className="size-3.5 text-violet-400" />
              {option.label}
            </span>
            <span className="text-muted-foreground">From Kōji · saved at once</span>
          </span>
        }
      >
        <button
          type="button"
          onClick={() => setAsking(true)}
          aria-label={`${option.label} from Kōji`}
          className="grid size-6 place-items-center rounded-md border text-muted-foreground transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-300 focus-visible:text-violet-300"
        >
          <option.icon className="size-3.5" />
        </button>
      </HoverCard>
      {asking ? <KojiModal mode="pokemon" option={option} points={area.pokemon.routePoints} run={run} onClose={() => setAsking(false)} inForm={false} /> : null}
    </>
  );
}

/** A mode of the area: whether it is on, its workers, and its own settings below. */
function ModeTile({ label, m, children }: { label: string; m: { enabled: boolean; workers: number }; children?: React.ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-lg border bg-background/40 px-2.5 py-1.5", !m.enabled && "opacity-55")}>
      <div className="flex items-center gap-2">
        <span className={cn("size-1.5 shrink-0 rounded-full", m.enabled ? "bg-green-500" : "bg-muted-foreground/40")} />
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
        <span className="ml-auto text-sm font-semibold tabular-nums">
          {fmt.int(m.workers)}
          <span className="ml-1 text-[11px] font-normal text-muted-foreground">worker{m.workers === 1 ? "" : "s"}</span>
        </span>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground tabular-nums">{children}</div> : null}
    </div>
  );
}

/** The area opened in the table: its modes, a line of facts, and its workers now. */
function AreaDetail({ a, color, stack, koji }: { a: DragoniteArea; color: (id: string) => string; stack: DragoniteInfo; koji: boolean }) {
  const route = (n: number) => <span className="mr-0.5">{fmt.int(n)} pts</span>;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
        <ModeTile label="Pokémon" m={a.pokemon}>
          {route(a.pokemon.routePoints)}
          <Opt on={a.pokemon.scout}>Scout</Opt>
          <Opt on={a.pokemon.invasion}>Invasions</Opt>
          {koji ? (
            <span className="ml-auto flex gap-1">
              <KojiButton stack={stack} area={a} bootstrap={false} />
              <KojiButton stack={stack} area={a} bootstrap />
            </span>
          ) : null}
        </ModeTile>
        <ModeTile label="Forts" m={a.fort}>
          <Opt on={a.fort.prioRaid}>Raid priority</Opt>
          <Opt on={a.fort.showcase}>Showcase</Opt>
          <Opt on={a.fort.invasion}>Invasions</Opt>
        </ModeTile>
        <ModeTile label="Rare" m={a.rare}>
          <span>{fmt.int(a.rare.permyriad)} per 10,000</span>
        </ModeTile>
        <ModeTile label="Quests" m={a.quest}>
          {route(a.quest.routePoints)}
          <span className="truncate">· hours {a.quest.hours.length ? a.quest.hours.join(", ") : "all"}</span>
        </ModeTile>
      </div>
      <div className="flex flex-wrap gap-x-3 px-0.5 text-[11px] text-muted-foreground">
        <span>
          Time zone <span className="text-foreground">{a.timezone || "—"}</span>
        </span>
        <span>
          ID <span className="text-foreground tabular-nums">{a.id}</span>
        </span>
      </div>
      <WorkersTable workers={a.live?.workers ?? []} color={color} />
    </div>
  );
}


/** "Disable every area": asks first, then switches them off one by one. */
function DisableAllModal({
  stack,
  areas,
  onClose,
  onDone,
}: {
  stack: DragoniteInfo;
  areas: DragoniteArea[];
  onClose: () => void;
  onDone: (text: string, tone?: "warning" | "error") => void;
}) {
  const { multi } = useStacks();
  const [done, setDone] = useState<number>();
  const run = async () => {
    const failed: string[] = [];
    for (let i = 0; i < areas.length; i++) {
      setDone(i);
      try {
        await endpoints.setAreaEnabled(stack.id, areas[i].id, false);
      } catch (e) {
        failed.push(`${areas[i].name}: ${(e as Error).message}`);
      }
    }
    const off = areas.length - failed.length;
    const where = multi ? ` on ${stack.name}` : "";
    onDone(
      failed.length ? `${fmt.int(off)} of ${fmt.int(areas.length)} areas disabled${where} · ${failed.join(" · ")}` : `${fmt.int(off)} areas disabled${where}`,
      failed.length ? (off ? "warning" : "error") : undefined,
    );
    onClose();
  };
  const busy = done !== undefined;
  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      icon={<PowerOff />}
      title="Disable every area"
      description={`${fmt.int(areas.length)} enabled${multi ? ` on ${stack.name}` : ""}; their workers stop scanning`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={run} disabled={busy}>
            {busy ? <Spinner className="size-4" /> : <PowerOff />}
            {busy ? `Disabling ${fmt.int(done + 1)} of ${fmt.int(areas.length)}…` : `Disable ${fmt.int(areas.length)} areas`}
          </Button>
        </>
      }
    >
      <ul className="flex max-h-56 flex-wrap gap-1.5 overflow-auto">
        {areas.map((a, i) => (
          <li
            key={a.id}
            className={cn("rounded-md border px-2 py-0.5 text-xs", busy && i < done ? "text-muted-foreground line-through" : busy && i === done ? "border-red-500/50 text-red-300" : "")}
          >
            {a.name}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
