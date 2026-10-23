import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CirclePlus, Copy, Lock, Plus, Power, PowerOff, Trash2, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { DragoniteInfo, ProxyEntry, ProxyImportResult, ProxyInstance } from "@shared/types";
import { type FolderTab, FolderPanel, FolderTabs } from "@/components/folder-tabs";
import { HeadStat, MiniProgress } from "@/components/head-stat";
import { type MenuItem, MenuButton } from "@/components/menu-button";
import { StackTag } from "@/components/stack-tag";
import { matches, SearchBox, Toggle, useSorted } from "@/components/table-tools";
import { toast } from "@/components/toaster";
import { Button, Card, HoverCard, Input, Label, Modal, Spinner, Table } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAppInfo, useInstanceColor } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";

const STACK_KEY = "nacli.proxies.stack";

type State = "good" | "failing" | "off" | "unknown";

/** A proxy's state in one stack: disabled, logging in fine, failing, or not tried yet. */
function stateOf(i: ProxyInstance): State {
  if (!i.enabled) return "off";
  if (!i.providers.length) return "unknown";
  return i.providers.some((p) => p.good) ? "good" : "failing";
}

/**
 * One state for a proxy over several stacks (the "All" tab): failing if it fails
 * anywhere, OK if it logs in somewhere, disabled if it is off everywhere.
 */
function overallState(list: ProxyInstance[]): State {
  const st = list.map(stateOf);
  if (st.includes("failing")) return "failing";
  if (st.includes("good")) return "good";
  if (st.every((x) => x === "off")) return "off";
  return "unknown";
}

const STATE: Record<State, { label: string; cls: string }> = {
  good: { label: "Login OK", cls: "bg-green-500" },
  failing: { label: "Login failed", cls: "bg-red-500" },
  off: { label: "Disabled", cls: "bg-muted-foreground/50" },
  unknown: { label: "Untested", cls: "bg-amber-500" },
};

const FILTERS = [
  { value: "all", label: "All" },
  { value: "failing", label: "Failing" },
  { value: "off", label: "Disabled" },
];

/** host:port, or what an empty URL means (Dragonite scanning without a proxy). */
const endpointLabel = (p: ProxyEntry) => p.endpoint || "Local interface (no proxy)";

