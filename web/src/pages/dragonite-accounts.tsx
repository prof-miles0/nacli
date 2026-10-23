import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, KeyRound, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { type AccountCounts, type AccountLevelCounts, type AccountState, accountState, type DragoniteAccount, type DragoniteInfo } from "@shared/types";
import { AddAccountsModal } from "@/components/account-forms";
import { FilterMenu } from "@/components/filter-menu";
import { StackTag } from "@/components/stack-tag";
import { SearchBox } from "@/components/table-tools";
import { AccentCard, Badge, Button, Card, HoverCard, Label, Spinner, StackBar, Table } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAppInfo, useInstanceColor } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";

/** Dragonite's account states, in the admin's order; they add up to the total. */
export const STATUSES: { key: keyof Omit<AccountCounts, "total">; label: string; color: string; hint: string }[] = [
  { key: "good", label: "Available", color: "#22c55e", hint: "ready to use" },
  { key: "in_use", label: "In use", color: "#8b5cf6", hint: "assigned to a worker now" },
  { key: "cooldown", label: "Cooldown", color: "#3b82f6", hint: "waiting out their rest time" },
  { key: "disabled", label: "Disabled", color: "#71717a", hint: "temporarily disabled after failures" },
  { key: "provider_disabled", label: "Provider off", color: "#f97316", hint: "their login provider is disabled" },
  { key: "warned", label: "Warned", color: "#f59e0b", hint: "warned by Niantic" },
  { key: "suspended", label: "Suspended", color: "#eab308", hint: "suspended by Niantic" },
  { key: "banned", label: "Banned", color: "#ef4444", hint: "banned" },
  { key: "auth_banned", label: "Login ban", color: "#e11d48", hint: "the provider rejects their login" },
  { key: "invalid", label: "Invalid", color: "#ec4899", hint: "invalid credentials" },
  { key: "missing_token", label: "No token", color: "#a1a1aa", hint: "no access token stored" },
  { key: "zero_last_released", label: "Never released", color: "#06b6d4", hint: "never returned after use" },
];

export const segments = (c: AccountCounts) => STATUSES.map((s) => ({ label: s.label, value: c[s.key], color: s.color }));

/** Admin's level bands; each can unfold into its single levels. */
const BANDS = [
  { label: "0", min: 0, max: 0 },
  { label: "1 – 29", min: 1, max: 29 },
  { label: "30 – 39", min: 30, max: 39 },
  { label: "40 +", min: 40, max: 99 },
];

/** Accounts per stack over several levels. */
function splitOf(rows: AccountLevelCounts[]) {
  const out: Record<string, number> = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.byStack ?? {})) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** The stacks and their colours, as a small legend. */
function StackLegend() {
  const { stacks, colorOf } = useStackColors();
  if (stacks.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {stacks.map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: colorOf(s.id) }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

function sum(rows: AccountLevelCounts[]): AccountCounts {
  const out = { total: 0 } as AccountCounts;
  for (const s of STATUSES) out[s.key] = 0;
  for (const r of rows) {
    out.total += r.total;
    for (const s of STATUSES) out[s.key] += r[s.key];
  }
  return out;
}

/** Each stack's colour: the colour of the Rotom instance its Dragonite feeds. */
function useStackColors() {
  const { data: app } = useAppInfo();
  const color = useInstanceColor();
  const stacks = (app?.dragonite ?? []).filter((d) => d.accounts);
  return {
    stacks,
    colorOf: (id: string) => {
      const d = stacks.find((x) => x.id === id);
      return d?.rotom ? color(d.rotom) : "var(--muted-foreground)";
    },
    nameOf: (id: string) => stacks.find((x) => x.id === id)?.name ?? id,
  };
}

/** How a level's accounts split across the stacks, in their colours. */
function StackSplit({ byStack }: { byStack?: Record<string, number> }) {
  const { stacks, colorOf } = useStackColors();
  const total = Object.values(byStack ?? {}).reduce((a, b) => a + b, 0);
  if (!total) return <span />;
  const parts = stacks.map((s) => ({ s, n: byStack?.[s.id] ?? 0 })).filter((x) => x.n > 0);
  return (
    <HoverCard
      content={
        <div className="flex flex-col gap-0.5">
          {parts.map(({ s, n }) => (
            <span key={s.id} className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: colorOf(s.id) }} />
              <span className="text-muted-foreground">{s.name}</span>
              <span className="ml-auto font-semibold tabular-nums">{fmt.int(n)}</span>
            </span>
          ))}
        </div>
      }
    >
      <div className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full bg-muted">
        {parts.map(({ s, n }) => (
          <div key={s.id} className="h-full" style={{ width: `${(n / total) * 100}%`, background: colorOf(s.id) }} />
        ))}
      </div>
    </HoverCard>
  );
}

