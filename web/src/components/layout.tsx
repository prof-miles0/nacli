import {
  CalendarClock,
  ChartColumnBig,
  HeartPulse,
  Shapes,
  BriefcaseBusiness,
  ChartLine,
  Cpu,
  Database,
  LayoutDashboard,
  Map as MapIcon,
  MapPinned,
  Network,
  PanelLeft,
  Server,
  Smartphone,
  Timer,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { AppInfo } from "@shared/types";
import { endpoints } from "@/lib/api";
import { isUp, linkState } from "@/lib/dragonite";
import { useAppInfo } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";
import { AlertsBar } from "./alerts";
import { useAuth } from "./auth";
import { Toaster } from "./toaster";
import { UserMenu } from "./user-menu";
import { Button, HoverCard } from "./ui";

/** Same breakpoint as Dragonite's admin (Tailwind md). */
const MD = 768;
const SIDEBAR_KEY = "nacli.sidebar";

const NAV: {
  group: string;
  /** An item with `when` only shows when config.toml enables what it needs. */
  items: { to: string; label: string; icon: typeof LayoutDashboard; when?: (app: AppInfo) => boolean }[];
}[] = [
  {
    group: "", // no heading: Dashboard sits at the top on its own
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard },
      { to: "/status", label: "Status", icon: HeartPulse },
    ],
  },
  {
    group: "Dragonite",
    items: [
      { to: "/dragonite/accounts", label: "Accounts", icon: Users },
      { to: "/dragonite/areas", label: "Areas", icon: MapIcon },
      { to: "/dragonite/modes", label: "Unbound Modes", icon: Shapes },
      { to: "/dragonite/proxies", label: "Proxies", icon: Network },
      { to: "/dragonite/scheduler", label: "Scheduler", icon: CalendarClock },
      { to: "/dragonite/metrics", label: "Metrics", icon: ChartLine },
    ],
  },
  {
    group: "Rotom",
    items: [
      { to: "/instances", label: "Instances", icon: Server },
      { to: "/devices", label: "Devices", icon: Smartphone },
      { to: "/workers", label: "Workers", icon: Cpu },
      { to: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
      { to: "/metrics", label: "Metrics", icon: ChartLine },
    ],
  },
  {
    group: "Golbat",
    items: [
      { to: "/golbat/spawnpoints", label: "Spawnpoints", icon: MapPinned, when: (a) => a.golbatSpawnpoints },
      { to: "/golbat/encounters", label: "Encounters", icon: Timer, when: (a) => a.golbatDb },
      { to: "/golbat/stats", label: "Statistics", icon: ChartColumnBig, when: (a) => a.golbatStats },
      { to: "/golbat/metrics", label: "Metrics", icon: ChartLine, when: (a) => a.golbat },
    ],
  },
];

const PAGE_TITLES: Record<string, string> = Object.fromEntries(
  // Pages inside a group are titled "Group · Page" (e.g. "Rotom · Workers").
  NAV.flatMap((g) => g.items.map((i) => [i.to, g.group ? `${g.group} · ${i.label}` : i.label])),
);

/** Tiny pills next to the RotomNG heading: how many instances answer and how many do not. */
function InstanceHealth() {
  const { data } = useAppInfo();
  if (!data) return null;
  const ok = data.instances.filter((i) => i.reachable);
  const down = data.instances.filter((i) => !i.reachable);
  return (
    <HoverCard
      content={
        <div className="flex flex-col gap-1">
          {data.instances.map((i) => (
            <span key={i.id} className="flex items-center gap-2">
              <span className={cn("size-1.5 rounded-full", i.reachable ? "bg-green-500" : "bg-red-500")} />
              <span className="font-medium">{i.name}</span>
              <span className="text-muted-foreground">
                {i.reachable ? "online" : (i.lastError ?? "offline")}
              </span>
            </span>
          ))}
        </div>
      }
    >
      <span className="inline-flex items-center gap-1">
        {ok.length ? (
          <span className="inline-flex h-4 items-center gap-1 rounded-full bg-green-500/15 px-1.5 text-[10px] font-semibold text-green-400 tabular-nums">
            <span className="size-1.5 rounded-full bg-green-500" />
            {ok.length}
          </span>
        ) : null}
        {down.length ? (
          <span className="inline-flex h-4 items-center gap-1 rounded-full bg-red-500/15 px-1.5 text-[10px] font-semibold text-red-400 tabular-nums">
            <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
            {down.length}
          </span>
        ) : null}
      </span>
    </HoverCard>
  );
}

