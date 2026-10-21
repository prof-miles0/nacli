import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Check, ChevronRight, Copy, Minus, Pencil, Plus } from "lucide-react";
import { Fragment, useState } from "react";
import type { DragoniteArea, DragoniteInfo, DragoniteLiveGroup, DragoniteLiveWorker } from "@shared/types";
import { useNotify } from "@/components/actions";
import { toast } from "@/components/toaster";
import { CreateAreaModal } from "@/components/area-create";
import { type FolderTab, FolderTabs, tabTint } from "@/components/folder-tabs";
import { HeadStat, MiniProgress } from "@/components/head-stat";
import { MenuButton } from "@/components/menu-button";
import { StatusDot, type StatusTone } from "@/components/status-dot";
import { matches, SearchBox, useSorted } from "@/components/table-tools";
import { Button, Card, HoverCard, Input, Label, Modal, Spinner, Table } from "@/components/ui";
import { ApiError, endpoints } from "@/lib/api";
import { useAppInfo, useInstanceColor } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";

/** Running at full strength, short of workers, idle, or switched off. */
function areaState(a: DragoniteArea): { tone: StatusTone; label: string; detail?: string } {
  if (!a.enabled) return { tone: "off", label: "Disabled" };
  const l = a.live;
  if (!l || l.expected === 0) return { tone: "warn", label: "Enabled, no workers" };
  if (l.active < l.expected) return { tone: "warn", label: "Short of workers", detail: `${l.active} of ${l.expected}` };
  return { tone: "good", label: "Running", detail: `${l.active} workers` };
}

const Flag = ({ on }: { on: boolean }) =>
  on ? <Check className="size-4 text-green-400" /> : <Minus className="size-4 text-muted-foreground/50" />;

/** Workers count, dimmed when the mode is off for the area. */
const Count = ({ n, on }: { n: number; on: boolean }) => (
  <span className={cn("tabular-nums", (!on || n === 0) && "text-muted-foreground/60")}>{n}</span>
);

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
  if (!workers.length) return <p className="text-xs text-muted-foreground">No workers assigned right now.</p>;
  const now = Date.now();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-[11px] text-muted-foreground uppercase">
          <tr>
            <th className="py-1 pr-4 font-medium">Worker</th>
            <th className="py-1 pr-4 font-medium">Device</th>
            <th className="py-1 pr-4 font-medium">Account</th>
            <th className="py-1 pr-4 font-medium">Mode</th>
            <th className="py-1 pr-4 font-medium">Route</th>
            <th className="py-1 pr-4 font-medium">Last data</th>
            <th className="py-1 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {[...workers]
            .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
            .map((w) => {
              const stale = w.lastData && now - w.lastData * 1000 > 5 * 60_000;
              return (
                <tr key={`${w.name}:${w.deviceId}`} className="border-t border-border/50">
                  <td className="py-1.5 pr-4 font-medium whitespace-nowrap">{w.name || "—"}</td>
                  <td className="py-1.5 pr-4 whitespace-nowrap">
                    <HoverCard content={<span className="font-mono">{w.deviceId || "no device"}</span>}>
                      <span className="inline-flex items-center gap-1.5">
                        {w.rotom ? <span className="size-2 rounded-full" style={{ background: color(w.rotom.rotomId) }} /> : null}
                        {w.rotom?.device ?? (w.deviceId ? <span className="text-muted-foreground">unknown</span> : "—")}
                      </span>
                    </HoverCard>
                  </td>
                  <td className="py-1.5 pr-4 font-mono">{w.account || "—"}</td>
                  <td className="py-1.5 pr-4 whitespace-nowrap">{MODES[w.mode] ?? (w.mode || "—")}</td>
                  <td className="py-1.5 pr-4">
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
                  <td className={cn("py-1.5 pr-4 whitespace-nowrap tabular-nums", stale ? "text-amber-400" : "text-muted-foreground")}>
                    {w.lastData ? fmt.ago(w.lastData * 1000) : "—"}
                  </td>
                  <td className="py-1.5 whitespace-nowrap text-muted-foreground">{w.status || "—"}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}



const STACK_KEY = "nacli.areas.stack";

export function DragoniteAreasPage() {
  const { data: app } = useAppInfo();
  const withApi = (app?.dragonite ?? []).filter((d) => d.accounts);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  // One stack at a time, the last one picked (kept per browser).
  const [chosen, setChosen] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem(STACK_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  });
  const current = withApi.find((d) => d.id === chosen) ?? withApi[0];
  const choose = (id: string) => {
    setChosen(id);
    try {
      localStorage.setItem(STACK_KEY, id);
    } catch {
      // Not remembered; the choice still applies now.
    }
  };

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
        tabEdge={
          withApi.length > 1
            ? withApi[0].id === current.id
              ? "left"
              : withApi.at(-1)!.id === current.id
                ? "right"
                : undefined
            : undefined
        }
        toolbar={
          <>
            <SearchBox value={search} onChange={setSearch} placeholder="Search areas…" />
            <Button onClick={() => setCreating(true)}>
              <Plus />
              New area
            </Button>
          </>
        }
      />
      {creating ? <CreateAreaModal stacks={withApi} initial={current.id} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

/** The stacks as folder tabs, each closed one with its active areas and workers. */
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
    const live = data?.areas.reduce((n, a) => n + (a.enabled ? (a.live?.active ?? 0) : 0), 0);
    return {
      id: d.id,
      label: d.name,
      color: d.rotom ? color(d.rotom) : undefined,
      summary: data ? `${on}/${data.areas.length} areas · ${live} workers` : undefined,
    };
  });
}

