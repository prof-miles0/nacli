import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, CalendarClock, ChevronRight, Copy, History, ListChecks, Pencil, Play, Plus, RefreshCw, ScrollText, Trash2, Wand2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { DragoniteInfo, GroupOut, SchedActivity, SchedAreaActivity, ScheduleOut, SchedRun } from "@shared/types";
import { type FolderTab, FolderPanel, FolderTabs } from "@/components/folder-tabs";
import { HeadStat, MiniProgress } from "@/components/head-stat";
import { FilterMenu } from "@/components/filter-menu";
import { MenuButton } from "@/components/menu-button";
import { CopyScheduleModal, GroupModal, QuestMigrationModal, RunNowModal, ScheduleModal } from "@/components/scheduler-forms";
import { useStacks } from "@/components/stack-tag";
import { matches, SearchBox, Toggle, useSorted } from "@/components/table-tools";
import { toast } from "@/components/toaster";
import { Button, Card, HoverCard, Modal, Spinner, Table } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { actionEffect, actionText, BUILTIN_GROUPS, KIND_LABEL, timings, windowText } from "@/lib/scheduler";
import { useAppInfo, useInstanceColor } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";
import { Switch } from "./dragonite-areas";

const STACK_KEY = "nacli.scheduler.stack";
const VIEW_KEY = "nacli.scheduler.view";

type View = "schedules" | "groups" | "runs";
const VIEWS = [
  { value: "schedules", label: "Schedules", icon: CalendarClock },
  { value: "groups", label: "Groups", icon: Boxes },
  { value: "runs", label: "Runs", icon: ScrollText },
];

const remember = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Not remembered; the choice still applies now.
  }
};
const recall = (key: string) => {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
};

/** Outcome colours: done, failed, skipped, waiting. */
const OUTCOME: Record<string, { label: string; color: string }> = {
  success: { label: "Success", color: "#22c55e" },
  error: { label: "Error", color: "#ef4444" },
  skipped: { label: "Skipped", color: "var(--muted-foreground)" },
  pending: { label: "Pending", color: "#f59e0b" },
};
const outcomeOf = (o: string) => OUTCOME[o] ?? { label: o, color: "var(--muted-foreground)" };