/** Pills next to the Dragonite heading: up / down, amber when a Rotom link looks wrong. */
function DragoniteHealth() {
  const { data } = useQuery({ queryKey: ["dragonite-summary"], queryFn: endpoints.dragoniteSummary, refetchInterval: 30_000 });
  if (!data) return null;
  const up = data.instances.filter(isUp);
  const down = data.instances.filter((d) => !isUp(d));
  const odd = data.instances.filter((d) => isUp(d) && linkState(d) !== "ok");
  return (
    <HoverCard
      content={
        <div className="flex flex-col gap-1">
          {data.instances.map((d) => (
            <span key={d.id} className="flex items-center gap-2">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  !isUp(d) ? "bg-red-500" : linkState(d) === "ok" ? "bg-green-500" : "bg-amber-500",
                )}
              />
              <span className="font-medium">{d.name}</span>
              <span className="text-muted-foreground">
                {!isUp(d)
                  ? "no metrics"
                  : linkState(d) === "none"
                    ? "no controllers on Rotom"
                    : linkState(d) === "mismatch"
                      ? "connected to another Rotom"
                      : "online"}
              </span>
            </span>
          ))}
        </div>
      }
    >
      <span className="inline-flex items-center gap-1">
        {up.length - odd.length ? (
          <span className="inline-flex h-4 items-center gap-1 rounded-full bg-green-500/15 px-1.5 text-[10px] font-semibold text-green-400 tabular-nums">
            <span className="size-1.5 rounded-full bg-green-500" />
            {up.length - odd.length}
          </span>
        ) : null}
        {odd.length ? (
          <span className="inline-flex h-4 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-400 tabular-nums">
            <span className="size-1.5 rounded-full bg-amber-500" />
            {odd.length}
          </span>
        ) : null}
        {down.length ? (
          <span className="inline-flex h-4 items-center gap-1 rounded-full bg-red-500/15 px-1.5 text-[10px] font-semibold text-red-400 tabular-nums">
            <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
            {down.length}
          </span>
        ) : null}
      </span>
    </HoverCard>
  );
}

/** Pill next to the Golbat heading: green while its metrics keep arriving. */
function GolbatHealth() {
  const { data: app } = useAppInfo();
  const { data } = useQuery({ queryKey: ["golbat-summary"], queryFn: endpoints.golbatSummary, refetchInterval: 60_000, enabled: !!app?.golbat });
  if (!app?.golbat || !data) return null;
  // Zapdos scrapes every few seconds; two minutes without data means Golbat is down.
  const ok = data.lastSeenS != null && data.lastSeenS < 120;
  return (
    // inline-flex: aligned by their boxes, not by a text baseline that differs between them.
    <HoverCard
      className="inline-flex"
      content={
        ok ? (
          <span>Golbat is sending metrics · last data {fmt.ago(Date.now() - (data.lastSeenS ?? 0) * 1000)}</span>
        ) : (
          <span className="text-red-400">
            No metrics from Golbat
            {data.lastSeenS != null ? ` (last seen ${fmt.ago(Date.now() - data.lastSeenS * 1000)})` : ""}
          </span>
        )
      }
    >
      <span
        className={cn(
          "inline-flex h-4 items-center gap-1 rounded-full px-1.5 text-[10px] font-semibold",
          ok ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400",
        )}
      >
        <span className={cn("size-1.5 rounded-full", ok ? "bg-green-500" : "animate-pulse bg-red-500")} />
        {ok ? "OK" : "Down"}
      </span>
    </HoverCard>
  );
}

