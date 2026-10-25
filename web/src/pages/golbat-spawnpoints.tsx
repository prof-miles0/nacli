import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Check,
  ChevronDown,
  Copy,
  DatabaseBackup,
  Download,
  CircleDot,
  Clock3,
  EyeOff,
  Flame,
  type LucideIcon,
  MapPinned,
  Palette,
  Search,
  Timer,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SpawnpointCounts, SpawnpointDeleteRequest, SpawnpointMap as SpawnpointData, SpawnpointOverview } from "@shared/types";
import { FilterMenu } from "@/components/filter-menu";
import { toast } from "@/components/toaster";
import { Button, Card, Input, Modal, Spinner } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { type MenuPlace, placeMenu } from "@/lib/popover";
import { categories, categoryKeys, KNOWN, SEEN, type SpawnMode } from "@/lib/spawnpoints";
import { useAppInfo, useInstanceColor } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";

const SpawnpointMapLazy = lazy(() => import("@/components/spawnpoint-map").then((m) => ({ default: m.SpawnpointMap })));

const MODES: { value: SpawnMode; label: string; icon: LucideIcon }[] = [
  { value: "known", label: "Despawn known", icon: CircleDot },
  { value: "seen", label: "Last seen", icon: Clock3 },
  { value: "density", label: "Density", icon: Flame },
];
const MODE_KEY = "nacli.spawnpoints.mode";
const AREA_KEY = "nacli.spawnpoints.area";

type Area = SpawnpointOverview["areas"][number];
const areaKey = (a: Area) => `${a.stack}:${a.id}`;

const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const seenSegments = (c: SpawnpointCounts) => [c.seen24h, c.seen7d, c.seen30d, c.older].map((v, i) => ({ ...SEEN[i], value: v }));

function remembered(key: string) {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}
function remember(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Not remembered; the choice still applies now.
  }
}

/** Each stack's name and colour (the colour of the Rotom it feeds), for the area marks. */
function useStackLook() {
  const { data: app } = useAppInfo();
  const color = useInstanceColor();
  const stacks = (app?.dragonite ?? []).filter((d) => d.accounts);
  return {
    many: stacks.length > 1,
    count: stacks.length,
    of: (id: string) => {
      const d = stacks.find((x) => x.id === id);
      return { name: d?.name ?? id, color: d?.rotom ? color(d.rotom) : "var(--muted-foreground)" };
    },
  };
}

/**
 * The stacks an area belongs to, each as its colour and name, small. An area
 * copied to several stacks shows them all; a copy disabled there is faded.
 */
function StackMarks({ area }: { area: Area }) {
  const look = useStackLook();
  if (!look.many) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {area.stacks.map((c) => {
        const s = look.of(c.stack);
        return (
          <span
            key={c.stack}
            title={c.enabled ? `Active in ${s.name}` : `Disabled in ${s.name}`}
            className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 text-[10px] leading-4 text-muted-foreground", !c.enabled && "border-dashed opacity-55")}
            style={{ borderColor: `color-mix(in oklab, ${s.color} 45%, transparent)` }}
          >
            <span className="size-1.5 rounded-full" style={{ background: s.color }} />
            {s.name}
          </span>
        );
      })}
    </span>
  );
}

/** A thin bar of how recently the spawnpoints were seen, freshest first. */
function SeenBar({ c, className }: { c: SpawnpointCounts; className?: string }) {
  return (
    <div className={cn("flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-muted", className)}>
      {seenSegments(c)
        .filter((s) => s.value > 0)
        .map((s) => (
          <div key={s.label} className="h-full" style={{ width: `${pct(s.value, c.total)}%`, background: s.color }} />
        ))}
    </div>
  );
}

function Figure({ label, value, sub, children }: { label: string; value: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-background/40 px-2.5 py-2 sm:px-3">
      <span className="truncate text-[10px] font-medium tracking-wide text-muted-foreground uppercase sm:text-[11px]">{label}</span>
      <span className="text-base font-semibold tabular-nums sm:text-lg">{value}</span>
      {/* Wraps on phones instead of being cut off. */}
      {sub ? <span className="text-[11px] leading-snug text-muted-foreground sm:truncate sm:text-xs">{sub}</span> : null}
      {children}
    </div>
  );
}