/** One stack's areas: its summary, its table and its modes without an area. */
function StackAreas({
  stack,
  stacks,
  search,
  tabs,
  tabEdge,
  toolbar,
}: {
  stack: DragoniteInfo;
  stacks: DragoniteInfo[];
  search: string;
  /** Folder tabs drawn on top of the header, the selected one joined to it. */
  tabs?: React.ReactNode;
  /** Which outer corner the selected tab sits on (that corner goes square). */
  tabEdge?: "left" | "right";
  /** Shown between the header and the areas (the search box). */
  toolbar?: React.ReactNode;
}) {
  const color = useInstanceColor();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<DragoniteArea>();
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
  const others = stacks.filter((x) => x.id !== stack.id);
  /** The "…" menu of an area: edit it, or copy/move it to another stack. */
  const menu = (a: DragoniteArea) => (
    <MenuButton
      kind="Area"
      subject={a.name}
      items={[
        { key: "edit", label: "Edit", hint: "Workers and per-mode options", icon: Pencil, onSelect: () => setEditing(a) },
        {
          key: "copy",
          label: "Copy to another stack",
          hint: others.length ? "Creates a copy, with its route, in another Dragonite" : "No other stack with an API",
          icon: Copy,
          disabled: !others.length,
          onSelect: () => setTransfer({ area: a, move: false }),
        },
        {
          key: "move",
          label: "Move to another stack",
          // An area that is scanning must be stopped first: moving it would cut
          // its workers off mid-route.
          hint: !others.length
            ? "No other stack with an API"
            : a.enabled
              ? "Disable it first to move it"
              : "Copies it, then deletes it from this stack",
          icon: ArrowRightLeft,
          danger: true,
          disabled: !others.length || a.enabled,
          onSelect: () => setTransfer({ area: a, move: true }),
        },
      ]}
    />
  );
  const q = useQuery({
    queryKey: ["dragonite-areas", stack.id],
    queryFn: () => endpoints.dragoniteAreas(stack.id),
    refetchInterval: 15_000,
  });
  const rows = (q.data?.areas ?? []).filter((a) => matches(search, a.name));
  const { sorted, header } = useSorted(
    rows,
    {
      name: (a) => a.name,
      enabled: (a) => (a.enabled ? 0 : 1),
      live: (a) => a.live?.active ?? -1,
      pokemon: (a) => a.pokemon.workers,
      fort: (a) => a.fort.workers,
      rare: (a) => a.rare.workers,
      quest: (a) => a.quest.workers,
    },
    "name",
  );
  const stackColor = stack.rotom ? color(stack.rotom) : "var(--muted-foreground)";
  const refresh = () => qc.invalidateQueries({ queryKey: ["dragonite-areas", stack.id] });

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
        const modes = [
          ["Pokémon", a.pokemon],
          ["Forts", a.fort],
          ["Rare", a.rare],
          ["Quests", a.quest],
        ] as const;
        return (
          <div key={a.id} className="flex flex-col gap-2 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => toggle(a.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
                <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
                <StatusDot tone={st.tone} label={st.label} detail={st.detail} />
                <span className={cn("truncate text-sm font-medium", !a.enabled && "text-muted-foreground")}>{a.name}</span>
              </button>
              <Switch
                on={pendingOn[a.id] ?? a.enabled}
                busy={a.id in pendingOn}
                label={a.enabled ? "Disable area" : "Enable area"}
                onChange={() => switchArea(a)}
              />
              {menu(a)}
            </div>
            {a.enabled ? <LiveBar l={a.live} /> : null}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {modes.map(([label, m]) => (
                <span key={label} className={cn(m.enabled && m.workers > 0 && "text-foreground")}>
                  {label} <b className="tabular-nums">{m.workers}</b>
                </span>
              ))}
              {a.quest.enabled ? <span>hours {a.quest.hours.length ? a.quest.hours.join(", ") : "all"}</span> : null}
            </div>
            {open ? (
              <div className="rounded-lg bg-muted/30 p-2">
                <AreaDetail a={a} color={color} />
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
            {header("pokemon", "Pokémon")}
            {header("fort", "Forts")}
            {header("rare", "Rare")}
            {header("quest", "Quests")}
            <th>Quest hours</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {list.length === 0 ? (
            <tr>
              <td colSpan={10} className="py-8 text-center text-muted-foreground">
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
                      <span className={cn("font-medium whitespace-nowrap", !a.enabled && "text-muted-foreground")}>{a.name}</span>
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
                  <td>
                    <Count n={a.pokemon.workers} on={a.pokemon.enabled} />
                  </td>
                  <td>
                    <Count n={a.fort.workers} on={a.fort.enabled} />
                  </td>
                  <td>
                    <Count n={a.rare.workers} on={a.rare.enabled} />
                  </td>
                  <td>
                    <Count n={a.quest.workers} on={a.quest.enabled} />
                  </td>
                  <td className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {a.quest.enabled ? (a.quest.hours.length ? a.quest.hours.join(", ") : "all") : "—"}
                  </td>
                  <td onClick={(e) => e.stopPropagation()} className="text-right">
                    {menu(a)}
                  </td>
                </tr>
                {open ? (
                  <tr className="bg-muted/20 hover:bg-muted/20!">
                    {/* Full width: no empty chevron column on the left; width 0 so its tables do not widen this one. */}
                    <td colSpan={10} className="px-3! pb-4!">
                      <div className="w-0 min-w-full">
                        <AreaDetail a={a} color={color} />
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
          tabEdge === "left" && "rounded-tl-none",
          tabEdge === "right" && "rounded-tr-none",
        )}
        style={{ background: tabs ? `linear-gradient(180deg, ${tabTint(stackColor)}, var(--card) 85%)` : `linear-gradient(90deg, color-mix(in oklab, ${stackColor} 14%, var(--card)), var(--card) 55%)` }}
      >
        {tabs ? null : <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: stackColor }} />}
        {/* With tabs, the open tab already names the stack: keep the name only for screen readers. */}
        <div className={cn("flex min-w-36 flex-col gap-0.5 pl-1", tabs && "sr-only")}>
          <Label>Stack</Label>
          <h2 className="text-lg leading-tight font-bold">{stack.name}</h2>
        </div>
        {q.data ? (
          <div
            className={cn(
              "grid flex-1 grid-cols-2 gap-2",
              // Without the title the figures share the whole width.
              tabs ? "sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]" : "sm:flex sm:flex-wrap sm:items-stretch sm:justify-end",
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

      {toolbar ? <div className="mt-2 flex flex-wrap items-center justify-between gap-2">{toolbar}</div> : null}

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
      {editing ? (
        <AreaEditModal stack={stack} area={editing} onClose={() => setEditing(undefined)} onDone={refresh} />
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

type Draft = {
  name: string;
  pokemon: { enabled: boolean; workers: number; scout: boolean; invasion: boolean };
  quest: { enabled: boolean; workers: number; hours: number[] };
  fort: { enabled: boolean; workers: number; prioRaid: boolean; showcase: boolean; invasion: boolean };
  rare: { enabled: boolean; workers: number; permyriad: number };
};

const draftOf = (a: DragoniteArea): Draft => ({
  name: a.name,
  pokemon: { enabled: a.pokemon.enabled, workers: a.pokemon.workers, scout: a.pokemon.scout, invasion: a.pokemon.invasion },
  quest: { enabled: a.quest.enabled, workers: a.quest.workers, hours: [...a.quest.hours] },
  fort: { ...a.fort },
  rare: { ...a.rare },
});

/** Only what changed, mode by mode (the server fills in the rest of each mode). */
function diff(a: Draft, b: Draft) {
  const out: Record<string, unknown> = {};
  if (a.name !== b.name) out.name = b.name;
  for (const k of ["pokemon", "quest", "fort", "rare"] as const) {
    const changed: Record<string, unknown> = {};
    for (const [f, v] of Object.entries(b[k])) {
      const old = (a[k] as Record<string, unknown>)[f];
      if (JSON.stringify(old) !== JSON.stringify(v)) changed[f] = v;
    }
    if (Object.keys(changed).length) out[k] = changed;
  }
  return out;
}

/** The area's settings, as in Dragonite's admin (minus routes and geofences). */
function AreaEditModal({
  stack,
  area,
  onClose,
  onDone,
}: {
  stack: DragoniteInfo;
  area: DragoniteArea;
  onClose: () => void;
  onDone: () => void;
}) {
  const initial = draftOf(area);
  const [d, setD] = useState<Draft>(initial);
  const changes = diff(initial, d);
  const dirty = Object.keys(changes).length > 0;
  const m = useMutation({
    mutationFn: () => endpoints.updateArea(stack.id, area.id, changes),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const set = <K extends keyof Draft>(k: K, v: Partial<Draft[K]>) =>
    setD((x) => ({ ...x, [k]: typeof x[k] === "object" ? { ...(x[k] as object), ...v } : v }));

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          Edit area
          <span className="text-muted-foreground">· {stack.name}</span>
        </span>
      }
      footer={
        <>
          <span className="mr-auto text-xs text-muted-foreground">
            {dirty ? `${Object.keys(changes).length} section${Object.keys(changes).length === 1 ? "" : "s"} changed` : "No changes"}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={!dirty || m.isPending}>
            {m.isPending ? <Spinner className="size-4" /> : null}
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5">
          <Label>Name</Label>
          <Input value={d.name} onChange={(e) => setD((x) => ({ ...x, name: e.target.value }))} maxLength={64} />
        </label>

        <ModeBox
          title="Pokémon"
          on={d.pokemon.enabled}
          onToggle={(v) => set("pokemon", { enabled: v })}
          workers={d.pokemon.workers}
          onWorkers={(v) => set("pokemon", { workers: v })}
        >
          <Check2 label="Scout" on={d.pokemon.scout} onChange={(v) => set("pokemon", { scout: v })} />
          <Check2 label="Invasions" on={d.pokemon.invasion} onChange={(v) => set("pokemon", { invasion: v })} />
        </ModeBox>

        <ModeBox
          title="Quests"
          on={d.quest.enabled}
          onToggle={(v) => set("quest", { enabled: v })}
          workers={d.quest.workers}
          onWorkers={(v) => set("quest", { workers: v })}
        >
          <div className="flex w-full flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              Hours {d.quest.hours.length ? `(${d.quest.hours.length})` : "· none selected"}
            </span>
            <div className="grid grid-cols-12 gap-1">
              {Array.from({ length: 24 }, (_, h) => {
                const sel = d.quest.hours.includes(h);
                return (
                  <button
                    key={h}
                    type="button"
                    aria-pressed={sel}
                    onClick={() =>
                      set("quest", { hours: sel ? d.quest.hours.filter((x) => x !== h) : [...d.quest.hours, h].sort((a, b) => a - b) })
                    }
                    className={cn(
                      "h-7 rounded-md border text-xs tabular-nums transition-colors",
                      sel ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {h}
                  </button>
                );
              })}
            </div>
          </div>
        </ModeBox>

        <ModeBox
          title="Forts"
          on={d.fort.enabled}
          onToggle={(v) => set("fort", { enabled: v })}
          workers={d.fort.workers}
          onWorkers={(v) => set("fort", { workers: v })}
        >
          <Check2 label="Prioritise raids" on={d.fort.prioRaid} onChange={(v) => set("fort", { prioRaid: v })} />
          <Check2 label="Showcase" on={d.fort.showcase} onChange={(v) => set("fort", { showcase: v })} />
          <Check2 label="Invasions" on={d.fort.invasion} onChange={(v) => set("fort", { invasion: v })} />
        </ModeBox>

        <ModeBox
          title="Rare Pokémon"
          on={d.rare.enabled}
          onToggle={(v) => set("rare", { enabled: v })}
          workers={d.rare.workers}
          onWorkers={(v) => set("rare", { workers: v })}
        >
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Per 10,000</span>
            <Input
              type="number"
              min={0}
              max={10000}
              value={d.rare.permyriad}
              onChange={(e) => set("rare", { permyriad: Math.max(0, Math.min(10000, Math.round(Number(e.target.value) || 0))) })}
              className="h-8 w-24"
            />
          </label>
        </ModeBox>

        <p className="text-xs text-muted-foreground">
          Routes and geofences are not edited here. To enable or disable the area, use the switch in the table.
        </p>
        {m.error ? <p className="text-sm text-red-300">{(m.error as Error).message}</p> : null}
      </div>
    </Modal>
  );
}

function ModeBox({
  title,
  on,
  onToggle,
  workers,
  onWorkers,
  children,
}: {
  title: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  workers: number;
  onWorkers: (v: number) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border p-4 transition-opacity", !on && "opacity-70")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Switch on={on} onChange={onToggle} label={`${title}: ${on ? "disable" : "enable"}`} />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Workers</span>
          <Input
            type="number"
            min={0}
            max={500}
            value={workers}
            onChange={(e) => onWorkers(Math.max(0, Math.min(500, Math.round(Number(e.target.value) || 0))))}
            className="h-8 w-20"
          />
        </label>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-x-5 gap-y-2">{children}</div> : null}
    </div>
  );
}

function Check2({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--primary)]" />
      {label}
    </label>
  );
}

function AreaDetail({ a, color }: { a: DragoniteArea; color: (id: string) => string }) {
  const on = (b: boolean) => (b ? "yes" : "no");
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        <Field k="Pokémon route" v={`${fmt.int(a.pokemon.routePoints)} points`} />
        <Field k="Scout · invasions" v={`${on(a.pokemon.scout)} · ${on(a.pokemon.invasion)}`} />
        <Field k="Quest route" v={`${fmt.int(a.quest.routePoints)} points`} />
        <Field k="Time zone" v={a.timezone || "—"} />
        <Field k="Forts: raid priority" v={on(a.fort.prioRaid)} />
        <Field k="Forts: showcase · invasions" v={`${on(a.fort.showcase)} · ${on(a.fort.invasion)}`} />
        <Field k="Rare (per 10,000)" v={fmt.int(a.rare.permyriad)} />
        <Field k="ID" v={String(a.id)} />
      </div>
      <WorkersTable workers={a.live?.workers ?? []} color={color} />
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/50 py-1">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium tabular-nums">{v}</span>
    </div>
  );
}
