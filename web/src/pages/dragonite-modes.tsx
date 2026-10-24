import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Copy, Eraser, Pencil, Plus, Swords, Telescope, Trash2, TrendingUp } from "lucide-react";
import { Fragment, lazy, Suspense, useMemo, useState } from "react";
import type { DragoniteArea, DragoniteInfo, LevelStat, UnboundMode, UnboundModeType, UnboundModes } from "@shared/types";
import { type FolderTab, FolderPanel, FolderTabs } from "@/components/folder-tabs";
import { HeadStat, MiniProgress } from "@/components/head-stat";
import { MenuButton } from "@/components/menu-button";
import { useStacks } from "@/components/stack-tag";
import { matches, SearchBox, Toggle, useSorted } from "@/components/table-tools";
import { PanelChart } from "@/components/vm-panel";
import { toast } from "@/components/toaster";
import { Button, Card, HoverCard, Input, Label, Modal, Spinner, Table } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAppInfo, useInstanceColor } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";
import { LiveBar, WorkersTable } from "./dragonite-areas";
import { SCOUT_STATE, type ScoutState, scoutState } from "@/lib/scout";
import { useChosenStack } from "@/lib/stack-choice";

// MapLibre is heavy: loaded only when a stack has scout jobs to show.
const ScoutMap = lazy(() => import("@/components/scout-map").then((m) => ({ default: m.ScoutMap })));


/** How each type looks: Dragonite's three unbound modes. */
const TYPES: Record<UnboundModeType, { label: string; icon: typeof Swords; color: string; hint: string }> = {
  level: { label: "Level", icon: TrendingUp, color: "#a855f7", hint: "Levels accounts up along a route" },
  invasion: { label: "Invasion", icon: Swords, color: "#ef4444", hint: "Battles Team GO Rocket invasions" },
  scout: { label: "Scout", icon: Telescope, color: "#0ea5e9", hint: "Checks the points other tools ask for" },
};
const TYPE_ORDER: UnboundModeType[] = ["level", "invasion", "scout"];


/** The type as its icon alone; its name on hover. */
function TypeIcon({ type }: { type: UnboundModeType }) {
  const t = TYPES[type];
  return (
    <HoverCard content={<span>{t.label} mode</span>}>
      <span
        aria-label={`${t.label} mode`}
        className="grid size-7 place-items-center rounded-full border"
        style={{ borderColor: `color-mix(in oklab, ${t.color} 45%, var(--border))`, background: `color-mix(in oklab, ${t.color} 12%, transparent)` }}
      >
        <t.icon className="size-3.5" style={{ color: t.color }} />
      </span>
    </HoverCard>
  );
}

function TypeChip({ type }: { type: UnboundModeType }) {
  const t = TYPES[type];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{ borderColor: `color-mix(in oklab, ${t.color} 45%, var(--border))`, background: `color-mix(in oklab, ${t.color} 12%, transparent)` }}
    >
      <t.icon className="size-3.5" style={{ color: t.color }} />
      {t.label}
    </span>
  );
}

export function DragoniteModesPage() {
  const { data: app } = useAppInfo();
  const color = useInstanceColor();
  const stacks = (app?.dragonite ?? []).filter((d) => d.accounts);
  const [chosen, choose] = useChosenStack();
  const queries = useQueries({
    queries: stacks.map((d) => ({ queryKey: ["dragonite-modes", d.id], queryFn: () => endpoints.unboundModes(d.id), refetchInterval: 15_000 })),
  });

  if (!app) return <Spinner className="mx-auto mt-20" />;
  const current = stacks.find((d) => d.id === chosen) ?? stacks[0];
  if (!current) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        No <code className="rounded bg-muted px-1">[stack.dragonite]</code> has a <code className="rounded bg-muted px-1">url</code> in config.toml.
      </Card>
    );
  }
  const tabs: FolderTab[] = stacks.map((d, i) => {
    const data = queries[i].data;
    return {
      id: d.id,
      label: d.name,
      color: d.rotom ? color(d.rotom) : undefined,
      summary: data ? `${data.modes.length} mode${data.modes.length === 1 ? "" : "s"}` : undefined,
    };
  });
  const q = queries[stacks.indexOf(current)];

  return (
    <StackModes
      key={current.id}
      stack={current}
      stacks={stacks}
      data={q.data}
      error={q.error as Error | null}
      tabs={stacks.length > 1 ? <FolderTabs label="Stack" tabs={tabs} value={current.id} onChange={choose} /> : null}
      tabbed={stacks.length > 1}
    />
  );
}

type Row = UnboundMode & { key: string };