type DbState = "ok" | "denied" | "down";
const dbState = (c: { ok?: boolean; denied?: boolean }): DbState => (c.ok ? "ok" : c.denied ? "denied" : "down");
/** Several databases: the worst of them. */
const worstDb = (states: DbState[]): DbState => (states.includes("down") ? "down" : states.includes("denied") ? "denied" : "ok");
const DB_DOT: Record<DbState, string> = { ok: "bg-green-500", denied: "bg-amber-500", down: "bg-red-500" };
const DB_TEXT: Record<DbState, string> = { ok: "text-muted-foreground", denied: "text-amber-400", down: "text-red-400" };

/**
 * The database pill: green while Nacli can read it, orange when the server
 * answers but the database or its tables are not granted (or missing), red
 * (pulsing) when it cannot be reached. A click opens the Help step that fixes it.
 */
function DbPill({ state }: { state: DbState }) {
  return (
    <NavLink
      to={state === "denied" ? "/help#permissions" : "/help#database"}
      aria-label={state === "ok" ? "Database readable" : state === "denied" ? "Database not readable: permissions" : "Database unreachable"}
      className={cn(
        "inline-flex h-4 items-center gap-1 rounded-full px-1.5 text-[10px] font-semibold transition-opacity hover:opacity-80",
        state === "ok" ? "bg-green-500/15 text-green-400" : state === "denied" ? "bg-amber-500/15 text-amber-400" : "bg-red-500/15 text-red-400",
      )}
    >
      <Database className={cn("size-2.5", state !== "ok" && "animate-pulse")} />
      DB
    </NavLink>
  );
}

/**
 * Pill beside Dragonite's, when any Dragonite has its database set ([database]
 * + database in [stack.dragonite]): green while Nacli can read every one.
 */
function DragoniteDbHealth() {
  const { data: app } = useAppInfo();
  const on = !!app?.dragonite.some((d) => d.database);
  const { data } = useQuery({ queryKey: ["dragonite-db"], queryFn: endpoints.dragoniteDb, refetchInterval: 30_000, enabled: on });
  if (!on || !data?.length) return null;
  return (
    <HoverCard
      className="inline-flex"
      content={
        <div className="flex flex-col gap-1">
          {data.map((d) => (
            <span key={d.id} className="flex items-center gap-2">
              <span className={cn("size-1.5 shrink-0 rounded-full", DB_DOT[dbState(d)])} />
              <span className="font-medium">{d.name}</span>
              <span className={DB_TEXT[dbState(d)]}>{d.ok ? `database readable · ${d.ms} ms` : d.error}</span>
            </span>
          ))}
          {data.some((d) => !d.ok) ? <span className="text-muted-foreground">Click for the Help step that fixes it.</span> : null}
        </div>
      }
    >
      <DbPill state={worstDb(data.map(dbState))} />
    </HoverCard>
  );
}

/**
 * Pill of its own beside it, when Golbat's database is set ([database] +
 * [golbat] database): green while Nacli can read it, red with the reason.
 */