function Pill({ color, children, title }: { color: string; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap"
      style={{ borderColor: `color-mix(in oklab, ${color} 45%, var(--border))`, background: `color-mix(in oklab, ${color} 12%, transparent)` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

const ms = (iso?: string) => (iso ? new Date(iso).getTime() : NaN);

/** Each schedule kind's colour, for its pill. */
const KIND_COLOR: Record<string, string> = { recurring: "#3b82f6", dated: "#f59e0b", manual: "#a855f7" };
const KindPill = ({ kind }: { kind: string }) => <Pill color={KIND_COLOR[kind] ?? "var(--muted-foreground)"}>{KIND_LABEL[kind] ?? kind}</Pill>;

/** A few values as small chips, the rest counted ("+2"), all of them on hover. */
function Chips({ items, max = 3, mono, nowrap }: { items: string[]; max?: number; mono?: boolean; nowrap?: boolean }) {
  if (!items.length) return <span className="text-muted-foreground">—</span>;
  const rest = items.length - max;
  return (
    <span className={cn("flex items-center gap-1", nowrap ? "flex-nowrap" : "flex-wrap")} title={items.join(", ")}>
      {items.slice(0, max).map((x, i) => (
        <span key={i} className={cn("rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-foreground/80", mono && "font-mono tabular-nums")}>
          {x}
        </span>
      ))}
      {rest > 0 ? <span className="text-[11px] text-muted-foreground">+{rest}</span> : null}
    </span>
  );
}

export function DragoniteSchedulerPage() {
  const { data: app } = useAppInfo();
  const color = useInstanceColor();
  const stacks = (app?.dragonite ?? []).filter((d) => d.accounts);
  const [chosen, setChosen] = useState(() => recall(STACK_KEY));
  const schedules = useQueries({
    queries: stacks.map((d) => ({ queryKey: ["scheduler-schedules", d.id], queryFn: () => endpoints.scheduler.schedules(d.id), refetchInterval: 30_000 })),
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
    const list = schedules[i].data;
    return {
      id: d.id,
      label: d.name,
      color: d.rotom ? color(d.rotom) : undefined,
      summary: list ? `${list.filter((s) => s.enabled).length}/${list.length} enabled` : undefined,
    };
  });
  return (
    <StackScheduler
      key={current.id}
      stack={current}
      others={stacks.filter((d) => d.id !== current.id)}
      tabs={
        stacks.length > 1 ? (
          <FolderTabs
            label="Stack"
            tabs={tabs}
            value={current.id}
            onChange={(id) => {
              setChosen(id);
              remember(STACK_KEY, id);
            }}
          />
        ) : null
      }
      tabbed={stacks.length > 1}
    />
  );
}

/** One stack's scheduler: summary, problems, and its schedules, groups and run ledger. */
function StackScheduler({ stack, others, tabs, tabbed }: { stack: DragoniteInfo; others: DragoniteInfo[]; tabs: React.ReactNode; tabbed?: boolean }) {
  const { multi, on } = useStacks();
  const color = useInstanceColor();
  const qc = useQueryClient();
  const stackColor = stack.rotom ? color(stack.rotom) : "var(--muted-foreground)";
  const [view, setViewRaw] = useState<View>(() => (recall(VIEW_KEY) as View) || "schedules");
  const setView = (v: View) => {
    setViewRaw(v);
    remember(VIEW_KEY, v);
  };
  const [runsFor, setRunsFor] = useState<number>();
  const schedules = useQuery({ queryKey: ["scheduler-schedules", stack.id], queryFn: () => endpoints.scheduler.schedules(stack.id), refetchInterval: 30_000 });
  const groups = useQuery({ queryKey: ["scheduler-groups", stack.id], queryFn: () => endpoints.scheduler.groups(stack.id), refetchInterval: 60_000 });
  const active = useQuery({ queryKey: ["scheduler-active", stack.id], queryFn: () => endpoints.scheduler.active(stack.id), refetchInterval: 30_000 });
  const diag = useQuery({ queryKey: ["scheduler-diagnostics", stack.id], queryFn: () => endpoints.scheduler.diagnostics(stack.id), refetchInterval: 60_000 });
  // The last 24 h, counted on the server: only the totals come back.
  const runs = useQuery({
    queryKey: ["scheduler-runs-24h", stack.id],
    queryFn: () => endpoints.scheduler.runs(stack.id, { since: Date.now() - 86_400_000, limit: 1 }),
    refetchInterval: 30_000,
  });
  const refresh = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("scheduler-") });

  const list = schedules.data ?? [];
  const activeIds = new Set((active.data?.schedules ?? []).map((s) => s.id));
  const recent = runs.data?.total ?? 0;
  const errors = runs.data?.counts.error ?? 0;
  const problems = [...(diag.data?.problems ?? [])].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));

  return (
    <div className="animate-in flex flex-col gap-3">
      <div className="flex flex-col">
        {tabs}
        <FolderPanel color={stackColor} tabbed={tabbed}>
          {!schedules.data ? (
            schedules.error ? <p className="text-sm text-red-300">{(schedules.error as Error).message}</p> : <Spinner />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <HeadStat label="Schedules" value={`${list.filter((s) => s.enabled).length}/${list.length}`} hint="Enabled of all">
                <MiniProgress value={list.filter((s) => s.enabled).length} max={list.length} color={stackColor} />
              </HeadStat>
              <HeadStat label="Active now" value={fmt.int(activeIds.size)} hint="Schedules changing something right now">
                <span className="truncate text-[11px] text-muted-foreground">{(active.data?.schedules ?? []).map((s) => s.name).join(", ") || "none"}</span>
              </HeadStat>
              <HeadStat label="Groups" value={fmt.int(groups.data?.length ?? 0)} hint="Plus the built-in all, all-pokemon, all-fort, all-quest and all-rare">
                <span className="text-[11px] text-muted-foreground">+{BUILTIN_GROUPS.length} built-in</span>
              </HeadStat>
              <HeadStat label="Runs · 24h" value={fmt.int(recent)} tone={errors ? "warn" : undefined} hint="Runs fired in the last 24 hours">
                <span className="text-[11px] text-muted-foreground">
                  {fmt.int(runs.data?.counts.success ?? 0)} ok · {fmt.int(errors)} failed
                </span>
              </HeadStat>
            </div>
          )}
        </FolderPanel>
      </div>

      {problems.length ? (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-amber-300">Configuration problems</p>
              <p className="text-[11px] text-muted-foreground">
                checked {diag.data?.checked_at ? fmt.ago(ms(diag.data.checked_at)) : "—"}
                {diag.data?.areas_loaded_at || diag.data?.schedules_loaded_at
                  ? ` · config loaded ${fmt.time(ms(diag.data.areas_loaded_at ?? diag.data.schedules_loaded_at))}`
                  : ""}
              </p>
            </div>
            {problems.some((p) => p.code === "pending_reload") ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await endpoints.scheduler.reload(stack.id);
                    toast({ text: `${multi ? stack.name : "Dragonite"} is reloading its configuration` });
                    refresh();
                  } catch (e) {
                    toast({ text: (e as Error).message, error: true });
                  }
                }}
              >
                <RefreshCw />
                Reload Dragonite
              </Button>
            ) : null}
          </div>
          <ul className="flex flex-col gap-1">
            {problems.map((p, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                <Pill color={p.severity === "error" ? "#ef4444" : "#f59e0b"}>{p.severity}</Pill>
                <code className="text-muted-foreground">{p.code}</code>
                {p.schedule_name || p.group_name ? <span className="font-medium">{p.schedule_name ?? p.group_name}</span> : null}
                <span className="text-muted-foreground">{p.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-2">
        <Toggle
          size="md"
          fill
          value={view}
          onChange={(v) => setView(v as View)}
          options={VIEWS.map((o) => ({
            ...o,
            count: o.value === "schedules" ? schedules.data?.length : o.value === "groups" ? groups.data?.length : undefined,
          }))}
        />
      </div>

      {view === "schedules" ? (
        <SchedulesView
          stack={stack}
          others={others}
          list={schedules.data}
          groups={groups.data ?? []}
          activeIds={activeIds}
          refresh={refresh}
          onRuns={(id) => {
            setRunsFor(id);
            setView("runs");
          }}
        />
      ) : view === "groups" ? (
        <GroupsView stack={stack} list={groups.data} schedules={list} error={groups.error as Error | null} refresh={refresh} />
      ) : (
        <RunsView stack={stack} schedules={list} activity={active.data} scheduleId={runsFor} onSchedule={setRunsFor} />
      )}
    </div>
  );
}

/** A yes/no dialog whose action may fail: the error stays in the dialog. */
function Confirm({ title, action, children, onConfirm, onClose }: { title: string; action: string; children: React.ReactNode; onConfirm: () => Promise<void>; onClose: () => void }) {
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
      <div className="text-sm text-muted-foreground">{children}</div>
      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
    </Modal>
  );
}

/** Its groups and areas, and what it leaves out ("except …"). */
const targetsOf = (s: ScheduleOut) => {
  const t = s.document.targets ?? {};
  return [...(t.groups ?? []), ...(t.areas ?? []), ...(t.exclude?.length ? [`except ${t.exclude.join(", ")}`] : [])];
};
const targetText = (s: ScheduleOut) => {
  const t = s.document.targets ?? {};
  return [...(t.groups ?? []), ...(t.areas ?? [])].join(", ") + (t.exclude?.length ? ` · except ${t.exclude.join(", ")}` : "");
};

function SchedulesView({
  stack,
  others,
  list,
  groups,
  activeIds,
  refresh,
  onRuns,
}: {
  stack: DragoniteInfo;
  others: DragoniteInfo[];
  list?: ScheduleOut[];
  groups: GroupOut[];
  activeIds: Set<number>;
  refresh: () => void;
  onRuns: (id: number) => void;
}) {
  const { on } = useStacks();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<ScheduleOut | "new">();
  const [deleting, setDeleting] = useState<ScheduleOut>();
  const [running, setRunning] = useState<{ s: ScheduleOut; idx: number }>();
  const [copying, setCopying] = useState<ScheduleOut>();
  const [migrating, setMigrating] = useState(false);
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const rows = useMemo(() => (list ?? []).filter((s) => matches(search, s.name, targetText(s))), [list, search]);
  const { sorted, header } = useSorted(
    rows,
    { name: (s) => s.name, enabled: (s) => Number(s.enabled) },
    "name",
  );
  const toggle = (id: number) =>
    setOpen((x) => {
      const n = new Set(x);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const setEnabled = async (s: ScheduleOut) => {
    if (s.id in pending) return;
    setPending((p) => ({ ...p, [s.id]: !s.enabled }));
    try {
      await endpoints.scheduler.setEnabled(stack.id, s.id, !s.enabled);
      toast({ text: `“${s.name}” ${s.enabled ? "disabled" : "enabled"}${on(stack.id)}` });
      refresh();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setPending(({ [s.id]: _, ...rest }) => rest);
    }
  };
  const menu = (s: ScheduleOut) => (
    <MenuButton
      kind="Schedule"
      subject={s.name}
      items={[
        { key: "edit", label: "Edit", hint: "Timing, targets and actions", icon: Pencil, onSelect: () => setEditing(s) },
        // Only with another stack to copy it to.
        ...(others.length
          ? [
              {
                key: "copy",
                label: "Copy to another stack",
                hint: "With the groups it uses; starts disabled",
                icon: Copy,
                onSelect: () => setCopying(s),
              },
            ]
          : []),
        { key: "runs", label: "View runs", hint: "Its history in the run ledger", icon: History, onSelect: () => onRuns(s.id) },
        {
          key: "delete",
          label: "Delete",
          hint: s.source === "config" ? "Config-seeded: deleting it stops route recalculation" : "Removes it from this Dragonite",
          icon: Trash2,
          danger: true,
          onSelect: () => setDeleting(s),
        },
      ]}
    />
  );
  const badges = (s: ScheduleOut) => (
    <>
      {activeIds.has(s.id) ? <Pill color="#22c55e">active</Pill> : null}
      {s.source === "config" ? (
        <HoverCard content={<span>Config-seeded: reproduces Dragonite's built-in cron behaviour</span>}>
          <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">config</span>
        </HoverCard>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 sm:flex-none">
          <SearchBox value={search} onChange={setSearch} placeholder="Search schedules…" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* The admin's quest-hours migration: an icon, its name on hover. */}
          <HoverCard
            className="inline-flex"
            content={
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">Migrate quest hours</span>
                <span className="text-muted-foreground">Turns the areas' quest hours into start/check schedules</span>
              </span>
            }
          >
            <Button size="icon" variant="outline" className="size-9" aria-label="Migrate quest hours" onClick={() => setMigrating(true)}>
              <Wand2 />
            </Button>
          </HoverCard>
          <Button onClick={() => setEditing("new")}>
            <Plus />
            New
          </Button>
        </div>
      </div>

      {!list ? (
        <Spinner />
      ) : (
        <>
          {/* Phone: one card per schedule. */}
          <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card sm:hidden">
            {sorted.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{list.length ? "No schedules match." : "No schedules yet."}</p> : null}
            {sorted.map((s) => (
              <div key={s.id} className="flex flex-col gap-2 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => toggle(s.id)} aria-expanded={open.has(s.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open.has(s.id) && "rotate-90")} />
                    <span className="truncate text-sm font-medium">{s.name}</span>
                    {badges(s)}
                  </button>
                  <Switch on={pending[s.id] ?? s.enabled} busy={s.id in pending} label={s.enabled ? "Disable schedule" : "Enable schedule"} onChange={() => setEnabled(s)} />
                  {menu(s)}
                </div>
                <div className="pl-6">
                  <Chips items={timings(s.document)} mono />
                </div>
                {open.has(s.id) ? (
                  <div className="rounded-lg bg-muted/30 p-2">
                    <ScheduleDetail s={s} onRun={(idx) => setRunning({ s, idx })} />
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
                  {header("name", "Name")}
                  <th>Timings</th>
                  {header("enabled", "Enabled")}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      {list.length ? "No schedules match." : "No schedules yet."}
                    </td>
                  </tr>
                ) : null}
                {sorted.map((s) => (
                  <Fragment key={s.id}>
                    <tr className="cursor-pointer" onClick={() => toggle(s.id)}>
                      <td>
                        <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open.has(s.id) && "rotate-90")} />
                      </td>
                      <td>
                        <span className={cn("inline-flex items-center gap-2 font-medium whitespace-nowrap", !s.enabled && "text-muted-foreground")}>
                          {s.name}
                          {badges(s)}
                        </span>
                      </td>
                      <td className="w-full">
                        <Chips items={timings(s.document)} mono nowrap />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Switch on={pending[s.id] ?? s.enabled} busy={s.id in pending} label={s.enabled ? "Disable schedule" : "Enable schedule"} onChange={() => setEnabled(s)} />
                      </td>
                      <td onClick={(e) => e.stopPropagation()} className="text-right">
                        {menu(s)}
                      </td>
                    </tr>
                    {open.has(s.id) ? (
                      <tr className="bg-muted/20 hover:bg-muted/20!">
                        <td colSpan={5} className="px-3! pb-4!">
                          <div className="w-0 min-w-full">
                            <ScheduleDetail s={s} onRun={(idx) => setRunning({ s, idx })} />
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

      {editing ? <ScheduleModal stack={stack} schedule={editing === "new" ? undefined : editing} groups={groups} onClose={() => setEditing(undefined)} onDone={refresh} /> : null}
      {copying ? <CopyScheduleModal stack={stack} others={others} schedule={copying} groups={groups} onClose={() => setCopying(undefined)} onDone={refresh} /> : null}
      {running ? <RunNowModal stack={stack} schedule={running.s} actionIdx={running.idx} onClose={() => setRunning(undefined)} onDone={refresh} /> : null}
      {migrating ? <QuestMigrationModal stack={stack} onClose={() => setMigrating(false)} onDone={refresh} /> : null}
      {deleting ? (
        <Confirm
          title={`Delete ${deleting.name}`}
          action="Delete"
          onClose={() => setDeleting(undefined)}
          onConfirm={async () => {
            await endpoints.scheduler.deleteSchedule(stack.id, deleting.id);
            toast({ text: `Schedule “${deleting.name}” deleted${on(stack.id, "from")}` });
            refresh();
          }}
        >
          {deleting.source === "config"
            ? "This schedule is config-seeded: it reproduces Dragonite's built-in cron behaviour, and deleting it stops route recalculation."
            : `“${deleting.name}” will be removed${on(stack.id, "from")}.`}
        </Confirm>
      ) : null}
    </div>
  );
}

/** A schedule spelled out: targets, timing and each action, with "Run now" on job actions. */
function ScheduleDetail({ s, onRun }: { s: ScheduleOut; onRun: (idx: number) => void }) {
  const d = s.document;
  const rows: [string, string][] = [
    ...(d.windows?.length ? ([["Windows", `${d.windows.map(windowText).join(", ")} (area-local)`]] as [string, string][]) : []),
    ...(d.dates?.length ? ([["Dates", d.dates.join(", ")]] as [string, string][]) : []),
    ...(d.expires_at ? ([["Expires", fmt.time(ms(d.expires_at))]] as [string, string][]) : []),
    ...(d.tz ? ([["Timezone", d.tz]] as [string, string][]) : []),
  ];
  return (
    <div className="flex flex-col gap-3 text-xs">
      {/* What the row leaves out: its kind, priority and targets. */}
      <div className="flex flex-wrap items-center gap-2">
        <KindPill kind={d.schedule_kind} />
        <span className="rounded-full border px-2 py-0.5 text-muted-foreground tabular-nums">priority {s.priority}</span>
        <span className="text-muted-foreground">targets</span>
        <Chips items={targetsOf(s)} max={6} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 empty:hidden">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </Fragment>
        ))}
      </dl>
      <div className="flex flex-col gap-1.5">
        {d.actions.map((a, i) => (
          <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-3 py-2">
            <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">#{i}</span>
            <span className="font-medium">{actionText(a)}</span>
            <span className="text-muted-foreground">
              {[a.at ? `at ${a.at}` : "", ...(a.windows ?? []).map(windowText)].filter(Boolean).join(" · ")}
            </span>
            <span className="text-muted-foreground">{actionEffect(a)}</span>
            {a.kind === "job" ? (
              <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => onRun(i)}>
                <Play />
                Run now
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupsView({ stack, list, schedules, error, refresh }: { stack: DragoniteInfo; list?: GroupOut[]; schedules: ScheduleOut[]; error: Error | null; refresh: () => void }) {
  const { on } = useStacks();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<GroupOut | "new">();
  const [deleting, setDeleting] = useState<GroupOut>();
  const usedBy = (g: GroupOut) =>
    schedules.filter((s) => [...(s.document.targets?.groups ?? []), ...(s.document.targets?.exclude ?? [])].includes(g.name)).map((s) => s.name);
  const rows = (list ?? []).filter((g) => matches(search, g.name, ...(g.document.areas ?? []).map((a) => a.area)));
  const members = (g: GroupOut) =>
    (g.document.areas ?? []).map((a) => (a.attributes?.length ? `${a.area} (${a.attributes.join(", ")})` : a.area)).join(", ");
  const pools = (g: GroupOut) => (g.document.pools ?? []).map((p) => p.pool).join(", ");
  const menu = (g: GroupOut) => (
    <MenuButton
      kind="Group"
      subject={g.name}
      items={[
        { key: "edit", label: "Edit", hint: "Areas and pools", icon: Pencil, onSelect: () => setEditing(g) },
        {
          key: "delete",
          label: "Delete",
          hint: usedBy(g).length ? "Used by a schedule: remove it there first" : "Removes it from this Dragonite",
          icon: Trash2,
          danger: true,
          disabled: usedBy(g).length > 0,
          onSelect: () => setDeleting(g),
        },
      ]}
    />
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 sm:flex-none">
          <SearchBox value={search} onChange={setSearch} placeholder="Search groups…" />
        </div>
        <Button className="shrink-0" onClick={() => setEditing("new")}>
          <Plus />
          New
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-red-300">{error.message}</p>
      ) : !list ? (
        <Spinner />
      ) : !list.length ? (
        <Card className="items-center gap-1.5 p-6 text-center text-sm">
          <Boxes className="size-5 text-muted-foreground" />
          <span className="font-medium">No groups of its own{on(stack.id)} yet</span>
          <span className="text-xs text-muted-foreground">Group areas to target them together from a schedule; the built-in ones below are always there.</span>
        </Card>
      ) : (
        <>
          <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card sm:hidden">
            {rows.map((g) => (
              <div key={g.id} className="flex flex-col gap-1 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{g.name}</span>
                  {menu(g)}
                </div>
                <p className="text-xs text-muted-foreground">{members(g) || "no areas"}</p>
                {pools(g) ? <p className="text-xs text-muted-foreground">pools: {pools(g)}</p> : null}
              </div>
            ))}
          </div>
          <div className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Areas</th>
                  <th>Pools</th>
                  <th>Used by</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <tr key={g.id}>
                    <td className="font-medium">{g.name}</td>
                    <td className="max-w-80 truncate text-xs text-muted-foreground" title={members(g)}>
                      <span className="mr-1 font-semibold text-foreground tabular-nums">{g.document.areas?.length ?? 0}</span>
                      {members(g)}
                    </td>
                    <td className="text-xs text-muted-foreground">{pools(g) || "—"}</td>
                    <td className="text-xs text-muted-foreground">{usedBy(g).join(", ") || "—"}</td>
                    <td className="text-right">{menu(g)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      )}
      {/* Dragonite's own groups, always there and not editable. */}
      <div className="flex flex-col gap-2 rounded-xl border border-dashed px-4 py-3">
        <span className="inline-flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <Boxes className="size-3.5" />
          Built-in groups
        </span>
        <Chips items={[...BUILTIN_GROUPS]} max={BUILTIN_GROUPS.length} mono />
        <span className="text-[11px] text-muted-foreground">
          <code>all</code> holds every area; each <code>all-&lt;type&gt;</code>, every area with workers of that type.
        </span>
      </div>
      {editing ? <GroupModal stack={stack} group={editing === "new" ? undefined : editing} onClose={() => setEditing(undefined)} onDone={refresh} /> : null}
      {deleting ? (
        <Confirm
          title={`Delete ${deleting.name}`}
          action="Delete"
          onClose={() => setDeleting(undefined)}
          onConfirm={async () => {
            await endpoints.scheduler.deleteGroup(stack.id, deleting.id);
            toast({ text: `Group “${deleting.name}” deleted${on(stack.id, "from")}` });
            refresh();
          }}
        >
          “{deleting.name}” will be removed{on(stack.id, "from")}.
        </Confirm>
      ) : null}
    </div>
  );
}

/** One area's live overrides: workers baseline→effective, pauses, route mode. */
function AreaActivity({ a }: { a: SchedAreaActivity }) {
  const lines = [
    ...Object.entries(a.workers ?? {}).map(([t, w]) => `${t}: ${w.baseline}→${w.effective} (${w.schedule_name})`),
    ...Object.entries(a.paused ?? {}).map(([t, p]) => `${t}: paused (${p.schedule_name})`),
    ...(a.route_mode ? [`route mode: ${a.route_mode.mode} (${a.route_mode.schedule_name})`] : []),
  ];
  return <span className="text-muted-foreground">{lines.join(" · ")}</span>;
}

function ActivePanel({ activity }: { activity?: SchedActivity }) {
  const areas = Object.entries(activity?.areas ?? {});
  const pools = Object.entries(activity?.pools ?? {});
  const empty = activity && !activity.schedules.length && !areas.length && !pools.length;
  return (
    <Card className="gap-2 p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 font-semibold">
          <ListChecks className="size-4 text-green-400" />
          Active now
        </h3>
        <span className="text-[11px] text-muted-foreground">{activity ? `as of ${fmt.ago(ms(activity.tick_at))} · updates every ~minute` : ""}</span>
      </div>
      {!activity ? (
        <Spinner />
      ) : empty ? (
        <p className="text-xs text-muted-foreground">No scheduler effects right now.</p>
      ) : (
        <div className="flex flex-col gap-1.5 text-xs">
          <div className="flex flex-wrap gap-1.5">
            {activity.schedules.map((s) => (
              <Pill key={s.id} color="#22c55e">
                {s.name}
              </Pill>
            ))}
          </div>
          {areas.map(([id, a]) => (
            <p key={id}>
              <span className="font-medium">{a.name ?? `area ${id}`}</span> <AreaActivity a={a} />
            </p>
          ))}
          {pools.map(([type, p]) => (
            <p key={type}>
              <span className="font-medium">pool {type}</span>{" "}
              <span className="text-muted-foreground">
                {[
                  ...Object.entries(p.scale ?? {}).map(([row, w]) => `row ${row}: ${w.baseline}→${w.effective} (${w.schedule_name})`),
                  ...(p.paused ? [`paused (${p.paused.schedule_name})`] : []),
                ].join(" · ")}
              </span>
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

const PER_PAGE = 50;

/** Calls `onSeen` when the element scrolls near the viewport: the next page of a list. */
function useNearEnd(onSeen: () => void, active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onSeen);
  cb.current = onSeen;
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && cb.current(), { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [active]);
  return ref;
}

/** How long a run took: Dragonite stamps start and finish with the same clock, so the gap is right even when the stamps are not. */
const took = (r: SchedRun) => {
  const t = ms(r.finished_at) - ms(r.started_at);
  return Number.isFinite(t) && t >= 0 ? fmt.duration(t) : "—";
};

/**
 * The run ledger: Dragonite keeps the newest 1000 runs (per schedule when one is
 * chosen). Nacli's server filters and counts them, and the list loads 50 at a
 * time as it scrolls.
 */
function RunsView({
  stack,
  schedules,
  activity,
  scheduleId,
  onSchedule,
}: {
  stack: DragoniteInfo;
  schedules: ScheduleOut[];
  activity?: SchedActivity;
  scheduleId?: number;
  onSchedule: (id?: number) => void;
}) {
  const [outcome, setOutcome] = useState("");
  const [search, setSearch] = useState("");
  // Searched on the server, once typing pauses.
  const [needle, setNeedle] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setNeedle(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const q = useInfiniteQuery({
    queryKey: ["scheduler-runs", stack.id, scheduleId ?? 0, needle, outcome],
    queryFn: ({ pageParam }) => endpoints.scheduler.runs(stack.id, { scheduleId, offset: pageParam, limit: PER_PAGE, q: needle, outcome }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
  const first = q.data?.pages[0];
  const shown = q.data?.pages.flatMap((p) => p.runs) ?? [];
  const total = first?.total ?? 0;
  // Each outcome's count among the runs the search leaves, for the filter.
  const outcomes = Object.keys(OUTCOME).map((k) => ({ value: k, label: OUTCOME[k].label, color: OUTCOME[k].color, count: first?.counts[k] ?? 0 }));
  const searched = Object.values(first?.counts ?? {}).reduce((n, x) => n + x, 0);
  const more = useNearEnd(() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage(), !!q.hasNextPage);
  const name = (r: SchedRun) => r.schedule_name ?? schedules.find((s) => s.id === r.schedule_id)?.name ?? `#${r.schedule_id}`;

  return (
    <div className="flex flex-col gap-3">
      <ActivePanel activity={activity} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-auto">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search runs…"
          />
        </div>
        {/* Phones: the two filters share the row under the search. */}
        <div className="flex w-full gap-2 sm:w-auto">
          <FilterMenu
            className="min-w-0 flex-1 sm:flex-none"
            label="Schedule"
            allLabel="All schedules"
            icon={CalendarClock}
            value={scheduleId === undefined ? "" : String(scheduleId)}
            onChange={(v) => onSchedule(v ? Number(v) : undefined)}
            options={schedules.map((s) => ({ value: String(s.id), label: s.name }))}
          />
          <FilterMenu
            className="min-w-0 flex-1 sm:flex-none"
            label="Outcome"
            allLabel="All outcomes"
            value={outcome}
            onChange={setOutcome}
            options={outcomes.filter((o) => o.count || o.value === outcome)}
            total={searched}
          />
        </div>
      </div>
      {q.error ? (
        <p className="text-sm text-red-300">{(q.error as Error).message}</p>
      ) : !q.data ? (
        <Spinner />
      ) : (
        <>
          <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card text-xs sm:hidden">
            {shown.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">No runs match.</p> : null}
            {shown.map((r) => (
              <div key={r.id} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{r.summary || r.target_key}</span>
                  <Pill color={outcomeOf(r.outcome).color}>{outcomeOf(r.outcome).label}</Pill>
                </div>
                <div className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span className="truncate">
                    {name(r)} · #{r.action_idx}
                  </span>
                  <span className="shrink-0" title={fmt.time(ms(r.fire_at))}>
                    {fmt.ago(ms(r.fire_at))}
                  </span>
                </div>
                {r.detail ? <p className="break-words text-muted-foreground">{r.detail}</p> : null}
              </div>
            ))}
          </div>
          <div className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <th>Fired</th>
                  <th>Schedule</th>
                  <th>Action</th>
                  <th>Summary</th>
                  <th>Outcome</th>
                  <th>Took</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      No runs match.
                    </td>
                  </tr>
                ) : null}
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-muted-foreground tabular-nums" title={`#${r.id} · ${fmt.time(ms(r.fire_at))}`}>
                      {fmt.time(ms(r.fire_at))}
                    </td>
                    <td className="whitespace-nowrap">{name(r)}</td>
                    <td className="text-muted-foreground tabular-nums">#{r.action_idx}</td>
                    <td className="max-w-80 truncate" title={r.summary}>
                      {r.summary || r.target_key}
                    </td>
                    <td>
                      <Pill color={outcomeOf(r.outcome).color}>{outcomeOf(r.outcome).label}</Pill>
                    </td>
                    <td className="whitespace-nowrap text-muted-foreground tabular-nums">{took(r)}</td>
                    <td className="max-w-64 truncate text-xs text-muted-foreground" title={r.detail}>
                      {r.detail || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          {/* Near here, the next page loads. */}
          <div ref={more} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {q.hasNextPage ? `${fmt.int(shown.length)} of ${fmt.int(total)} runs` : `${fmt.int(total)} run${total === 1 ? "" : "s"}`}
              {first?.capped ? " · Dragonite keeps the newest 1000" : ""}
            </span>
            {q.isFetchingNextPage ? (
              <span className="inline-flex items-center gap-2">
                <Spinner className="size-3.5" />
                Loading more…
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