/** Every area of every stack together. */
function Totals({ data }: { data: SpawnpointOverview }) {
  const look = useStackLook();
  const t = data.totals;
  const known = pct(t.known, t.total);
  const withPoints = data.areas.filter((a) => a.counts?.total).length;
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Figure
        label="Spawnpoints"
        value={fmt.int(t.total)}
        sub={`${withPoints} of ${data.areas.length} areas${look.many ? ` · ${look.count} stacks` : ""}`}
      />
      <Figure label="Despawn known" value={fmt.pct(known)} sub={`${fmt.int(t.total - t.known)} unknown`}>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full" style={{ width: `${known}%`, background: KNOWN.yes }} />
        </div>
      </Figure>
      <Figure label="Seen in 24 h" value={fmt.int(t.seen24h)} sub={`${fmt.int(t.seen24h + t.seen7d)} in 7 days`}>
        <SeenBar c={t} />
      </Figure>
      <Figure label="Not seen in 30 d" value={fmt.int(t.older)} sub={t.older ? "gone quiet or off the routes" : "all seen this month"} />
    </div>
  );
}

/** One area as the picker lists it: name, stack, how many, how recently seen and how many known. */
function AreaRow({ a, on }: { a: Area; on?: boolean }) {
  const c = a.counts;
  return (
    <span className="flex w-full min-w-0 flex-col gap-1.5">
      <span className="flex items-center gap-2 text-sm">
        <span className={cn("size-1.5 shrink-0 rounded-full", a.enabled ? "bg-green-500" : "bg-muted-foreground/40")} />
        <span className={cn("min-w-0 truncate", on && "font-semibold", !a.enabled && "text-muted-foreground")}>{a.name}</span>
        <StackMarks area={a} />
        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{c ? fmt.int(c.total) : ""}</span>
      </span>
      {a.error ? (
        <span className="pl-3.5 text-xs text-red-400">{a.error}</span>
      ) : c && c.total ? (
        <span className="flex items-center gap-2 pl-3.5">
          <SeenBar c={c} className="flex-1" />
          <span className="shrink-0 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">{fmt.pct(pct(c.known, c.total))} known</span>
        </span>
      ) : (
        <span className="pl-3.5 text-[11px] text-muted-foreground">No spawnpoints</span>
      )}
    </span>
  );
}

