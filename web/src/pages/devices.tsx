import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import type { Device, Tagged } from "@shared/types";
import { ActionsMenu, DEVICE_ACTIONS, useNotify } from "@/components/actions";
import { FilterMenu } from "@/components/filter-menu";
import { matches, SearchBox, useSorted } from "@/components/table-tools";
import { Badge, Dot, Empty, HoverCard, Spinner, Table } from "@/components/ui";
import { StatusDot, type StatusTone } from "@/components/status-dot";
import { splitWorkerId, WorkerName } from "./workers";
import { useInstances, useInstanceColor, useStatus } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";

export function deviceState(d: Device): { label: string; tone: StatusTone } {
  if (!d.is_connected) return { label: "Offline", tone: "bad" };
  if (!d.enabled) return { label: "Disabled", tone: "warn" };
  if (d.is_in_use) return { label: "In use", tone: "good" };
  return { label: "Idle", tone: "info" };
}

/** The device filter; Disabled overlaps the others (a disabled device can still be online). */
const STATES: { value: string; label: string; color: string; test: (d: Device) => boolean }[] = [
  { value: "online", label: "Online", color: "#22c55e", test: (d) => d.is_connected },
  { value: "offline", label: "Offline", color: "#ef4444", test: (d) => !d.is_connected },
  { value: "disabled", label: "Disabled", color: "#f59e0b", test: (d) => !d.enabled },
];