export function DragoniteProxiesPage() {
  const { data: app } = useAppInfo();
  const color = useInstanceColor();
  const qc = useQueryClient();
  const stacks = (app?.dragonite ?? []).filter((d) => d.accounts);
  const [tab, setTabRaw] = useState<string>(() => {
    try {
      return localStorage.getItem(STACK_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const setTab = (id: string) => {
    setTabRaw(id);
    try {
      localStorage.setItem(STACK_KEY, id);
    } catch {
      // Not remembered; the choice still applies now.
    }
  };
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<{ p: ProxyEntry; i: ProxyInstance }>();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [copying, setCopying] = useState(false);
  const q = useQuery({ queryKey: ["dragonite-proxies"], queryFn: endpoints.dragoniteProxies, refetchInterval: 30_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ["dragonite-proxies"] });

  const current = stacks.some((d) => d.id === tab) ? tab : "";
  // One stack: nothing to copy to, and every row would name the same stack.
  const multi = stacks.length > 1;
  const stackColor = (id: string) => {
    const d = stacks.find((x) => x.id === id);
    return d?.rotom ? color(d.rotom) : "var(--muted-foreground)";
  };
  const stackName = (id: string) => stacks.find((x) => x.id === id)?.name ?? id;

  const rows = useMemo(() => {
    const all = q.data?.proxies ?? [];
    return all
      .map((p) => ({ p, here: current ? p.instances.filter((i) => i.stack === current) : p.instances }))
      .filter(({ p, here }) => here.length > 0 && matches(search, p.endpoint, ...p.instances.map((i) => i.name)))
      .filter(({ here }) =>
        filter === "all" ? true : filter === "failing" ? here.some((i) => stateOf(i) === "failing") : here.some((i) => stateOf(i) === "off"),
      )
      .map(({ p, here }) => ({
        p,
        here,
        names: [...new Set(here.map((i) => i.name))],
        lastOk: Math.max(0, ...here.flatMap((i) => i.providers.map((pr) => pr.lastSuccess ?? 0))),
      }));
  }, [q.data, current, search, filter]);
  const { sorted, header } = useSorted(
    rows,
    {
      proxy: (r) => r.p.endpoint,
      name: (r) => r.names[0],
      instances: (r) => r.p.instances.length,
      lastOk: (r) => r.lastOk,
    },
    "name",
  );

  if (!app) return <Spinner className="mx-auto mt-20" />;
  if (!stacks.length) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        No <code className="rounded bg-muted px-1">[stack.dragonite]</code> has a <code className="rounded bg-muted px-1">url</code> in config.toml.
      </Card>
    );
  }

  const sums = q.data?.stacks ?? [];
  const tabs: FolderTab[] = [
    { id: "", label: "All", compact: true },
    ...stacks.map((d) => {
      const sm = sums.find((x) => x.stack === d.id);
      return { id: d.id, label: d.name, color: d.rotom ? color(d.rotom) : undefined, summary: sm ? `${sm.good}/${sm.total} OK` : undefined };
    }),
  ];
  const shown = current ? sums.filter((x) => x.stack === current) : sums;
  // Counted per proxy, so one in several stacks counts once in "All".
  const states = (q.data?.proxies ?? [])
    .map((p) => (current ? p.instances.filter((i) => i.stack === current) : p.instances))
    .filter((here) => here.length)
    .map((here) => ({ state: overallState(here), enabled: here.some((i) => i.enabled) }));
  const total = states.length;
  const good = states.filter((x) => x.state === "good").length;
  const failing = states.filter((x) => x.state === "failing").length;
  const enabled = states.filter((x) => x.enabled).length;
  const errors = shown.filter((x) => x.error);

  /** Copies proxies to stacks and says how it went. */
  const copyTo = async (list: ProxyEntry[], to: string[]) => {
    setCopying(true);
    try {
      const r = await endpoints.copyProxies(list.map((p) => p.key), to);
      const created = r.results.reduce((n, x) => n + x.created, 0);
      const conflicts = r.results.filter((x) => x.conflicts?.length);
      const failed = r.results.filter((x) => x.error);
      const what = list.length === 1 ? endpointLabel(list[0]) : `${fmt.int(created)} ${created === 1 ? "proxy" : "proxies"}`;
      const notes = [
        ...conflicts.map((x) => `${stackName(x.stack)} already uses the name${x.conflicts!.length > 1 ? "s" : ""} ${x.conflicts!.slice(0, 5).map((n) => `“${n}”`).join(", ")}${x.conflicts!.length > 5 ? "…" : ""}`),
        ...failed.map((x) => `${stackName(x.stack)}: ${x.error}`),
      ];
      toast({
        tone: failed.length || conflicts.length ? (created ? "warning" : "error") : "success",
        text: created ? `${what} copied to ${to.map(stackName).join(", ")}${notes.length ? ` · ${notes.join(" · ")}` : ""}` : notes.join(" · ") || "Nothing to copy",
      });
      refresh();
      return created > 0;
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
      return false;
    } finally {
      setCopying(false);
    }
  };

  const pickable = sorted.filter((r) => r.p.endpoint);
  const allPicked = pickable.length > 0 && pickable.every((r) => selected.has(r.p.key));
  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const picked = (q.data?.proxies ?? []).filter((p) => selected.has(p.key));

  const menuFor = (p: ProxyEntry, here: ProxyInstance[]): MenuItem[] => {
    const missing = stacks.filter((d) => !p.instances.some((i) => i.stack === d.id));
    const items: MenuItem[] = [];
    for (const i of here) {
      if (i.id === undefined) continue;
      items.push({
        key: `t-${i.stack}`,
        label: `${i.enabled ? "Disable" : "Enable"}${multi ? ` on ${stackName(i.stack)}` : ""}`,
        hint: i.enabled ? "Dragonite stops using it" : "Dragonite starts using it again",
        icon: i.enabled ? PowerOff : Power,
        onSelect: async () => {
          try {
            await endpoints.setProxyEnabled(i.stack, i.id!, !i.enabled);
            toast({ text: `${endpointLabel(p)} ${i.enabled ? "disabled" : "enabled"}${multi ? ` on ${stackName(i.stack)}` : ""}` });
            refresh();
          } catch (e) {
            toast({ text: (e as Error).message, error: true });
          }
        },
      });
    }
    if (p.endpoint && multi) {
      items.push({
        key: "copy",
        label: missing.length ? `Copy to ${missing.map((d) => d.name).join(", ")}` : "Copy to other stacks",
        hint: missing.length ? `Adds it enabled, named “${p.instances.find((i) => i.id !== undefined)?.name ?? here[0]?.name ?? ""}”` : "Already in every stack",
        icon: Copy,
        disabled: !missing.length,
        onSelect: () => void copyTo([p], missing.map((d) => d.id)),
      });
    }
    for (const i of here) {
      if (i.id === undefined) continue;
      items.push({
        key: `rm-${i.stack}`,
        label: `Remove${multi ? ` from ${stackName(i.stack)}` : ""}`,
        hint: "Deletes it from that Dragonite",
        icon: Trash2,
        danger: true,
        onSelect: () => setRemoving({ p, i }),
      });
    }
    return items;
  };

  return (
    <div className="animate-in flex flex-col gap-3">
      <div className="flex flex-col">
        {stacks.length > 1 ? <FolderTabs label="Stack" tabs={tabs} value={current} onChange={setTab} /> : null}
        <FolderPanel color={tabs.find((t) => t.id === current)?.color} tabbed={stacks.length > 1}>
          {!q.data ? (
            <Spinner />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <HeadStat label="Proxies" value={fmt.int(total)}>
                <span className="text-[11px] text-muted-foreground">{fmt.int(enabled)} enabled</span>
              </HeadStat>
              <HeadStat label="Login OK" value={fmt.int(good)}>
                <MiniProgress value={good} max={total} color="#22c55e" />
              </HeadStat>
              <HeadStat label="Login failed" value={fmt.int(failing)} tone={failing ? "warn" : undefined}>
                <MiniProgress value={failing} max={total} color="#ef4444" />
              </HeadStat>
              <HeadStat label="Untested / off" value={fmt.int(total - good - failing)}>
                <span className="text-[11px] text-muted-foreground">disabled or no login yet</span>
              </HeadStat>
            </div>
          )}
        </FolderPanel>
      </div>
      {errors.length ? (
        <p className="text-sm text-red-300">{errors.map((x) => (multi ? `${stackName(x.stack)}: ${x.error}` : x.error)).join(" · ")}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <SearchBox value={search} onChange={setSearch} placeholder="Search proxy or name…" />
        <div className="flex flex-wrap items-center gap-2">
          <Toggle value={filter} onChange={setFilter} options={FILTERS} />
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus />
            New proxy
          </Button>
          <Button size="sm" onClick={() => setImporting(true)}>
            <Upload />
            Import
          </Button>
        </div>
      </div>

      {picked.length ? (
        <SelectionBar
          picked={picked}
          stacks={stacks}
          stackName={stackName}
          stackColor={stackColor}
          busy={copying}
          onCopy={async (to) => {
            if (await copyTo(picked.filter((p) => to.some((id) => !p.instances.some((i) => i.stack === id))), to)) setSelected(new Set());
          }}
          onClear={() => setSelected(new Set())}
        />
      ) : null}

      {q.error ? (
        <p className="text-sm text-red-300">{(q.error as Error).message}</p>
      ) : !q.data ? (
        <Spinner />
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={cn("w-8", !multi && "hidden")}>
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={allPicked}
                  ref={(el) => {
                    if (el) el.indeterminate = !allPicked && pickable.some((r) => selected.has(r.p.key));
                  }}
                  onChange={() =>
                    setSelected((s) => {
                      const n = new Set(s);
                      for (const r of pickable) {
                        if (allPicked) n.delete(r.p.key);
                        else n.add(r.p.key);
                      }
                      return n;
                    })
                  }
                  className="size-4 cursor-pointer align-middle accent-[var(--primary)]"
                />
              </th>
              {header("proxy", "Proxy")}
              {header("name", "Name")}
              {header("instances", multi ? "Instances" : "Status")}
              {header("lastOk", "Last OK login")}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={multi ? 6 : 5} className="py-8 text-center text-muted-foreground">
                  No proxies match.
                </td>
              </tr>
            ) : null}
            {sorted.map(({ p, here, names, lastOk: last }) => {
              return (
                <tr key={p.key} className={cn(selected.has(p.key) && "bg-accent/40")}>
                  <td className={cn(!multi && "hidden")}>
                    {p.endpoint ? (
                      <input
                        type="checkbox"
                        aria-label={`Select ${p.endpoint}`}
                        checked={selected.has(p.key)}
                        onChange={() => toggle(p.key)}
                        className="size-4 cursor-pointer align-middle accent-[var(--primary)]"
                      />
                    ) : null}
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap">
                      {p.auth ? (
                        <HoverCard content={<span>With username and password (not shown)</span>}>
                          <Lock className="size-3.5 text-muted-foreground" />
                        </HoverCard>
                      ) : null}
                      {endpointLabel(p)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">
                    {names[0]}
                    {names.length > 1 ? <span className="text-xs text-muted-foreground"> +{names.length - 1}</span> : null}
                  </td>
                  <td>
                    {/* Where it is: one chip per stack, its dot in that stack's state. */}
                    <div className="flex flex-wrap gap-1.5">
                      {p.instances.map((i) => {
                        const st = stateOf(i);
                        return (
                          <HoverCard
                            key={i.stack}
                            content={
                              <div className="flex flex-col gap-0.5">
                                <span className="font-medium">
                                  {stackName(i.stack)} · {STATE[st].label}
                                </span>
                                {i.providers.map((pr) => (
                                  <span key={pr.provider} className="text-muted-foreground">
                                    {pr.provider.toUpperCase()}: {pr.lastStatus}
                                    {pr.lastSuccess ? ` · last OK ${fmt.ago(pr.lastSuccess * 1000)}` : ""}
                                  </span>
                                ))}
                                {i.id === undefined ? <span className="text-muted-foreground">Defined in its configuration</span> : null}
                              </div>
                            }
                          >
                            <span
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap",
                                current && i.stack !== current && "opacity-50",
                              )}
                            >
                              {multi ? (
                                <>
                                  <span className="size-2 rounded-full" style={{ background: stackColor(i.stack) }} />
                                  {stackName(i.stack)}
                                  <span className={cn("size-1.5 rounded-full", STATE[st].cls)} />
                                </>
                              ) : (
                                <>
                                  <span className={cn("size-2 rounded-full", STATE[st].cls)} />
                                  {STATE[st].label}
                                </>
                              )}
                            </span>
                          </HoverCard>
                        );
                      })}
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-muted-foreground tabular-nums">{last ? fmt.ago(last * 1000) : "—"}</td>
                  <td className="text-right">
                    <MenuButton kind="Proxy" subject={endpointLabel(p)} items={menuFor(p, here)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {creating ? <CreateModal stacks={stacks} proxies={q.data?.proxies ?? []} onClose={() => setCreating(false)} onDone={refresh} /> : null}
      {importing ? <ImportModal stacks={stacks} onClose={() => setImporting(false)} onDone={refresh} /> : null}
      {removing ? (
        <Modal
          open
          onClose={() => setRemoving(undefined)}
          title={`Remove ${endpointLabel(removing.p)}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRemoving(undefined)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  const { p, i } = removing;
                  setRemoving(undefined);
                  try {
                    await endpoints.deleteProxy(i.stack, i.id!);
                    toast({ text: `${endpointLabel(p)} removed${multi ? ` from ${stackName(i.stack)}` : ""}` });
                    refresh();
                  } catch (e) {
                    toast({ text: (e as Error).message, error: true });
                  }
                }}
              >
                Remove
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            “{removing.i.name}” will be deleted from {stackName(removing.i.stack)} and Dragonite will stop using it.
            {removing.p.instances.length > 1 ? " It stays in the other stacks." : ""}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

/** Local count of valid lines, for the preview (the server parses them again). */
function countLines(text: string) {
  let ok = 0;
  let bad = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^https?:\/\//i, "");
    if (!line || line.startsWith("#")) continue;
    if (/^[^:@\s]+:[^@\s]+@[^:@\s]+:\d{1,5}$/.test(line) || /^[^:@\s]+:\d{1,5}(:[^:\s]+:\S+)?$/.test(line)) ok++;
    else bad++;
  }
  return { ok, bad };
}

function ImportModal({ stacks, onClose, onDone }: { stacks: DragoniteInfo[]; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [targets, setTargets] = useState<string[]>(stacks.map((d) => d.id));
  const multi = stacks.length > 1;
  const [prefix, setPrefix] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [skipExisting, setSkipExisting] = useState(true);
  const [reload, setReload] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [results, setResults] = useState<ProxyImportResult[]>();
  const count = countLines(text);
  const name = (id: string) => stacks.find((d) => d.id === id)?.name ?? id;

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await endpoints.importProxies({ text, stacks: targets, prefix, enabled, skipExisting, reload });
      setResults(r.results);
      const created = r.results.reduce((n, x) => n + x.created, 0);
      const failed = r.results.filter((x) => x.error);
      toast({
        tone: failed.length ? (created ? "warning" : "error") : "success",
        text: `${fmt.int(created)} ${created === 1 ? "proxy" : "proxies"} imported${failed.length ? ` · failed${multi ? ` on ${failed.map((x) => name(x.stack)).join(", ")}` : ""}` : ""}`,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Import proxies"
      footer={
        results ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <span className="mr-auto text-xs text-muted-foreground tabular-nums">
              {count.ok ? `${count.ok} valid` : "Paste one proxy per line"}
              {count.bad ? <span className="text-amber-400"> · {count.bad} invalid {count.bad === 1 ? "line" : "lines"}</span> : null}
            </span>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={run} disabled={!count.ok || !targets.length || busy}>
              {busy ? <Spinner className="size-4" /> : <Upload />}
              {multi ? `Import into ${targets.length === stacks.length ? "all" : targets.map(name).join(", ") || "…"}` : "Import"}
            </Button>
          </>
        )
      }
    >
      {results ? (
        <div className="flex flex-col gap-2 text-sm">
          {results.map((r) => (
            <div key={r.stack} className="flex items-center gap-2 rounded-lg border px-3 py-2">
              {r.error ? <X className="size-4 text-red-400" /> : <Check className="size-4 text-green-400" />}
              <StackTag id={r.stack} className="font-medium" />
              <span className="text-muted-foreground">
                {r.error ? r.error : `${r.created} added · ${r.skipped} already existed${r.reloaded ? " · proxies reloaded" : ""}`}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <label className="flex flex-col gap-1.5">
            <Label>Proxies, one per line</Label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder={"host:port\nhost:port:username:password\nusername:password@host:port"}
              className="w-full rounded-md border bg-background/40 px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          {multi ? (
            <div className="flex flex-col gap-1.5">
              <Label>Import into</Label>
              <StackPicker stacks={stacks} value={targets} onChange={setTargets} />
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <Label>Name prefix (optional)</Label>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={20} placeholder="e.g. iproyal-" />
              <span className="text-[11px] text-muted-foreground">Numbered on from the existing ones: {prefix}001, {prefix}002…</span>
            </label>
            <div className="flex flex-col gap-2 pt-5">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 accent-[var(--primary)]" />
                Import them enabled
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} className="size-4 accent-[var(--primary)]" />
                Skip those each stack already has
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={reload} onChange={(e) => setReload(e.target.checked)} className="size-4 accent-[var(--primary)]" />
                Reload proxies in Dragonite when done
              </label>
            </div>
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <CirclePlus className="mt-0.5 size-3.5 shrink-0" />
            Passwords only travel to the dashboard server and from there to each Dragonite; they are never shown in the list.
          </p>
          {error ? <p className="text-red-300">{error}</p> : null}
        </div>
      )}
    </Modal>
  );
}

/** Toggles for the stacks to act on; all selected by default where it is used. */
function StackPicker({ stacks, value, onChange, note }: { stacks: DragoniteInfo[]; value: string[]; onChange: (v: string[]) => void; note?: (id: string) => string | undefined }) {
  const color = useInstanceColor();
  return (
    <div className="flex flex-wrap gap-2">
      {stacks.map((d) => {
        const on = value.includes(d.id);
        const extra = note?.(d.id);
        return (
          <button
            key={d.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== d.id) : [...value, d.id])}
            className={cn("inline-flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-accent", on && "border-primary bg-accent")}
          >
            <span className={cn("grid size-4 place-items-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
              {on ? <Check className="size-3" strokeWidth={3} /> : null}
            </span>
            <span className="size-2.5 rounded-full" style={{ background: d.rotom ? color(d.rotom) : "var(--muted-foreground)" }} />
            {d.name}
            {extra ? <span className="text-[11px] text-amber-400">{extra}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

const ADDRESS = /^[^:@\s]+:\d{1,5}$/;

/** One proxy with its own name, in one or several stacks (the admin's "Create"). */
function CreateModal({ stacks, proxies, onClose, onDone }: { stacks: DragoniteInfo[]; proxies: ProxyEntry[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [targets, setTargets] = useState<string[]>(stacks.map((d) => d.id));
  const [enabled, setEnabled] = useState(true);
  const [reload, setReload] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [results, setResults] = useState<ProxyImportResult[]>();
  const stackName = (id: string) => stacks.find((d) => d.id === id)?.name ?? id;
  // One stack: nothing to pick, and naming it would only repeat itself.
  const multi = stacks.length > 1;

  const addressOk = ADDRESS.test(address.trim().replace(/^https?:\/\//i, ""));
  const authOk = !user.trim() === !password && !/[\s:@]/.test(user.trim());
  // Where the name is already used, or this same proxy is already there.
  const note = (id: string) => {
    const n = name.trim();
    const endpoint = address.trim().replace(/^https?:\/\//i, "");
    for (const p of proxies) {
      for (const i of p.instances) {
        if (i.stack !== id) continue;
        if (p.endpoint === endpoint && (p.auth ? !!user.trim() : !user.trim())) return "already has it";
        if (n && i.name === n) return "name taken";
      }
    }
    return undefined;
  };
  const clashes = targets.filter((id) => note(id) === "name taken");
  const canRun = !!name.trim() && addressOk && authOk && targets.length > 0 && !clashes.length && !busy;

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await endpoints.createProxy({ name: name.trim(), address: address.trim(), user: user.trim(), password, stacks: targets, enabled, reload });
      setResults(r.results);
      const created = r.results.filter((x) => x.created);
      const failed = r.results.filter((x) => x.error);
      toast({
        tone: failed.length ? (created.length ? "warning" : "error") : created.length ? "success" : "info",
        text: created.length
          ? `“${name.trim()}” created${multi ? ` on ${created.map((x) => stackName(x.stack)).join(", ")}` : ""}${failed.length ? ` · failed on ${failed.map((x) => stackName(x.stack)).join(", ")}` : ""}`
          : failed.length
            ? failed.map((x) => (multi ? `${stackName(x.stack)}: ${x.error}` : x.error)).join(" · ")
            : "Already in those stacks",
      });
      onDone();
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
      title="New proxy"
      footer={
        results ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={run} disabled={!canRun}>
              {busy ? <Spinner className="size-4" /> : <Plus />}
              {multi ? `Create in ${targets.length === stacks.length ? "all" : targets.map(stackName).join(", ") || "…"}` : "Create"}
            </Button>
          </>
        )
      }
    >
      {results ? (
        <div className="flex flex-col gap-2 text-sm">
          {results.map((r) => (
            <div key={r.stack} className="flex items-center gap-2 rounded-lg border px-3 py-2">
              {r.error ? <X className="size-4 text-red-400" /> : <Check className="size-4 text-green-400" />}
              <StackTag id={r.stack} className="font-medium" />
              <span className="text-muted-foreground">{r.error ? r.error : r.created ? `created${r.reloaded ? " · proxies reloaded" : ""}` : "already had it"}</span>
            </div>
          ))}
        </div>
      ) : (
        <form
          className="flex flex-col gap-4 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (canRun) run();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="e.g. 037" autoFocus />
            </label>
            <label className="flex flex-col gap-1.5">
              <Label>Address</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="host:port" spellCheck={false} className="font-mono" />
              {address.trim() && !addressOk ? <span className="text-[11px] text-amber-400">Must be host:port</span> : null}
            </label>
            <label className="flex flex-col gap-1.5">
              <Label>Username (optional)</Label>
              <Input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" spellCheck={false} />
            </label>
            <label className="flex flex-col gap-1.5">
              <Label>Password (optional)</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </label>
          </div>
          {!authOk ? <p className="-mt-2 text-[11px] text-amber-400">Username and password go together; the username cannot contain spaces, “:” or “@”.</p> : null}
          {multi ? (
            <div className="flex flex-col gap-1.5">
              <Label>Create in</Label>
              <StackPicker stacks={stacks} value={targets} onChange={setTargets} note={note} />
              {clashes.length ? (
                <span className="text-[11px] text-amber-400">
                  The name “{name.trim()}” already exists on {clashes.map(stackName).join(", ")}: change it or deselect that stack.
                </span>
              ) : null}
            </div>
          ) : clashes.length ? (
            <span className="text-[11px] text-amber-400">The name “{name.trim()}” already exists: change it.</span>
          ) : null}
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 accent-[var(--primary)]" />
              Create it enabled
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={reload} onChange={(e) => setReload(e.target.checked)} className="size-4 accent-[var(--primary)]" />
              Reload proxies in Dragonite when done
            </label>
          </div>
          {error ? <p className="text-red-300">{error}</p> : null}
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}

/** What can be done with the ticked proxies: copy them to a stack that lacks them. */
function SelectionBar({
  picked,
  stacks,
  stackName,
  stackColor,
  busy,
  onCopy,
  onClear,
}: {
  picked: ProxyEntry[];
  stacks: DragoniteInfo[];
  stackName: (id: string) => string;
  stackColor: (id: string) => string;
  busy: boolean;
  onCopy: (to: string[]) => void;
  onClear: () => void;
}) {
  const lacking = (id: string) => picked.filter((p) => !p.instances.some((i) => i.stack === id)).length;
  const anyLacking = stacks.filter((d) => lacking(d.id) > 0);
  return (
    <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-popover/95 px-3 py-2 text-sm shadow-lg backdrop-blur">
      <span className="font-medium tabular-nums">
        {fmt.int(picked.length)} selected
      </span>
      <span className="mr-auto text-xs text-muted-foreground">Copies keep their names; a name already in use there is skipped.</span>
      {busy ? <Spinner className="size-4" /> : null}
      {stacks.map((d) => {
        const n = lacking(d.id);
        return (
          <Button key={d.id} size="sm" variant="outline" disabled={busy || !n} onClick={() => onCopy([d.id])} title={n ? undefined : `All of them are already in ${d.name}`}>
            <Copy />
            <span className="size-2 rounded-full" style={{ background: stackColor(d.id) }} />
            Copy {n ? fmt.int(n) : ""} to {stackName(d.id)}
          </Button>
        );
      })}
      {anyLacking.length > 1 ? (
        <Button size="sm" disabled={busy} onClick={() => onCopy(anyLacking.map((d) => d.id))}>
          <Copy />
          Copy to all
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={onClear} aria-label="Clear selection">
        <X />
      </Button>
    </div>
  );
}