/** Every area of every stack in one dropdown, with a search. */
function AreaPicker({ areas, value, onChange }: { areas: Area[]; value?: Area; onChange: (a: Area) => void }) {
  const look = useStackLook();
  const [pos, setPos] = useState<MenuPlace>();
  const [q, setQ] = useState("");
  const ref = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const open = !!pos;
  useEffect(() => {
    if (!open) return;
    // Not on phones: the keyboard would cover half the list before anyone types.
    if (window.matchMedia("(pointer: fine)").matches) search.current?.focus();
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setPos(undefined);
    };
    const dismiss = (e: Event) => !menuRef.current?.contains(e.target as Node) && setPos(undefined);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPos(undefined);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  // The area or the stack name: "lunala" finds every area of that stack.
  const needle = q.trim().toLowerCase();
  const shown = areas.filter(
    (a) => !needle || a.name.toLowerCase().includes(needle) || a.stacks.some((c) => look.of(c.stack).name.toLowerCase().includes(needle)),
  );
  const toggle = () => {
    if (open) return setPos(undefined);
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos(placeMenu(r, Math.max(r.width, 360), 520));
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Area"
        className={cn(
          "inline-flex h-9 w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1 rounded-md border border-input bg-card px-3 text-sm transition-colors hover:bg-accent",
          open && "ring-2 ring-ring/50",
        )}
      >
        <MapPinned className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-left">{value ? value.name : "Choose an area"}</span>
        {value ? <StackMarks area={value} /> : null}
        {value?.counts ? <span className="hidden rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums sm:inline">{fmt.int(value.counts.total)}</span> : null}
        <ChevronDown className={cn("ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {pos
        ? createPortal(
            <div
              ref={menuRef}
              style={{ ...pos, maxHeight: Math.min(pos.maxHeight, 520) }}
              className="animate-in fixed z-50 flex flex-col overflow-hidden rounded-lg border bg-popover shadow-2xl"
            >
              <div className="flex items-center gap-2 border-b px-3">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <input
                  ref={search}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={look.many ? "Search areas or stacks…" : "Search areas…"}
                  className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                {q ? (
                  <button type="button" onClick={() => setQ("")} aria-label="Clear search">
                    <X className="size-4 text-muted-foreground hover:text-foreground" />
                  </button>
                ) : null}
              </div>
              <div role="listbox" aria-label="Areas" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
                {shown.length === 0 ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">No areas match.</p> : null}
                {/* Active areas first; the disabled ones in a section of their own at the bottom. */}
                {[shown.filter((a) => a.enabled), shown.filter((a) => !a.enabled)].map((list, i) =>
                  list.length ? (
                    <div key={i} className={cn(i > 0 && "mt-1 border-t pt-1")}>
                      {i > 0 ? (
                        <div className="flex items-center justify-between px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                          Disabled
                          <span className="font-normal tabular-nums">{list.length}</span>
                        </div>
                      ) : null}
                      {list.map((a) => {
                        const on = !!value && areaKey(a) === areaKey(value);
                        return (
                          <button
                            key={areaKey(a)}
                            type="button"
                            role="option"
                            aria-selected={on}
                            onClick={() => {
                              setPos(undefined);
                              setQ("");
                              onChange(a);
                            }}
                            className={cn("flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-foreground/10", on && "bg-foreground/5")}
                          >
                            <AreaRow a={a} on={on} />
                            <Check className={cn("mt-0.5 size-3.5 shrink-0", on ? "text-foreground" : "invisible")} />
                          </button>
                        );
                      })}
                    </div>
                  ) : null,
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * What each colour means, with how many of the area's spawnpoints it covers.
 * Each entry is a switch: a category turned off leaves the map.
 */
function Legend({ mode, data, hidden, onToggle, onReset }: { mode: SpawnMode; data: SpawnpointData; hidden: string[]; onToggle: (key: string) => void; onReset: () => void }) {
  const counts = useMemo(() => {
    const nowS = Math.floor(data.checkedAt / 1000);
    const out: Record<string, Record<string, number>> = { known: {}, seen: {} };
    for (const p of data.points) {
      const k = categoryKeys(p[2], Math.max(0, nowS - p[3]));
      for (const m of ["known", "seen"] as const) out[m][k[m]] = (out[m][k[m]] ?? 0) + 1;
    }
    return out;
  }, [data]);
  if (mode === "density") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Fewer
        <span className="h-2 w-28 rounded-full" style={{ background: "linear-gradient(to right, #1e3a8a, #2563eb, #22c55e, #facc15, #ef4444)" }} />
        More spawnpoints · zoom in to see each one
      </div>
    );
  }
  const total = data.points.length;
  return (
    <div className="-mx-3 flex items-center gap-1.5 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
      {categories(mode).map((c) => {
        const off = hidden.includes(c.key);
        const n = counts[mode][c.key] ?? 0;
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={!off}
            title={off ? "Show on the map" : "Hide from the map"}
            onClick={() => onToggle(c.key)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
              off ? "border-dashed text-muted-foreground opacity-60 hover:opacity-100" : "hover:bg-foreground/10",
            )}
            style={off ? undefined : { borderColor: `color-mix(in oklab, ${c.color} 45%, transparent)`, background: `color-mix(in oklab, ${c.color} 10%, transparent)` }}
          >
            {off ? <EyeOff className="size-3" /> : <span className="size-2 rounded-full" style={{ background: c.color }} />}
            <span className={cn(!off && "text-foreground")}>{c.label}</span>
            <span className="font-semibold tabular-nums">{fmt.int(n)}</span>
            <span className="text-muted-foreground tabular-nums">{fmt.pct(pct(n, total))}</span>
          </button>
        );
      })}
      {hidden.length ? (
        <button type="button" onClick={onReset} className="shrink-0 px-1.5 text-xs whitespace-nowrap text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Show all
        </button>
      ) : null}
    </div>
  );
}

/** The chosen area: its legend (which also filters) and its map. */
function AreaDetail({ area, mode }: { area: Area; mode: SpawnMode }) {
  const { data: app } = useAppInfo();
  const q = useQuery({ queryKey: ["spawnpoint-map", area.stack, area.id], queryFn: () => endpoints.spawnpointMap(area.stack, area.id), staleTime: 60_000 });
  // Hidden categories per mode, kept while switching modes (a new area starts with all shown).
  const [hidden, setHidden] = useState<Record<string, string[]>>({});
  const off = hidden[mode] ?? [];
  const toggle = (key: string) => setHidden((h) => ({ ...h, [mode]: off.includes(key) ? off.filter((k) => k !== key) : [...off, key] }));
  return (
    <Card className="gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {/* On phones the area picker right above already names it. */}
        <h3 className="hidden min-w-0 items-center gap-2 text-base font-semibold sm:flex">
          <MapPinned className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{area.name}</span>
          <StackMarks area={area} />
          {!area.enabled ? <span className="rounded-full bg-muted px-2 text-[11px] font-normal text-muted-foreground">disabled</span> : null}
        </h3>
        {q.data ? <span className="text-xs text-muted-foreground tabular-nums">{fmt.int(q.data.points.length)} spawnpoints</span> : null}
      </div>
      {q.data ? <Legend mode={mode} data={q.data} hidden={off} onToggle={toggle} onReset={() => setHidden((h) => ({ ...h, [mode]: [] }))} /> : null}
      {q.error ? (
        <p className="py-16 text-center text-sm text-red-300">{(q.error as Error).message}</p>
      ) : !q.data ? (
        <div className="grid h-[70svh] min-h-80 place-items-center rounded-lg border sm:h-[65vh]">
          <Spinner />
        </div>
      ) : (
        <Suspense fallback={<div className="grid h-[70svh] min-h-80 place-items-center rounded-lg border sm:h-[65vh]"><Spinner /></div>}>
          <SpawnpointMapLazy data={q.data} mode={mode} hidden={off} basemap={app?.map} className="h-[70svh] min-h-80 sm:h-[65vh]" />
        </Suspense>
      )}
    </Card>
  );
}

const AGES = [
  { value: "", label: "Any time" },
  ...[7, 14, 30, 60, 90].map((d) => ({ value: String(d), label: `More than ${d} days ago` })),
];
const DESPAWNS = [
  { value: "any", label: "Any" },
  { value: "unknown", label: "Unknown only" },
  { value: "known", label: "Known only" },
];

function ToolField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      {children}
    </label>
  );
}

/**
 * Deletes spawnpoints from Golbat's table by filter: where, how long since
 * last seen, and whether the despawn time is known. It shows how many match
 * before anything happens, and asks to type that number to confirm.
 */
function DeleteSpawnpoints({ area }: { area?: Area }) {
  const qc = useQueryClient();
  const [where, setWhere] = useState<SpawnpointDeleteRequest["where"]>("area");
  const [age, setAge] = useState("30");
  const [despawn, setDespawn] = useState<SpawnpointDeleteRequest["despawn"]>("any");
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const scope = where === "area" && !area ? "areas" : where;
  const request: SpawnpointDeleteRequest = {
    where: scope,
    area: scope === "area" ? areaKey(area!) : undefined,
    olderThanDays: age ? Number(age) : undefined,
    despawn,
  };
  const preview = useQuery({
    queryKey: ["spawnpoint-delete-preview", request],
    queryFn: () => endpoints.deleteSpawnpoints({ ...request, dryRun: true }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const count = preview.data?.count;
  const wheres = [
    ...(area ? [{ value: "area", label: `In ${area.name}` }] : []),
    { value: "areas", label: "In any area" },
    { value: "outside", label: "Outside every area" },
  ];
  const describe = [
    scope === "area" ? `in ${area?.name}` : scope === "areas" ? "inside any area" : "outside every area",
    age ? `last seen more than ${age} days ago` : "",
    despawn === "any" ? "" : `with ${despawn} despawn time`,
  ]
    .filter(Boolean)
    .join(", ");

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await endpoints.deleteSpawnpoints({ ...request, expect: count });
      toast({ tone: "success", text: `Deleted ${fmt.int(r.deleted ?? 0)} spawnpoints from Golbat` });
      setConfirming(false);
      setTyped("");
      // Counts, maps and history all change.
      for (const k of ["spawnpoint-overview", "spawnpoint-map", "spawnpoint-table", "spawnpoint-delete-preview"]) qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      setError((e as Error).message);
      qc.invalidateQueries({ queryKey: ["spawnpoint-delete-preview"] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-4 p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-red-500/10 text-red-400">
          <Trash2 className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Delete spawnpoints</h3>
          <p className="text-xs text-muted-foreground">
            Removes them from Golbat's spawnpoint table. Golbat adds back any it sees again. Needs DELETE on that table for the [database] user.
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <ToolField label="Where">
          <FilterMenu value={scope} onChange={(v) => setWhere(v as SpawnpointDeleteRequest["where"])} options={wheres} label="Where" icon={MapPinned} className="w-full" />
        </ToolField>
        <ToolField label="Last seen">
          <FilterMenu value={age} onChange={setAge} options={AGES} label="Last seen" icon={CalendarClock} className="w-full" />
        </ToolField>
        <ToolField label="Despawn time">
          <FilterMenu value={despawn} onChange={(v) => setDespawn(v as SpawnpointDeleteRequest["despawn"])} options={DESPAWNS} label="Despawn time" icon={Timer} className="w-full" />
        </ToolField>
      </div>
      <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          {preview.error ? (
            <span className="text-red-300">{(preview.error as Error).message}</span>
          ) : count === undefined ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Spinner className="size-4" /> Counting…
            </span>
          ) : (
            <>
              <b className={cn("tabular-nums", count && "text-red-400")}>{fmt.int(count)}</b>{" "}
              <span className="text-muted-foreground">spawnpoint{count === 1 ? "" : "s"} match{count === 1 ? "es" : ""}</span>
              {preview.isFetching ? <Spinner className="ml-2 inline size-3.5" /> : null}
            </>
          )}
        </p>
        <Button variant="destructive" disabled={!count || preview.isFetching} onClick={() => setConfirming(true)} className="w-full sm:w-auto">
          <Trash2 />
          Delete
        </Button>
      </div>

      <Modal
        open={confirming}
        onClose={() => !busy && (setConfirming(false), setTyped(""), setError(undefined))}
        title="Delete spawnpoints"
        icon={<TriangleAlert className="size-5 text-red-400" />}
        description="This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => (setConfirming(false), setTyped(""), setError(undefined))} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={run} disabled={busy || typed.trim() !== String(count)}>
              {busy ? <Spinner className="size-4" /> : <Trash2 />}
              Delete {fmt.int(count ?? 0)}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>
            <b className="tabular-nums">{fmt.int(count ?? 0)}</b> spawnpoints {describe} will be removed from Golbat's database.
          </p>
          <a
            href={endpoints.spawnpointBackupUrl}
            download
            className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            <Download className="size-3.5" />
            Download a backup of the table first
          </a>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              Type <b className="text-foreground tabular-nums">{count}</b> to confirm
            </span>
            <Input inputMode="numeric" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={String(count ?? "")} />
          </label>
          {error ? <p className="text-red-300">{error}</p> : null}
        </div>
      </Modal>
    </Card>
  );
}

/**
 * Downloads Golbat's whole spawnpoint table as a gzipped SQL file, and says
 * how to load it back. Only reads, so SELECT is enough.
 */
function BackupSpawnpoints() {
  const q = useQuery({ queryKey: ["spawnpoint-table"], queryFn: endpoints.spawnpointTable, staleTime: 60_000 });
  const restore = "gunzip -c <file>.sql.gz | mariadb -h <host> -u <user> -p <database>";
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(restore);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard (plain http): the command stays visible to copy by hand.
    }
  };
  return (
    <Card className="gap-4 p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-sky-400">
          <DatabaseBackup className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Back up spawnpoints</h3>
          <p className="text-xs text-muted-foreground">
            The whole spawnpoint table as a compressed SQL file. Loading it back restores the spawnpoints that are missing and leaves the rest as they are.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">To restore</span>
        <div className="flex items-center gap-2 rounded-md border bg-background/40 py-1.5 pr-1.5 pl-3">
          <code className="min-w-0 flex-1 overflow-x-auto text-xs whitespace-nowrap">{restore}</code>
          <button type="button" onClick={copy} aria-label="Copy the command" className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground">
            {copied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          {q.error ? (
            <span className="text-red-300">{(q.error as Error).message}</span>
          ) : !q.data ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Spinner className="size-4" /> Counting…
            </span>
          ) : (
            <>
              <b className="tabular-nums">{fmt.int(q.data.rows)}</b> <span className="text-muted-foreground">spawnpoints in the table</span>
            </>
          )}
        </p>
        <a
          href={endpoints.spawnpointBackupUrl}
          download
          aria-disabled={!q.data}
          className={cn(
            "inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border bg-card px-4 text-sm font-medium transition-colors hover:bg-accent sm:w-auto [&>svg]:size-4",
            !q.data && "pointer-events-none opacity-50",
          )}
        >
          <Download />
          Download backup
        </a>
      </div>
    </Card>
  );
}

/** Tools for Golbat's spawnpoint table, under the charts. */
function SpawnTools({ area }: { area?: Area }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">Tools</h2>
      <div className="flex flex-col gap-4">
        <DeleteSpawnpoints area={area} />
        <BackupSpawnpoints />
      </div>
    </section>
  );
}

export function GolbatSpawnpointsPage() {
  const { data: app } = useAppInfo();
  const [mode, setModeRaw] = useState<SpawnMode>(() => {
    const m = remembered(MODE_KEY);
    return MODES.some((x) => x.value === m) ? (m as SpawnMode) : "known";
  });
  const setMode = (m: string) => {
    setModeRaw(m as SpawnMode);
    remember(MODE_KEY, m);
  };
  const [picked, setPicked] = useState(() => remembered(AREA_KEY));
  const q = useQuery({ queryKey: ["spawnpoint-overview"], queryFn: endpoints.spawnpointOverview, refetchInterval: 5 * 60_000 });

  if (!app) return <Spinner className="mx-auto mt-20" />;

  // By name (the same name in two stacks, by stack); without a remembered one,
  // the active area with the most spawnpoints opens.
  const areas = [...(q.data?.areas ?? [])].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.stack.localeCompare(b.stack));
  const rank = (a: Area) => (a.enabled ? 1e9 : 0) + (a.counts?.total ?? 0);
  const biggest = areas.reduce<Area | undefined>((best, a) => (!best || rank(a) > rank(best) ? a : best), undefined);
  // A merged area is found by any of its copies: the copy it is read from can change.
  const area = areas.find((a) => a.stacks.some((c) => `${c.stack}:${c.id}` === picked)) ?? biggest ?? areas[0];

  return (
    <div className="animate-in flex flex-col gap-4">
      <Card className="p-3 sm:p-4">
        {q.error ? <p className="text-sm text-red-300">{(q.error as Error).message}</p> : !q.data ? <Spinner /> : <Totals data={q.data} />}
        {q.data?.errors.length ? (
          <p className="mt-2 text-xs text-amber-400">
            {q.data.errors.map((e) => `${e.stack}: ${e.error}`).join(" · ")}
          </p>
        ) : null}
      </Card>

      {q.data ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <AreaPicker
              areas={areas}
              value={area}
              onChange={(a) => {
                setPicked(areaKey(a));
                remember(AREA_KEY, areaKey(a));
              }}
            />
            <FilterMenu value={mode} onChange={setMode} options={MODES} label="Colour by" icon={Palette} className="w-full sm:w-48" />
          </div>
          {area ? <AreaDetail key={areaKey(area)} area={area} mode={mode} /> : <Card className="p-6 text-sm text-muted-foreground">No Dragonite area has a geofence.</Card>}
          <SpawnTools area={area} />
        </>
      ) : null}
    </div>
  );
}