export function DevicesPage() {
  const { data, isLoading } = useStatus();
  const color = useInstanceColor();
  const [q, setQ] = useState("");
  // One state only ("" = every device).
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { notify, node } = useNotify();
  const { visible } = useInstances();

  const searched = (data?.devices ?? []).filter((d) => matches(q, d.origin, d.id, d.instanceName, d.version));
  const rows = searched.filter((d) => !filter || STATES.find((s) => s.value === filter)!.test(d));

  const { sorted, header } = useSorted<Tagged<Device>>(
    rows,
    {
      origin: (d) => d.origin,
      state: (d) => deviceState(d).label,
      workers: (d) => d.worker_in_use_count,
      weight: (d) => d.worker_in_use_weight_percent,
      memory: (d) => d.last_memory?.free ?? 0,
      seen: (d) => d.last_seen_at_ms ?? 0,
      uptime: (d) => -(d.session?.connected_at_ms ?? Date.now()),
    },
    "origin",
  );

  // One table per instance, in config.toml order; sorting applies inside each.
  // Instances with no devices keep their header (0/0) unless a search or
  // filter is narrowing the list.
  const narrowed = !!q || !!filter;
  const groups = visible
    .map((i) => ({ id: i.id, name: i.name, rows: sorted.filter((d) => d.instanceId === i.id) }))
    .filter((g) => g.rows.length || !narrowed);

  const toggle = (key: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  if (isLoading) return <Spinner className="mx-auto mt-20" />;

  return (
    <div className="animate-in flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchBox value={q} onChange={setQ} placeholder="Search origin, id, version…" />
        <FilterMenu
          className="w-full sm:w-auto"
          label="Device state"
          allLabel="All devices"
          value={filter}
          onChange={setFilter}
          total={searched.length}
          options={STATES.map((s) => ({ value: s.value, label: s.label, color: s.color, count: searched.filter(s.test).length }))}
        />
      </div>
      {groups.length === 0 ? (
        <Empty>No devices to show.</Empty>
      ) : (
        groups.map((g) => (
          <section key={g.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-1">
              <Dot color={color(g.id)} />
              <h2 className="font-semibold">{g.name}</h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {g.rows.filter((d) => d.is_connected).length}/{g.rows.length} online ·{" "}
                {g.rows.reduce((a, d) => a + d.worker_in_use_count, 0)}/
                {g.rows.reduce((a, d) => a + d.worker_count, 0)} workers in use
              </span>
            </div>
            {g.rows.length === 0 ? (
              <div className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
                No devices connected to this instance.
              </div>
            ) : (
            <Table container>
              <thead>
                <tr>
                  <th className="w-8" />
                  {header("origin", "Origin")}
                  {header("workers", "Workers")}
                  {header("weight", "Weight")}
                  {header("memory", "Free memory")}
                  {header("uptime", "Uptime")}
                  {header("seen", "Seen")}
                  <th />
                </tr>
              </thead>
              <tbody>
                {g.rows.map((d) => {
                  const key = `${d.instanceId}/${d.id}`;
                  const open = expanded.has(key);
                  const st = deviceState(d);
                  return (
                    <Fragment key={key}>
                      <tr className="cursor-pointer" onClick={() => toggle(key)}>
                        <td>
                          <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
                        </td>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <StatusDot
                              tone={st.tone}
                              label={st.label}
                              detail={
                                d.is_connected
                                  ? `${d.worker_in_use_count}/${d.worker_count} workers in use`
                                  : `Seen ${fmt.ago(d.last_seen_at_ms)}`
                              }
                            />
                            {/* The device id only on hover; the origin is what people recognise. */}
                            <HoverCard content={<span className="font-mono">{d.id}</span>}>
                              <span className="font-medium whitespace-nowrap">{d.origin || "—"}</span>
                            </HoverCard>
                          </div>
                        </td>
                        <td className="tabular-nums">
                          {d.worker_in_use_count} / {d.worker_count}
                        </td>
                        <td className="min-w-28">
                          {/* Numbers on hover; the bar alone reads at a glance. */}
                          <HoverCard
                            className="block py-1.5"
                            content={
                              <span className="tabular-nums">
                                Weight in use <b>{d.worker_in_use_weight}</b> of {d.worker_max_weight}
                                <span className="text-muted-foreground"> · {fmt.pct(d.worker_in_use_weight_percent)}</span>
                              </span>
                            }
                          >
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-green-500"
                                style={{ width: `${Math.min(100, d.worker_in_use_weight_percent)}%` }}
                              />
                            </div>
                          </HoverCard>
                        </td>
                        <td className="whitespace-nowrap tabular-nums">{fmt.kb(d.last_memory?.free)}</td>
                        <td className="whitespace-nowrap">
                          {d.is_connected && d.session ? fmt.duration(Date.now() - d.session.connected_at_ms) : "—"}
                        </td>
                        <td className="whitespace-nowrap text-muted-foreground">{fmt.ago(d.last_seen_at_ms)}</td>
                        <td onClick={(e) => e.stopPropagation()} className="text-right">
                          <ActionsMenu
                            instanceId={d.instanceId}
                            basePath={`/device/${encodeURIComponent(d.id)}`}
                            actions={DEVICE_ACTIONS.filter((a) => (d.enabled ? a.action !== "enable" : a.action !== "disable"))}
                            subject={d.origin || d.id}
                            kind="Device"
                            notify={notify}
                          />
                        </td>
                      </tr>
                      {open ? (
                        <tr className="bg-muted/20 hover:bg-muted/20!">
                          <td colSpan={8} className="pb-4!">
                            {/* From the row's left edge and as wide as the visible table, kept
                                in view while its columns scroll sideways. */}
                            <div className="sticky left-3 w-[calc(100cqw-24px)]">
                              <DeviceDetail d={d} />
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
            )}
          </section>
        ))
      )}
      {node}
    </div>
  );
}

function DeviceDetail({ d }: { d: Device }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs @md:grid-cols-2 @3xl:grid-cols-4">
        <Field k="Version" v={d.version} />
        <Field k="Public IP" v={d.public_ip} />
        <Field k="MITM memory" v={fmt.kb(d.last_memory?.mitm)} />
        <Field k="Start memory" v={fmt.kb(d.last_memory?.start)} />
        <Field k="Messages rx/tx" v={`${fmt.int(d.messages_received)} / ${fmt.int(d.messages_sent)}`} />
        <Field k="Bytes rx/tx" v={`${fmt.bytes(d.bytes_received)} / ${fmt.bytes(d.bytes_sent)}`} />
        <Field k="Last seen" v={fmt.time(d.last_connected_at_ms)} />
        <Field k="Usable" v={d.can_be_used ? "Yes" : "No"} />
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th>Worker</th>
              <th>Controller</th>
              <th>Account</th>
              <th>Req/s (1m)</th>
              <th>Latency (1m)</th>
            </tr>
          </thead>
          <tbody>
            {[...(d.workers ?? [])]
              .sort((a, b) => Number(splitWorkerId(a.id).num) - Number(splitWorkerId(b.id).num) || a.id.localeCompare(b.id))
              .map((w) => {
              const c = w.session?.controller;
              return (
                <tr key={w.id}>
                  <td>
                    <WorkerName w={w} />
                  </td>
                  <td>{c?.id ?? "—"}</td>
                  <td className="text-muted-foreground">{c ? `${c.account_username}` : "—"}</td>
                  <td className="tabular-nums">{fmt.dec2(w.time_windowed_stats?.requests_rate_over_1_min)}</td>
                  <td className="tabular-nums">{fmt.ms(w.time_windowed_stats?.request_ms_avg_over_1_min)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 border-b border-border/50 py-1">
      <span className="whitespace-nowrap text-muted-foreground">{k}</span>
      <span className="truncate text-right font-medium tabular-nums">{v ?? "—"}</span>
    </div>
  );
}