/** Thin stacked bar for a table row: statuses in order, width ∝ count. */
export function MiniBar({ counts }: { counts: AccountCounts }) {
  return (
    <HoverCard
      content={
        <div className="flex flex-col gap-0.5">
          {STATUSES.filter((s) => counts[s.key]).map((s) => (
            <span key={s.key} className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="ml-auto font-semibold tabular-nums">{fmt.int(counts[s.key])}</span>
            </span>
          ))}
        </div>
      }
    >
      <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-muted">
        {STATUSES.filter((s) => counts[s.key] > 0).map((s) => (
          <div
            key={s.key}
            className="h-full"
            style={{ width: `${(counts[s.key] / Math.max(counts.total, 1)) * 100}%`, background: s.color }}
          />
        ))}
      </div>
    </HoverCard>
  );
}

/** Headline card per Dragonite: total and the status breakdown. */
function InstanceCard({ d, color }: { d: DragoniteInfo; color: string }) {
  const stats = useQuery({
    queryKey: ["account-stats", d.id],
    queryFn: () => endpoints.accountStats(d.id),
    enabled: d.accounts,
    refetchInterval: 15_000,
  });
  return (
    <AccentCard accent={color} hover={false} className="gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Label>Accounts</Label>
          {/* The stack's name only tells several apart; with one, the total is the headline. */}
          <StackTag id={d.id} className="text-lg font-bold" />
        </div>
        {stats.data ? (
          <div className="text-right">
            <Label>Total</Label>
            <div className="text-3xl leading-none font-bold tabular-nums">{fmt.int(stats.data.total)}</div>
          </div>
        ) : null}
      </div>
      {!d.accounts ? (
        <p className="text-sm text-muted-foreground">
          No API configured. Add <code className="rounded bg-muted px-1">url</code> to its{" "}
          <code className="rounded bg-muted px-1">[stack.dragonite]</code> in config.toml.
        </p>
      ) : stats.error ? (
        <p className="text-sm text-red-300">{(stats.error as Error).message}</p>
      ) : !stats.data ? (
        <Spinner />
      ) : (
        <StackBar segments={segments(stats.data)} />
      )}
    </AccentCard>
  );
}