function GolbatDbHealth() {
  const { data: app } = useAppInfo();
  const { data } = useQuery({ queryKey: ["golbat-db"], queryFn: endpoints.golbatDb, refetchInterval: 30_000, enabled: !!app?.golbatDb });
  if (!app?.golbatDb || !data?.configured) return null;
  const ok = !!data.ok;
  const state = dbState(data);
  return (
    // inline-flex: aligned by their boxes, not by a text baseline that differs between them.
    <HoverCard
      className="inline-flex"
      content={
        ok ? (
          <span>Golbat's database can be read · {data.ms} ms</span>
        ) : (
          <span className={DB_TEXT[state]}>
            No access to Golbat's database: {data.error}
            <span className="block text-muted-foreground">Click for the Help step that fixes it.</span>
          </span>
        )
      }
    >
      <DbPill state={state} />
    </HoverCard>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { title } = useAuth();
  const { data: app } = useAppInfo();
  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <div className="flex items-center gap-2 px-2 py-2">
        <img src="/nacli.png" alt="" width={32} height={32} className="size-8 shrink-0" />
        <span className="truncate font-semibold">{title}</span>
      </div>
      <nav className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {/* Golbat, Dragonite and Rotom sections only exist when config.toml has [golbat] / [stack.dragonite] / [stack.rotom]. */}
        {NAV.map((g) => ({ ...g, items: g.items.filter((it) => !it.when || (app && it.when(app))) }))
          .filter(
            (g) =>
              g.items.length > 0 &&
              (g.group !== "Dragonite" || app?.dragonite.length) &&
              (g.group !== "Rotom" || app?.instances.length),
          )
          .map((g, i) => (
          // A thin line between sections (none above the first, the Dashboard).
          <div key={g.group} className="relative flex flex-col gap-1 not-first:mt-1 not-first:pt-2">
            {/* Inset from the sides, a little stronger than the sidebar's own border. */}
            {i > 0 ? <span aria-hidden className="absolute inset-x-2 top-0 h-px bg-sidebar-foreground/15" /> : null}
            {g.group ? (
              <div className="flex h-8 items-center gap-1.5 px-2 text-xs font-medium text-sidebar-foreground/70">
                {g.group}
                {g.group === "Rotom" ? <InstanceHealth /> : null}
                {g.group === "Dragonite" ? (
                  <>
                    <DragoniteHealth />
                    <DragoniteDbHealth />
                  </>
                ) : null}
                {g.group === "Golbat" ? (
                  <>
                    <GolbatHealth />
                    <GolbatDbHealth />
                  </>
                ) : null}
              </div>
            ) : null}
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-sidebar-accent [&>svg]:size-4",
                    isActive && "bg-sidebar-accent font-medium",
                  )
                }
              >
                <item.icon />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  // As in Dragonite's admin: from md up the sidebar is a fixed panel that only
  // its button closes, and the choice is remembered; below md it is a drawer.
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_KEY);
      if (saved) return saved === "open";
    } catch {
      // Storage blocked: fall back to open.
    }
    return true;
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, open ? "open" : "closed");
    } catch {
      // Not remembered this time; nothing else depends on it.
    }
  }, [open]);
  const { title } = useAuth();
  const { data } = useAppInfo();
  const location = useLocation();
  const page = PAGE_TITLES[location.pathname] ?? "";


  const toggle = () => (window.innerWidth >= MD ? setOpen((o) => !o) : setMobileOpen(true));

  return (
    <div className="flex min-h-screen">
      {/* Floating panel: a bordered card inset 8px from the edges, sliding off-canvas when closed. */}
      <aside
        className={cn(
          "sticky top-0 hidden h-svh shrink-0 overflow-hidden transition-[width] duration-200 ease-linear md:block",
          open ? "w-64" : "w-0",
        )}
      >
        <div
          className={cn(
            "h-full w-64 p-2 transition-transform duration-200 ease-linear",
            !open && "-translate-x-full",
          )}
        >
          <div className="h-full rounded-lg border border-sidebar-border bg-sidebar shadow-sm">
            <Sidebar />
          </div>
        </div>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="animate-in absolute inset-y-0 left-0 w-72 border-r bg-sidebar">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 bg-background/80 px-4 backdrop-blur md:px-6">
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle menu">
            <PanelLeft />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold">
            {title}
            {page ? <span className="font-normal text-muted-foreground"> - {page}</span> : null}
          </h1>
          <UserMenu />
        </header>
        {/* Filled by FolderTabs while its tabs are scrolled out of view (TabsBar). No height of
            its own: the bar floats over the page, so showing it never moves the content (which
            would bring the tabs back into view and hide it again). */}
        <div id="tabs-bar" className="sticky top-16 z-30 h-0" />
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pt-4 pb-16 md:px-6">
          <AlertsBar />
          {children}
        </main>
        <Toaster />
      </div>
    </div>
  );
}