/** One stack's unbound modes: its summary, the table, and the dialogs to change them. */
function StackModes({
  stack,
  stacks,
  data,
  error,
  tabs,
  tabbed,
}: {
  stack: DragoniteInfo;
  stacks: DragoniteInfo[];
  data?: UnboundModes;
  error: Error | null;
  tabs: React.ReactNode;
  tabbed?: boolean;
}) {
  const { on } = useStacks();
  const color = useInstanceColor();
  const qc = useQueryClient();
  const stackColor = stack.rotom ? color(stack.rotom) : "var(--muted-foreground)";
  const others = stacks.filter((d) => d.id !== stack.id);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<UnboundMode | "new">();
  const [copying, setCopying] = useState<UnboundMode>();
  const [deleting, setDeleting] = useState<UnboundMode>();
  const [clearing, setClearing] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["dragonite-modes"] });
  const toggle = (key: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const rows = useMemo<Row[]>(
    () =>
      (data?.modes ?? [])
        .filter((m) => matches(search, m.name, TYPES[m.type].label))
        .map((m) => ({ ...m, key: `${m.type}:${m.id}` })),
    [data, search],
  );
  const { sorted, header } = useSorted(
    rows,
    {
      type: (r) => TYPE_ORDER.indexOf(r.type),
      name: (r) => r.name,
      workers: (r) => r.workers,
      live: (r) => r.live?.active ?? 0,
      route: (r) => r.routePoints ?? -1,
    },
    "type",
  );

  const byType = TYPE_ORDER.map((t) => {
    const list = (data?.modes ?? []).filter((m) => m.type === t);
    return {
      type: t,
      count: list.length,
      active: list.reduce((n, m) => n + (m.live?.active ?? 0), 0),
      expected: list.reduce((n, m) => n + (m.live?.expected ?? m.workers), 0),
    };
  });
  const sq = data?.scoutQueue;
  // Areas with scout on: their Pokémon workers also answer scout requests.
  const areasQ = useQuery({ queryKey: ["dragonite-areas", stack.id], queryFn: () => endpoints.dragoniteAreas(stack.id), refetchInterval: 15_000 });
  const scoutAreas = (areasQ.data?.areas ?? [])
    .filter((a) => a.pokemon.scout && a.pokemon.enabled)
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name, "en", { numeric: true }));
  const hasLevel = !!data?.modes.some((m) => m.type === "level");
  const hasInvasion = !!data?.modes.some((m) => m.type === "invasion");
  const hasScout = !!data && !!(sq?.total || scoutAreas.length || data.modes.some((m) => m.type === "scout"));

  const menu = (m: UnboundMode) => (
    <MenuButton
      kind={`${TYPES[m.type].label} mode`}
      subject={m.name}
      items={[
        { key: "edit", label: "Edit", hint: m.type === "level" ? "Name, workers and route" : "Name and workers", icon: Pencil, onSelect: () => setEditing(m) },
        // Only with another stack to copy it to.
        ...(others.length
          ? [
              {
                key: "copy",
                label: "Copy to another stack",
                hint: m.type === "level" ? "With its route" : "Same name and workers",
                icon: Copy,
                onSelect: () => setCopying(m),
              },
            ]
          : []),
        { key: "delete", label: "Delete", hint: "Removes it from this Dragonite", icon: Trash2, danger: true, onSelect: () => setDeleting(m) },
      ]}
    />
  );

  return (
    <div className="animate-in flex flex-col gap-3">
      <div className="flex flex-col">
        {tabs}
        <FolderPanel color={stackColor} tabbed={tabbed}>
          {!data ? (
            error ? <p className="text-sm text-red-300">{error.message}</p> : <Spinner />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {byType.map((t) => (
                <HeadStat
                  key={t.type}
                  label={TYPES[t.type].label}
                  value={t.count ? `${t.active}/${t.expected}` : "—"}
                  tone={t.active < t.expected ? "warn" : undefined}
                  hint={TYPES[t.type].hint}
                >
                  {t.count ? (
                    <MiniProgress value={t.active} max={t.expected} color={t.active < t.expected ? "#f59e0b" : "#22c55e"} />
                  ) : (
                    <span className="text-[11px] text-muted-foreground">no modes</span>
                  )}
                </HeadStat>
              ))}
            </div>
          )}
        </FolderPanel>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 sm:flex-none">
          <SearchBox value={search} onChange={setSearch} placeholder="Search modes…" />
        </div>
        <Button size="sm" className="shrink-0" onClick={() => setEditing("new")}>
          <Plus />
          New
        </Button>
      </div>

      {!data ? null : (
        <>
          {/* Phone: one card per mode instead of a table that would not fit. */}
          <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card sm:hidden">
            {sorted.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {data.modes.length ? "No modes match." : `No unbound modes${on(stack.id)} yet.`}
              </p>
            ) : null}
            {sorted.map((m) => {
              const open = expanded.has(m.key);
              return (
                <div key={m.key} className="flex flex-col gap-2 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => toggle(m.key)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
                      <TypeIcon type={m.type} />
                      <span className="truncate text-sm font-medium">{m.name}</span>
                    </button>
                    {menu(m)}
                  </div>
                  <div className="flex items-center gap-3 pl-6 text-xs text-muted-foreground">
                    <span className="shrink-0">
                      <b className={cn("tabular-nums", m.workers ? "text-foreground" : "")}>{m.workers}</b> worker{m.workers === 1 ? "" : "s"}
                    </span>
                    {m.type === "level" ? <span className="shrink-0 tabular-nums">{fmt.int(m.routePoints ?? 0)} route points</span> : null}
                    {m.type === "scout" && scoutAreas.length ? <ScoutVia areas={scoutAreas} /> : null}
                    <div className="min-w-0 flex-1">{m.live?.expected ? <LiveBar l={m.live} /> : null}</div>
                  </div>
                  {open ? (
                    <div className="rounded-lg bg-muted/30 p-2">
                      <ModeDetail mode={m} scoutAreas={m.type === "scout" ? scoutAreas : []} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <th className="w-8" />
                  <th className="w-10" />
                  {header("name", "Name")}
                  {header("workers", "Workers")}
                  {header("live", "Running now")}
                  {header("route", "Route")}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      {data.modes.length ? "No modes match." : `No unbound modes${on(stack.id)} yet.`}
                    </td>
                  </tr>
                ) : null}
                {sorted.map((m) => {
                  const open = expanded.has(m.key);
                  return (
                    <Fragment key={m.key}>
                      <tr className="cursor-pointer" onClick={() => toggle(m.key)}>
                        <td>
                          <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
                        </td>
                        <td>
                          <TypeIcon type={m.type} />
                        </td>
                        <td className="font-medium">{m.name}</td>
                        <td className={cn("tabular-nums", !m.workers && "text-muted-foreground/60")}>{m.workers}</td>
                        <td>
                          {m.type === "scout" && !m.live?.expected && scoutAreas.length ? <ScoutVia areas={scoutAreas} /> : <LiveBar l={m.live} />}
                        </td>
                        <td className="whitespace-nowrap text-muted-foreground tabular-nums">
                          {m.type === "level" ? `${fmt.int(m.routePoints ?? 0)} points` : "—"}
                        </td>
                        <td onClick={(e) => e.stopPropagation()} className="text-right">
                          {menu(m)}
                        </td>
                      </tr>
                      {open ? (
                        <tr className="bg-muted/20 hover:bg-muted/20!">
                          {/* Full width: no empty chevron column on the left. */}
                          <td colSpan={7} className="px-3! pb-4!">
                            {/* Width 0 so its contents (tables, the chart) take the row's width instead of widening the table. */}
                            <div className="w-0 min-w-full">
                              <ModeDetail mode={m} scoutAreas={m.type === "scout" ? scoutAreas : []} />
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </>
      )}

      {/* More on each type of mode, outside the table: one section per type the stack uses,
          under a labelled divider and with a rule between sections. */}
      {data && (hasLevel || hasInvasion || hasScout) ? (
        <div className="mt-4 flex flex-col">
          <div className="flex items-center gap-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            By mode type
            <span aria-hidden className="h-px flex-1 bg-foreground/15" />
          </div>
          <div className="flex flex-col divide-y divide-foreground/15 [&>section]:py-6 [&>section:first-child]:pt-4 [&>section:last-child]:pb-0">
            {hasLevel ? <LevelSection stack={stack} /> : null}
            {hasInvasion ? <InvasionSection stack={stack} /> : null}
            {hasScout ? <ScoutSection stack={stack} areas={scoutAreas} onClear={() => setClearing(true)} /> : null}
          </div>
        </div>
      ) : null}

      {editing ? (
        <ModeModal
          stack={stack}
          mode={editing === "new" ? undefined : editing}
          existing={data?.modes ?? []}
          onClose={() => setEditing(undefined)}
          onDone={refresh}
        />
      ) : null}
      {copying ? <CopyModal stack={stack} others={others} mode={copying} onClose={() => setCopying(undefined)} onDone={refresh} /> : null}
      {deleting ? (
        <Confirm
          title={`Delete ${deleting.name}`}
          action="Delete"
          onClose={() => setDeleting(undefined)}
          onConfirm={async () => {
            const m = deleting;
            await endpoints.deleteMode(stack.id, m.type, m.id);
            toast({ text: `${TYPES[m.type].label} mode “${m.name}” deleted${on(stack.id, "from")}` });
            refresh();
          }}
        >
          The {TYPES[deleting.type].label.toLowerCase()} mode “{deleting.name}” will be removed{on(stack.id, "from")}.
          {deleting.live?.active ? ` Its ${deleting.live.active} worker${deleting.live.active === 1 ? "" : "s"} will stop.` : ""}
        </Confirm>
      ) : null}
      {clearing ? (
        <Confirm
          title="Clear the scout queue"
          action="Clear"
          onClose={() => setClearing(false)}
          onConfirm={async () => {
            await endpoints.clearScoutQueue(stack.id);
            toast({ text: `Scout queue${on(stack.id, "of")} cleared` });
            refresh();
            qc.invalidateQueries({ queryKey: ["dragonite-scout", stack.id] });
          }}
        >
          Every point in the scout queue{on(stack.id, "of")} ({fmt.int(sq?.total ?? 0)}) will be dropped, done or not.
        </Confirm>
      ) : null}
    </div>
  );
}

/** A yes/no dialog whose action may fail: the error stays in the dialog. */
function Confirm({
  title,
  action,
  children,
  onConfirm,
  onClose,
}: {
  title: string;
  action: string;
  children: React.ReactNode;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner className="size-4" /> : null}
            {action}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{children}</p>
      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
    </Modal>
  );
}

/**
 * A route as typed or pasted: one "lat,lon" per line (spaces or tabs work too),
 * or JSON — [{lat, lon}, …] or [[lat, lon], …]. Bad lines are reported.
 */
function parseRoute(text: string): { points: { lat: number; lon: number }[]; bad: number[] } {
  const ok = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const t = text.trim();
  if (!t) return { points: [], bad: [] };
  if (t.startsWith("[")) {
    try {
      const raw = JSON.parse(t) as unknown[];
      const points: { lat: number; lon: number }[] = [];
      const bad: number[] = [];
      raw.forEach((p, i) => {
        const [lat, lon] = Array.isArray(p) ? p.map(Number) : [Number((p as { lat?: unknown })?.lat), Number((p as { lon?: unknown; lng?: unknown })?.lon ?? (p as { lng?: unknown })?.lng)];
        if (ok(lat, lon)) points.push({ lat, lon });
        else bad.push(i + 1);
      });
      return { points, bad };
    } catch {
      return { points: [], bad: [1] };
    }
  }
  const points: { lat: number; lon: number }[] = [];
  const bad: number[] = [];
  t.split(/\r?\n/).forEach((line, i) => {
    const l = line.trim();
    if (!l) return;
    const [lat, lon] = l.split(/[\s,;]+/).map(Number);
    if (ok(lat, lon)) points.push({ lat, lon });
    else bad.push(i + 1);
  });
  return { points, bad };
}

const routeText = (r: { lat: number; lon: number }[]) => r.map((p) => `${p.lat},${p.lon}`).join("\n");

/** Create a mode (any type) or edit one: name, workers and, for level, its route. */
function ModeModal({
  stack,
  mode,
  existing,
  onClose,
  onDone,
}: {
  stack: DragoniteInfo;
  mode?: UnboundMode;
  existing: UnboundMode[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { on } = useStacks();
  const [type, setType] = useState<UnboundModeType>(mode?.type ?? "invasion");
  const [name, setName] = useState(mode?.name ?? "");
  const [workers, setWorkers] = useState(String(mode?.workers ?? 1));
  const [route, setRoute] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Editing a level mode: its route comes with the mode itself.
  const detail = useQuery({
    queryKey: ["dragonite-mode", stack.id, mode?.type, mode?.id],
    queryFn: () => endpoints.unboundMode(stack.id, mode!.type, mode!.id),
    enabled: mode?.type === "level",
  });
  const original = detail.data?.route ? routeText(detail.data.route) : "";
  const text = route ?? original;
  const parsed = type === "level" ? parseRoute(text) : { points: [], bad: [] };
  const n = Number(workers);
  const workersOk = workers.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 1000;
  const clash = existing.some((m) => m.type === type && m.name === name.trim() && m.id !== mode?.id);
  const routeChanged = type === "level" && route !== undefined && route !== original;
  const loading = mode?.type === "level" && detail.isLoading;
  const canSave = !!name.trim() && workersOk && !clash && !parsed.bad.length && !busy && !loading;

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (!mode) {
        await endpoints.createMode(stack.id, type, { name: name.trim(), workers: n, ...(type === "level" ? { route: parsed.points } : {}) });
        toast({ text: `${TYPES[type].label} mode “${name.trim()}” created${on(stack.id)}` });
      } else {
        const patch: { name?: string; workers?: number; route?: { lat: number; lon: number }[] } = {};
        if (name.trim() !== mode.name) patch.name = name.trim();
        if (n !== mode.workers) patch.workers = n;
        if (routeChanged) patch.route = parsed.points;
        if (Object.keys(patch).length) {
          await endpoints.updateMode(stack.id, mode.type, mode.id, patch);
          toast({ text: `“${name.trim()}” saved${on(stack.id)}` });
        }
      }
      onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      wide={type === "level"}
      onClose={onClose}
      title={mode ? `Edit ${mode.name}` : `New mode${on(stack.id)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {busy ? <Spinner className="size-4" /> : mode ? null : <Plus />}
            {mode ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label>Type</Label>
          {mode ? (
            <div>
              <TypeChip type={mode.type} />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {TYPE_ORDER.map((t) => {
                const T = TYPES[t];
                const on = t === type;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setType(t)}
                    className={cn("flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent", on && "bg-accent")}
                    style={on ? { borderColor: T.color } : undefined}
                  >
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <T.icon className="size-4" style={{ color: T.color }} />
                      {T.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{T.hint}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <label className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder={type === "invasion" ? "e.g. Rocket" : ""} autoFocus />
            {clash ? <span className="text-[11px] text-amber-400">There is already {type === "invasion" ? "an" : "a"} {TYPES[type].label.toLowerCase()} mode with this name{on(stack.id)}.</span> : null}
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>Workers</Label>
            <Input type="number" min={0} max={1000} value={workers} onChange={(e) => setWorkers(e.target.value)} />
          </label>
        </div>
        {type === "level" ? (
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between">
              <Label>Route</Label>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {loading ? "loading…" : `${fmt.int(parsed.points.length)} point${parsed.points.length === 1 ? "" : "s"}`}
                {parsed.bad.length ? <span className="text-amber-400"> · check line {parsed.bad.slice(0, 3).join(", ")}</span> : null}
              </span>
            </span>
            <textarea
              value={text}
              onChange={(e) => setRoute(e.target.value)}
              rows={8}
              spellCheck={false}
              disabled={loading}
              placeholder={"lat,lon — one point per line\n40.4168,-3.7038\n40.4172,-3.7051\n…or JSON: [{\"lat\": 40.4168, \"lon\": -3.7038}, …]"}
              className="w-full rounded-md border bg-background/40 px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
            <span className="text-[11px] text-muted-foreground">The points workers walk in order while they level up.</span>
          </label>
        ) : null}
        {error ? <p className="text-red-300">{error}</p> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Copy a mode, its route included, to another stack. */
function CopyModal({
  stack,
  others,
  mode,
  onClose,
  onDone,
}: {
  stack: DragoniteInfo;
  others: DragoniteInfo[];
  mode: UnboundMode;
  onClose: () => void;
  onDone: () => void;
}) {
  const color = useInstanceColor();
  const [to, setTo] = useState(others[0]?.id ?? "");
  const [name, setName] = useState(mode.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const target = others.find((d) => d.id === to);
  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await endpoints.copyMode(stack.id, mode.type, mode.id, { to, name: name.trim() });
      toast({ text: `“${mode.name}” copied to ${target?.name ?? to}${name.trim() !== mode.name ? ` as “${name.trim()}”` : ""}` });
      onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Copy ${mode.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={run} disabled={!to || !name.trim() || busy}>
            {busy ? <Spinner className="size-4" /> : <Copy />}
            Copy to {target?.name ?? "…"}
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
                aria-pressed={d.id === to}
                onClick={() => setTo(d.id)}
                className={cn("inline-flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-accent", d.id === to && "border-primary bg-accent")}
              >
                <span className="size-2.5 rounded-full" style={{ background: d.rotom ? color(d.rotom) : "var(--muted-foreground)" }} />
                {d.name}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <Label>Name there</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
        </label>
        <p className="text-xs text-muted-foreground">
          <TypeChip type={mode.type} /> with {mode.workers} worker{mode.workers === 1 ? "" : "s"}
          {mode.type === "level" ? ` and its route (${fmt.int(mode.routePoints ?? 0)} points)` : ""}. The original stays on {stack.name}.
        </p>
        {error ? <p className="text-red-300">{error}</p> : null}
      </div>
    </Modal>
  );
}

const PER_PAGE = 10;

/** The scout queue as the admin's Scout Mode page shows it: summary, map and list. */
function ScoutSection({ stack, areas, onClear }: { stack: DragoniteInfo; areas: DragoniteArea[]; onClear: () => void }) {
  const { on } = useStacks();
  const { data: app } = useAppInfo();
  const [page, setPage] = useState(0);
  const q = useQuery({ queryKey: ["dragonite-scout", stack.id], queryFn: () => endpoints.scoutJobs(stack.id), refetchInterval: 10_000 });
  const jobs = q.data?.jobs ?? [];
  const counts = { done: 0, pending: 0, failed: 0 } as Record<ScoutState, number>;
  for (const j of jobs) counts[scoutState(j)]++;
  const pages = Math.max(1, Math.ceil(jobs.length / PER_PAGE));
  const at = Math.min(page, pages - 1);
  const shown = jobs.slice(at * PER_PAGE, at * PER_PAGE + PER_PAGE);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <TypeHeading type="scout" />
        {/* On a phone the button stays beside the title and the counts go below. */}
        <Button size="sm" variant="outline" className="ml-auto sm:order-last" disabled={!q.data?.total} onClick={onClear}>
          <Eraser />
          Clear queue
        </Button>
        <div className="flex w-full flex-wrap items-center gap-1.5 text-xs sm:ml-auto sm:w-auto sm:gap-2">
          <span className="rounded-full border px-2 py-0.5 tabular-nums">
            Total <span className="font-semibold">{fmt.int(q.data?.total ?? 0)}</span>
          </span>
          {(Object.keys(SCOUT_STATE) as ScoutState[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 tabular-nums">
              <span className="size-2 rounded-full" style={{ background: SCOUT_STATE[k].color }} />
              {SCOUT_STATE[k].label} <span className="font-semibold">{fmt.int(counts[k])}</span>
            </span>
          ))}
        </div>
      </div>
      {areas.length ? (
        <p className="-mt-1 text-xs text-muted-foreground">
          Answered by the Pokémon workers of {areas.filter((a) => a.enabled).map((a) => a.name).join(", ") || "no enabled area"}
          {areas.some((a) => !a.enabled) ? ` (also on, but disabled: ${areas.filter((a) => !a.enabled).map((a) => a.name).join(", ")})` : ""}.
        </p>
      ) : null}
      {q.error ? <p className="text-sm text-red-300">{(q.error as Error).message}</p> : null}
      {q.data && !jobs.length ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">The scout queue{on(stack.id, "of")} is empty.</Card>
      ) : q.data ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Suspense fallback={<div className="min-h-72 rounded-lg border" />}>
            <ScoutMap jobs={jobs} basemap={app?.map} title="Scout jobs" />
          </Suspense>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase">Latest jobs</h3>
            <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card text-xs sm:hidden">
              {shown.map((j) => {
                const st = scoutState(j);
                return (
                  <div key={j.id} className="flex flex-col gap-1 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[13px]">{j.account || "—"}</span>
                      <span className="inline-flex shrink-0 items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: SCOUT_STATE[st].color }} />
                        {st === "done" ? fmt.ago(j.fulfilled * 1000) : SCOUT_STATE[st].label}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-muted-foreground">
                      <span className="font-mono tabular-nums">
                        {j.lat.toFixed(5)}, {j.lon.toFixed(5)}
                      </span>
                      <span className="shrink-0">requested {fmt.ago(j.requested * 1000)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hidden sm:block">
              <Table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Position</th>
                    <th>Requested</th>
                    <th>Fulfilled</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((j) => {
                    const st = scoutState(j);
                    return (
                      <tr key={j.id}>
                        <td className="font-mono text-xs">{j.account || "—"}</td>
                        <td className="font-mono text-xs whitespace-nowrap tabular-nums">
                          {j.lat.toFixed(5)}, {j.lon.toFixed(5)}
                        </td>
                        <td className="whitespace-nowrap text-muted-foreground tabular-nums" title={fmt.time(j.requested * 1000)}>
                          {fmt.ago(j.requested * 1000)}
                        </td>
                        <td className="whitespace-nowrap tabular-nums">
                          {st === "done" ? (
                            <span className="text-muted-foreground" title={fmt.time(j.fulfilled * 1000)}>
                              {fmt.ago(j.fulfilled * 1000)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="size-2 rounded-full" style={{ background: SCOUT_STATE[st].color }} />
                              {SCOUT_STATE[st].label}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
            {pages > 1 ? (
              <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  Page {at + 1} of {pages}
                </span>
                <Button size="icon" variant="ghost" className="size-7" disabled={at === 0} onClick={() => setPage(at - 1)} aria-label="Previous page">
                  <ChevronLeft />
                </Button>
                <Button size="icon" variant="ghost" className="size-7" disabled={at >= pages - 1} onClick={() => setPage(at + 1)} aria-label="Next page">
                  <ChevronRight />
                </Button>
              </div>
            ) : null}
            {q.data.total > jobs.length ? (
              <p className="text-[11px] text-muted-foreground">Showing the newest {fmt.int(jobs.length)} of {fmt.int(q.data.total)}.</p>
            ) : null}
          </div>
        </div>
      ) : (
        <Spinner />
      )}
    </section>
  );
}

const RANGES = [
  { value: String(3_600_000), label: "1h" },
  { value: String(6 * 3_600_000), label: "6h" },
  { value: String(24 * 3_600_000), label: "24h" },
  { value: String(7 * 86_400_000), label: "7d" },
];

/** Workers of an area that scan Pokémon, the ones that take scout requests too. */
const pokemonWorkers = (a: DragoniteArea) => (a.live?.workers ?? []).filter((w) => w.mode === "PokemonMode" || w.mode === "ScoutMode");

/** "+5 via 1 area": who answers scout requests besides the mode's own workers. */
function ScoutVia({ areas }: { areas: DragoniteArea[] }) {
  const on = areas.filter((a) => a.enabled);
  const workers = on.reduce((n, a) => n + pokemonWorkers(a).length, 0);
  return (
    <HoverCard
      content={
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">Answered by areas with scout on</span>
          {areas.map((a) => (
            <span key={a.id} className="text-muted-foreground">
              {a.name}: {a.enabled ? `${pokemonWorkers(a).length} Pokémon workers` : "area disabled"}
            </span>
          ))}
        </div>
      }
    >
      <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
        <span className="font-semibold text-foreground tabular-nums">+{workers}</span>
        via {on.length} area{on.length === 1 ? "" : "s"}
      </span>
    </HoverCard>
  );
}

/**
 * What opens under a mode: the workers running it now. A scout mode also lists
 * the areas with scout on: their Pokémon workers are not its own, but they are
 * the ones that will answer its requests.
 */
function ModeDetail({ mode, scoutAreas }: { mode: UnboundMode; scoutAreas: DragoniteArea[] }) {
  const color = useInstanceColor();
  if (mode.type !== "scout" || !scoutAreas.length) return <WorkersTable workers={mode.live?.workers ?? []} color={color} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h4 className="text-[11px] font-semibold text-muted-foreground uppercase">Its own workers</h4>
        <WorkersTable workers={mode.live?.workers ?? []} color={color} />
      </div>
      <div className="flex flex-col gap-3">
        <h4 className="text-[11px] font-semibold text-muted-foreground uppercase">Answering through areas with scout on</h4>
        {scoutAreas.map((a) => (
          <div key={a.id} className={cn("flex flex-col gap-1.5", !a.enabled && "opacity-60")}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {a.name}
                {a.enabled ? null : <span className="ml-2 text-xs font-normal text-muted-foreground">area disabled</span>}
              </span>
              {a.enabled ? <LiveBar l={a.live} /> : null}
            </div>
            {a.enabled ? <WorkersTable workers={pokemonWorkers(a)} color={color} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A section's title: the type's icon and name, with room for controls on the right. */
function TypeHeading({ type, children }: { type: UnboundModeType; children?: React.ReactNode }) {
  const t = TYPES[type];
  return (
    <>
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
        <t.icon className="size-4" style={{ color: t.color }} />
        {t.label}
      </h2>
      {children}
    </>
  );
}

/**
 * The "Invasion status" panel of Dragonite's metrics for this stack. Dragonite
 * counts invasions per instance, not per mode, so it covers all of the stack.
 */
function InvasionSection({ stack }: { stack: DragoniteInfo }) {
  // This stack's charts: 30 days from Zapdos, history_retention from memory.
  const maxRange = stack.historyMs || Infinity;
  const ranges = RANGES.filter((r) => Number(r.value) <= maxRange);
  const [chosen, setRange] = useState(RANGES[2].value);
  const range = ranges.some((r) => r.value === chosen) ? chosen : (ranges.at(-1)?.value ?? chosen);
  const meta = useQuery({ queryKey: ["dragonite-meta"], queryFn: endpoints.dragoniteMeta, staleTime: 300_000 });
  const panel = meta.data?.panels.find((p) => p.id === "invasions");
  const q = useQuery({
    queryKey: ["dragonite-panel", "invasions", Number(range), stack.id, ""],
    queryFn: () => endpoints.dragonitePanel("invasions", Number(range), [stack.id]),
    enabled: !!panel,
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });
  if (meta.data && !panel) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TypeHeading type="invasion" />
        <Toggle value={range} onChange={setRange} options={ranges} />
      </div>
      {meta.error || q.error ? (
        <p className="text-sm text-red-300">{((meta.error ?? q.error) as Error).message}</p>
      ) : panel && q.data ? (
        <PanelChart meta={panel} data={q.data} areas={[]} bare />
      ) : (
        <Spinner />
      )}
    </section>
  );
}

/** Status colours, as the admin's Level Mode table. */
const LEVEL_STATUS: Record<string, string> = {
  pending: "#f59e0b",
  starting: "#f59e0b",
  initial: "var(--muted-foreground)",
  running: "#3b82f6",
  finished: "#22c55e",
};
const levelColor = (st: string) => LEVEL_STATUS[st] ?? "#ef4444";

function LevelBadge({ status, error }: { status: string; error?: string }) {
  const c = levelColor(status);
  return (
    <span
      title={error}
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap"
      style={{ borderColor: `color-mix(in oklab, ${c} 45%, var(--border))`, background: `color-mix(in oklab, ${c} 12%, transparent)` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: c }} />
      {status || "—"}
    </span>
  );
}

const statLabel = (k: string) => k.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

/** The admin's per-account "Stats" table: each counter at the start, now, and per minute. */
function LevelStats({ r }: { r: LevelStat }) {
  const all: [string, { start: number; last: number }][] = [["time", r.time], ["level", r.level], ["xp", r.xp], ...Object.entries(r.stats).filter(([k]) => !["time", "level", "xp"].includes(k))];
  const minutes = (r.time.last - r.time.start) / 60;
  return (
    <div className="flex flex-col gap-2">
      {r.error ? <p className="text-xs text-red-300">{r.error}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-[11px] text-muted-foreground uppercase">
            <tr>
              <th className="py-1 pr-4 font-medium">Stat</th>
              <th className="py-1 pr-4 font-medium">Start</th>
              <th className="py-1 pr-4 font-medium">Now</th>
              <th className="py-1 font-medium">Per minute</th>
            </tr>
          </thead>
          <tbody>
            {all.map(([k, v]) => (
              <tr key={k} className="border-t border-border/50">
                <td className="py-1.5 pr-4 font-medium whitespace-nowrap">{statLabel(k)}</td>
                <td className="py-1.5 pr-4 whitespace-nowrap tabular-nums">{k === "time" ? fmt.time(v.start * 1000) : fmt.int(v.start)}</td>
                <td className="py-1.5 pr-4 whitespace-nowrap tabular-nums">{k === "time" ? fmt.time(v.last * 1000) : fmt.int(v.last)}</td>
                <td className="py-1.5 whitespace-nowrap text-muted-foreground tabular-nums">
                  {k === "time" ? "" : minutes > 0 ? fmt.dec2((v.last - v.start) / minutes) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Accounts levelling up now, as the admin's Level Mode table (the same
 * /modes/level/stats call): status, level reached, XP gained and time spent;
 * a row opens its counters per minute.
 */
function LevelSection({ stack }: { stack: DragoniteInfo }) {
  const { on } = useStacks();
  const q = useQuery({ queryKey: ["dragonite-level", stack.id], queryFn: () => endpoints.levelStats(stack.id), refetchInterval: 10_000 });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const rows = q.data ?? [];
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const byStatus = new Map<string, number>();
  for (const r of rows) byStatus.set(r.status || "—", (byStatus.get(r.status || "—") ?? 0) + 1);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <TypeHeading type="level" />
        {rows.length ? (
          <div className="flex w-full flex-wrap items-center gap-1.5 text-xs sm:ml-auto sm:w-auto sm:gap-2">
            {[...byStatus].map(([st, n]) => (
              <span key={st} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 tabular-nums">
                <span className="size-2 rounded-full" style={{ background: levelColor(st) }} />
                {st} <span className="font-semibold">{fmt.int(n)}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {q.error ? (
        <p className="text-sm text-red-300">{(q.error as Error).message}</p>
      ) : !q.data ? (
        <Spinner />
      ) : !rows.length ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">No account is levelling up {on(stack.id)} right now.</Card>
      ) : (
        <>
          <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card text-xs sm:hidden">
            {rows.map((r) => (
              <div key={r.account} className="flex flex-col gap-1 px-3 py-2">
                <button type="button" onClick={() => toggle(r.account)} aria-expanded={open.has(r.account)} className="flex items-center justify-between gap-2 text-left">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open.has(r.account) && "rotate-90")} />
                    <span className="truncate font-mono text-[13px]">{r.account}</span>
                  </span>
                  <LevelBadge status={r.status} error={r.error} />
                </button>
                <div className="flex items-center justify-between gap-2 pl-5 text-muted-foreground tabular-nums">
                  <span>
                    Level <b className="text-foreground">{r.level.start} → {r.level.last}</b> · +{fmt.int(r.xp.last - r.xp.start)} XP
                  </span>
                  <span className="shrink-0">{fmt.duration((r.time.last - r.time.start) * 1000)}</span>
                </div>
                {open.has(r.account) ? (
                  <div className="mt-1 rounded-lg bg-muted/30 p-2">
                    <LevelStats r={r} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <th className="w-8" />
                  <th>Account</th>
                  <th>Status</th>
                  <th>Level</th>
                  <th>XP gained</th>
                  <th>Time</th>
                  <th>Last update</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.account}>
                    <tr className="cursor-pointer" onClick={() => toggle(r.account)}>
                      <td>
                        <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open.has(r.account) && "rotate-90")} />
                      </td>
                      <td className="font-mono text-xs">{r.account}</td>
                      <td>
                        <LevelBadge status={r.status} error={r.error} />
                      </td>
                      <td className="tabular-nums">
                        {r.level.start} → <b>{r.level.last}</b>
                      </td>
                      <td className="tabular-nums">+{fmt.int(r.xp.last - r.xp.start)}</td>
                      <td className="text-muted-foreground tabular-nums">{fmt.duration((r.time.last - r.time.start) * 1000)}</td>
                      <td className="text-muted-foreground tabular-nums">{r.time.last ? fmt.ago(r.time.last * 1000) : "—"}</td>
                    </tr>
                    {open.has(r.account) ? (
                      <tr className="bg-muted/20 hover:bg-muted/20!">
                        <td colSpan={7} className="px-3! pb-4!">
                          <div className="w-0 min-w-full">
                            <LevelStats r={r} />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}