/** Accounts by level, every stack together; the narrow bar splits each band by stack. */
function LevelCard() {
  const [open, setOpen] = useState<string[]>([]);
  // One stack: the split-by-stack bar would only repeat the total.
  const multi = useStackColors().stacks.length > 1;
  const cols = multi ? "grid-cols-[1.25rem_4.5rem_1fr_3.5rem_3.5rem]" : "grid-cols-[1.25rem_4.5rem_1fr_3.5rem]";
  const levels = useQuery({
    queryKey: ["account-levels-all"],
    queryFn: endpoints.allAccountLevels,
    refetchInterval: 15_000,
  });
  return (
    <Card className="gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{multi ? "By level · all stacks" : "By level"}</div>
        <StackLegend />
      </div>
      {levels.error ? (
        <p className="text-sm text-red-300">{(levels.error as Error).message}</p>
      ) : !levels.data ? (
        <Spinner />
      ) : (
        <div className="flex flex-col">
          {BANDS.map((b) => {
            const rows = levels.data.filter((l) => l.level >= b.min && l.level <= b.max).sort((x, y) => x.level - y.level);
            const total = sum(rows);
            const isOpen = open.includes(b.label);
            const canOpen = rows.length > 1;
            return (
              <div key={b.label} className="border-b last:border-b-0">
                <button
                  type="button"
                  disabled={!canOpen}
                  onClick={() => setOpen((o) => (isOpen ? o.filter((x) => x !== b.label) : [...o, b.label]))}
                  className={cn("grid w-full items-center gap-3 py-2.5 text-left text-sm enabled:hover:bg-accent/30", cols)}
                >
                  {canOpen ? (
                    <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", !isOpen && "-rotate-90")} />
                  ) : (
                    <span />
                  )}
                  <span className="font-medium">{b.label}</span>
                  <MiniBar counts={total} />
                  {multi ? <StackSplit byStack={splitOf(rows)} /> : null}
                  <span className="text-right font-semibold tabular-nums">{fmt.int(total.total)}</span>
                </button>
                {isOpen
                  ? rows.map((r) => (
                      <div
                        key={r.level}
                        className={cn("grid items-center gap-3 py-1.5 text-xs text-muted-foreground", cols)}
                      >
                        <span />
                        <span className="pl-3">Level {r.level}</span>
                        <MiniBar counts={r} />
                        {multi ? <StackSplit byStack={r.byStack} /> : null}
                        <span className="text-right tabular-nums">{fmt.int(r.total)}</span>
                      </div>
                    ))
                  : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** Each account state's name and badge tone, worst first. */
const STATES: Record<AccountState, { label: string; tone: "good" | "warn" | "bad" | "info" | "violet" | "neutral" }> = {
  banned: { label: "Banned", tone: "bad" },
  auth_banned: { label: "Login ban", tone: "bad" },
  invalid: { label: "Invalid", tone: "bad" },
  suspended: { label: "Suspended", tone: "warn" },
  warned: { label: "Warned", tone: "warn" },
  disabled: { label: "Disabled", tone: "neutral" },
  in_use: { label: "In use", tone: "violet" },
  available: { label: "Available", tone: "good" },
};

/** The state that best describes an account, worst first. */
const accountStatus = (a: DragoniteAccount) => STATES[accountState(a)];

/** Each state's colour, from the breakdown above (Available is its "good"). */
const stateColor = (k: AccountState) => STATUSES.find((x) => x.key === (k === "available" ? "good" : k))?.color ?? "var(--muted-foreground)";

/** Pick one account state: only those some account is in, each with its colour, count and share. */
function StateFilter({ value, counts, onChange }: { value: string; counts?: Partial<Record<AccountState, number>>; onChange: (v: string) => void }) {
  const shown = (Object.keys(STATES) as AccountState[]).filter((k) => counts?.[k] || k === value);
  // A single state leaves nothing to filter.
  if (shown.length < 2 && !value) return null;
  return (
    <FilterMenu
      label="Account state"
      allLabel="All states"
      value={value}
      onChange={onChange}
      options={shown.map((k) => ({ value: k, label: STATES[k].label, color: stateColor(k), count: counts?.[k] ?? 0 }))}
    />
  );
}

const SORTS = [
  { key: "username", label: "Username" },
  { key: "level", label: "Level" },
  { key: "provider", label: "Provider" },
  { key: "last_selected", label: "Last used" },
  { key: "last_released", label: "Released" },
] as const;

const ts = (s: number | null) => (s && s > 1 ? s * 1000 : undefined);

/**
 * Every stack's accounts in one list (the dot says whose each one is), either
 * those a worker is using now or the rest.
 */
function AccountsTable({ inUse, title }: { inUse: boolean; title: string }) {
  const { stacks, colorOf, nameOf } = useStackColors();
  // One stack: every row would carry the same dot.
  const multi = stacks.length > 1;
  const [page, setPage] = useState(0);
  // In use: most recently picked first; the rest: most recently returned first.
  const [sortBy, setSortBy] = useState<string>(inUse ? "last_selected" : "last_released");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  // One state only ("" = all); the choices come with the server's counts.
  const [status, setStatus] = useState("");
  // Search as you type, but only ask Dragonite once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const perPage = 10;
  const list = useQuery({
    queryKey: ["accounts-all", inUse, page, sortBy, order, q, status],
    queryFn: () => endpoints.allAccounts({ page, perPage, sortBy, order, q, inUse, status }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });

  const sortHeader = (key: string, label: string, className?: string) => (
    <th className={className} aria-sort={sortBy === key ? (order === "desc" ? "descending" : "ascending") : undefined}>
      <button
        type="button"
        className={cn("inline-flex items-center gap-1 uppercase hover:text-foreground", sortBy === key && "text-foreground")}
        onClick={() => {
          if (sortBy === key) setOrder((o) => (o === "asc" ? "desc" : "asc"));
          else {
            setSortBy(key);
            setOrder(key === "username" || key === "provider" ? "asc" : "desc");
          }
          setPage(0);
        }}
      >
        {label}
        {sortBy === key ? (
          order === "desc" ? (
            <ArrowDown className="size-3" />
          ) : (
            <ArrowUp className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-40" />
        )}
      </button>
    </th>
  );

  const data = list.data;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-baseline gap-2 text-lg font-bold">
          {title}
          {data ? <span className="text-sm font-normal text-muted-foreground tabular-nums">{fmt.int(data.total)}</span> : null}
        </h2>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          {/* The search, then the state at its right; on phones the search fills the row. */}
          <div className="min-w-0 flex-1 sm:flex-none">
            <SearchBox value={search} onChange={setSearch} placeholder="Search username…" />
          </div>
          <StateFilter value={status} counts={data?.states} onChange={(v) => (setStatus(v), setPage(0))} />
        </div>
      </div>
      {list.error ? (
        <p className="text-sm text-red-300">{(list.error as Error).message}</p>
      ) : !data ? (
        <Spinner />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                {/* The stack column: colour dots only, no heading. */}
                {multi ? <th className="w-8" aria-label="Stack" /> : null}
                {sortHeader("username", SORTS[0].label)}
                {sortHeader("level", SORTS[1].label)}
                {sortHeader("provider", SORTS[2].label)}
                <th>Status</th>
                <th>Token</th>
                {sortHeader("last_selected", SORTS[3].label)}
                {sortHeader("last_released", SORTS[4].label)}
              </tr>
            </thead>
            <tbody className={cn(list.isPlaceholderData && "opacity-60")}>
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={multi ? 8 : 7} className="py-8 text-center text-muted-foreground">
                    No matching accounts.
                  </td>
                </tr>
              ) : null}
              {data.rows.map((a) => {
                const st = accountStatus(a);
                return (
                  <tr key={`${a.stack}:${a.username}`}>
                    {multi ? (
                      <td className="w-8">
                        {/* Just the stack's colour; its name on hover. */}
                        <HoverCard content={<span>{nameOf(a.stack ?? "")}</span>}>
                          <span
                            className="block size-2.5 rounded-full"
                            style={{ background: colorOf(a.stack ?? "") }}
                            aria-label={nameOf(a.stack ?? "")}
                          />
                        </HoverCard>
                      </td>
                    ) : null}
                    <td className="font-mono text-xs">{a.username}</td>
                    <td className="tabular-nums">{a.level}</td>
                    <td className="uppercase">{a.provider}</td>
                    <td>
                      <HoverCard
                        content={
                          <div className="flex flex-col gap-0.5">
                            {a.last_banned ? <span>Banned {fmt.ago(ts(a.last_banned))}</span> : null}
                            {a.last_suspended ? <span>Suspended {fmt.ago(ts(a.last_suspended))}</span> : null}
                            {a.last_disabled ? <span>Disabled {fmt.ago(ts(a.last_disabled))}</span> : null}
                            {a.consecutive_disabled ? <span>{a.consecutive_disabled} {a.consecutive_disabled === 1 ? "disable" : "disables"} in a row</span> : null}
                            {!a.last_banned && !a.last_suspended && !a.last_disabled && !a.consecutive_disabled ? (
                              <span className="text-muted-foreground">No incidents recorded</span>
                            ) : null}
                          </div>
                        }
                      >
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </HoverCard>
                    </td>
                    <td>
                      <HoverCard
                        content={
                          <span>
                            {a.valid_refresh_token ? "Valid token" : "Token expired or missing"}
                            {a.last_refreshed ? ` · refreshed ${fmt.ago(ts(a.last_refreshed))}` : ""}
                          </span>
                        }
                      >
                        <KeyRound className={cn("size-4", a.valid_refresh_token ? "text-green-400" : "text-muted-foreground/50")} />
                      </HoverCard>
                    </td>
                    <td className="whitespace-nowrap text-muted-foreground tabular-nums">{fmt.ago(ts(a.last_selected))}</td>
                    <td className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {a.in_use ? <span className="text-violet-300">in use</span> : fmt.ago(ts(a.last_released))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span className="tabular-nums">
              {data.total
                ? `${fmt.int(page * perPage + 1)}–${fmt.int(Math.min((page + 1) * perPage, data.total))} of ${fmt.int(data.total)}`
                : "0 accounts"}
            </span>
            <div className="flex items-center gap-2">
              <span className="tabular-nums">
                Page {page + 1} of {Math.max(1, data.pages)}
              </span>
              <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={page + 1 >= data.pages}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** Accounts found in more than one stack: each should be in one only. */
function DuplicatesCard({ stacks }: { stacks: DragoniteInfo[] }) {
  const color = useInstanceColor();
  const dup = useQuery({ queryKey: ["account-duplicates"], queryFn: endpoints.accountDuplicates, refetchInterval: 300_000 });
  const [open, setOpen] = useState(false);
  const list = dup.data ?? [];
  if (!list.length) return null;
  const stack = (id: string) => stacks.find((d) => d.id === id);
  const shown = open ? list : list.slice(0, 8);
  return (
    <div role="alert" className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-400" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <div className="font-semibold text-amber-300">
            {fmt.int(list.length)} account{list.length === 1 ? " is" : "s are"} in more than one stack
          </div>
          <p className="text-muted-foreground">An account belongs to a single stack; two stacks using it at once get in each other's way. Delete it from all but one.</p>
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {shown.map((o) => (
            <li key={o.username} className="inline-flex items-center gap-1.5 rounded-md border bg-background/40 px-2 py-0.5 font-mono text-xs">
              {o.username}
              {o.stacks.map((id) => {
                const d = stack(id);
                return (
                  <span
                    key={id}
                    title={d?.name ?? id}
                    className="size-2 rounded-full"
                    style={{ background: d?.rotom ? color(d.rotom) : "var(--muted-foreground)" }}
                  />
                );
              })}
            </li>
          ))}
        </ul>
        {list.length > shown.length || open ? (
          <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            {open ? "Show less" : `Show ${fmt.int(list.length - shown.length)} more`}
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function DragoniteAccountsPage() {
  const { data: app } = useAppInfo();
  const color = useInstanceColor();
  const dragonites = app?.dragonite ?? [];
  const withApi = dragonites.filter((d) => d.accounts);
  const [adding, setAdding] = useState(false);

  if (!app) return <Spinner className="mx-auto mt-20" />;

  return (
    <div className="animate-in flex flex-col gap-6">
      {withApi.length ? (
        <div className="-mb-2 flex flex-wrap justify-end gap-2">
          <Button onClick={() => setAdding(true)}>
            <Plus />
            Add
          </Button>
        </div>
      ) : null}
      {adding ? <AddAccountsModal stacks={withApi} onClose={() => setAdding(false)} /> : null}
      {withApi.length > 1 ? <DuplicatesCard stacks={withApi} /> : null}
      <div className={cn("grid gap-4", dragonites.length > 1 && "lg:grid-cols-2")}>
        {dragonites.map((d) => (
          <InstanceCard key={d.id} d={d} color={d.rotom ? color(d.rotom) : "var(--muted-foreground)"} />
        ))}
      </div>

      {withApi.length ? (
        <>
          <LevelCard />
          <AccountsTable inUse title="In use" />
          <AccountsTable inUse={false} title="Available" />
        </>
      ) : null}
    </div>
  );
}
