import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { DragoniteInfo, GroupDoc, GroupOut, QuestMigration, SchedAction, ScheduleDoc, ScheduleOut, SchedWindow } from "@shared/types";
import {
  actionText,
  AREA_TYPES,
  BUILTIN_GROUPS,
  cleanSchedule,
  DAYS,
  KIND_LABEL,
  KIND_OPS,
  NOOP_POOLS,
  okDate,
  POOLS,
  SCALE_AREA_TYPES,
  scheduleProblems,
} from "@/lib/scheduler";
import { StackTag, useStacks } from "@/components/stack-tag";
import { toast } from "@/components/toaster";
import { Button, Input, Label, Modal, Select, Spinner } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { cn } from "@/lib/utils";

// ---- Small inputs ----

/** Pick several values from a list (and type others when `custom`), shown as removable chips. */
export function ChipSelect({
  value,
  options,
  onChange,
  placeholder,
  custom,
  badge,
}: {
  value: string[];
  options: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  custom?: boolean;
  /** A short tag next to an option (e.g. "built-in", "UTC"). */
  badge?: (v: string) => string | undefined;
}) {
  const [text, setText] = useState("");
  const left = options.filter((o) => !value.includes(o));
  const add = (v: string) => {
    const x = v.trim();
    if (x && !value.includes(x)) onChange([...value, x]);
    setText("");
  };
  return (
    <div className="flex flex-col gap-1.5">
      {value.length ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-2 text-xs">
              {v}
              {badge?.(v) ? <span className="text-[10px] text-muted-foreground">{badge(v)}</span> : null}
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="rounded-full p-0.5 hover:bg-accent">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {custom ? (
        <div className="flex gap-2">
          <Input
            value={text}
            list={`chips-${placeholder}`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(text);
              }
            }}
            placeholder={placeholder}
            className="h-8 text-xs"
          />
          <datalist id={`chips-${placeholder}`}>
            {left.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <Button type="button" size="sm" variant="outline" disabled={!text.trim()} onClick={() => add(text)}>
            Add
          </Button>
        </div>
      ) : (
        <Select value="" onChange={(e) => e.target.value && add(e.target.value)} className="h-8 text-xs" disabled={!left.length}>
          <option value="">{left.length ? placeholder : "All added"}</option>
          {left.map((o) => (
            <option key={o} value={o}>
              {o}
              {badge?.(o) ? ` — ${badge(o)}` : ""}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

function WindowsInput({ value, onChange, showFor = true, label }: { value: SchedWindow[]; onChange: (v: SchedWindow[]) => void; showFor?: boolean; label: string }) {
  const set = (i: number, w: SchedWindow) => onChange(value.map((x, j) => (j === i ? w : x)));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...value, { at: "00:00" }])}>
          <Plus />
          Add window
        </Button>
      </div>
      {value.map((w, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-2 sm:flex-row sm:items-start">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">At</span>
            <Input type="time" value={w.at} onChange={(e) => set(i, { ...w, at: e.target.value })} className="h-8 w-28 text-xs" />
          </label>
          {showFor ? (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">For (e.g. 8h, 90m, 1h30m)</span>
              <Input value={w.for ?? ""} onChange={(e) => set(i, { ...w, for: e.target.value || undefined })} placeholder="8h" className="h-8 w-32 text-xs" />
            </label>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Days (empty = every day; ranges like mon-fri work)</span>
            <ChipSelect value={w.days ?? []} options={DAYS} onChange={(days) => set(i, { ...w, days })} placeholder="Add day or range" custom />
          </div>
          <Button type="button" size="icon" variant="ghost" className="size-8 self-end sm:self-start" aria-label="Remove window" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 />
          </Button>
        </div>
      ))}
    </div>
  );
}

function ParamsInput({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Params</Label>
      {Object.entries(value).map(([key, val]) => (
        <span key={key} className="inline-flex w-fit items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-2 font-mono text-xs">
          {key}={val}
          <button
            type="button"
            aria-label={`Remove ${key}`}
            onClick={() => onChange(Object.fromEntries(Object.entries(value).filter(([x]) => x !== key)))}
            className="rounded-full p-0.5 hover:bg-accent"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <div className="flex gap-2">
        <Input value={k} onChange={(e) => setK(e.target.value)} placeholder="key" className="h-8 font-mono text-xs" />
        <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="value" className="h-8 font-mono text-xs" />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!k.trim()}
          onClick={() => {
            onChange({ ...value, [k.trim()]: v });
            setK("");
            setV("");
          }}
        >
          Add
        </Button>
      </div>
      <span className="text-[11px] text-muted-foreground">fetch_route: coverage=bootstrap · start_quest: clear=true|false (default true) · check_quest: none</span>
    </div>
  );
}

const Field = ({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) => (
  <label className={cn("flex flex-col gap-1.5", className)}>
    <Label>{label}</Label>
    {children}
    {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
  </label>
);

const Note = ({ children }: { children: ReactNode }) => <p className="text-[11px] text-muted-foreground">{children}</p>;

function ActionEditor({ a, i, onChange, onRemove }: { a: SchedAction; i: number; onChange: (a: SchedAction) => void; onRemove: () => void }) {
  const kindop = `${a.kind}:${a.op}`;
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground tabular-nums">#{i}</span>
        <Select
          value={KIND_OPS.some((k) => k.value === kindop) ? kindop : "state:scale"}
          onChange={(e) => {
            const [kind, op] = e.target.value.split(":");
            // A new kind of action starts clean; its timing stays.
            onChange({
              kind,
              op,
              at: a.at,
              windows: a.windows,
              type: kind === "job" ? (op === "fetch_route" ? "fort" : "quest") : op === "route_mode" ? "fort" : op === "pause" ? "" : "pokemon",
              ...(op === "pause" ? { value: true } : op === "route_mode" ? { value: "full" } : {}),
            });
          }}
          className="h-8 flex-1 text-xs"
        >
          {KIND_OPS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
        <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`Remove action ${i}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>

      {a.kind === "state" && a.op === "scale" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Type">
              <Select value={a.type ?? ""} onChange={(e) => onChange({ ...a, type: e.target.value })} className="h-8 text-xs">
                {[...SCALE_AREA_TYPES, ...POOLS].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Set (absolute)" hint="Exactly one of set / delta">
              <Input type="number" value={a.set ?? ""} onChange={(e) => onChange({ ...a, set: num(e.target.value) })} className="h-8 text-xs" />
            </Field>
            <Field label="Delta (vs baseline)" hint="max(0, baseline + delta)">
              <Input type="number" value={a.delta ?? ""} onChange={(e) => onChange({ ...a, delta: num(e.target.value) })} className="h-8 text-xs" />
            </Field>
          </div>
          <Note>
            Pool types adjust every configured mode row against its own baseline, not one global number.
            {NOOP_POOLS.includes(a.type ?? "") ? " This pool type does nothing on public builds (it is only logged)." : ""}
          </Note>
        </>
      ) : null}

      {a.kind === "state" && a.op === "pause" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type (empty = whole area)">
              <Select value={a.type ?? ""} onChange={(e) => onChange({ ...a, type: e.target.value })} className="h-8 text-xs">
                <option value="">(whole area)</option>
                {[...SCALE_AREA_TYPES, "invasion"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex cursor-pointer items-center gap-2 pt-5 text-sm">
              <input type="checkbox" checked={a.value === true} onChange={(e) => onChange({ ...a, value: e.target.checked })} className="size-4 accent-[var(--primary)]" />
              Paused
            </label>
          </div>
          <Note>Pause keeps workers warm (instant resume); scale with set 0 tears them down.</Note>
        </>
      ) : null}

      {a.kind === "state" && a.op === "route_mode" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <Select value="fort" disabled className="h-8 text-xs">
                <option value="fort">fort</option>
              </Select>
            </Field>
            <Field label="Mode">
              <Select value={String(a.value ?? "full")} onChange={(e) => onChange({ ...a, value: e.target.value })} className="h-8 text-xs">
                <option value="full">full</option>
                <option value="optimised">optimised</option>
              </Select>
            </Field>
          </div>
          <WindowsInput label="Per-action windows" value={a.windows ?? []} onChange={(windows) => onChange({ ...a, windows })} />
        </>
      ) : null}

      {a.kind === "job" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Type">
              <Select value={a.type ?? ""} onChange={(e) => onChange({ ...a, type: e.target.value })} className="h-8 text-xs">
                {(a.op === "fetch_route" ? ["fort", "quest", "pokemon"] : ["quest"]).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="At (HH:MM, area-local)">
              <Input type="time" value={a.at ?? ""} onChange={(e) => onChange({ ...a, at: e.target.value || undefined })} className="h-8 text-xs" />
            </Field>
            <Field label="If missed">
              <Select value={a.on_missed ?? ""} onChange={(e) => onChange({ ...a, on_missed: e.target.value || undefined })} className="h-8 text-xs">
                <option value="">skip (default)</option>
                <option value="skip">skip</option>
                <option value="run_once">run once</option>
              </Select>
            </Field>
          </div>
          <Note>Jobs need their own timing (they don't use the schedule's windows): set a time or windows.</Note>
          <WindowsInput label="Windows" showFor={false} value={a.windows ?? []} onChange={(windows) => onChange({ ...a, windows })} />
          <ParamsInput value={a.params ?? {}} onChange={(params) => onChange({ ...a, params })} />
        </>
      ) : null}
    </div>
  );
}

/** datetime-local value (local time) for an RFC3339 instant, and back. */
const toLocalInput = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function Problems({ list }: { list: string[] }) {
  if (!list.length) return null;
  return (
    <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
      <p className="font-semibold">Please fix the following</p>
      <ul className="mt-1 list-disc pl-4">
        {list.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

const NEW_SCHEDULE: ScheduleDoc = { name: "", enabled: true, schedule_kind: "recurring", priority: 100, targets: {}, actions: [], windows: [] };

/** Create a schedule or edit one: the whole document, checked as the admin checks it. */
export function ScheduleModal({
  stack,
  schedule,
  groups,
  onClose,
  onDone,
}: {
  stack: DragoniteInfo;
  schedule?: ScheduleOut;
  groups: GroupOut[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { on } = useStacks();
  const [d, setD] = useState<ScheduleDoc>(() => (schedule ? structuredClone({ ...NEW_SCHEDULE, ...schedule.document }) : structuredClone(NEW_SCHEDULE)));
  const [date, setDate] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const areas = useQuery({ queryKey: ["dragonite-areas", stack.id], queryFn: () => endpoints.dragoniteAreas(stack.id), staleTime: 60_000 });
  const tz = useQuery({ queryKey: ["scheduler-areas", stack.id], queryFn: () => endpoints.scheduler.areas(stack.id), staleTime: 300_000 });
  const areaNames = (areas.data?.areas ?? []).map((a) => a.name).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const groupNames = [...BUILTIN_GROUPS, ...groups.map((g) => g.name)];
  const tzOf = (name: string) => {
    const a = tz.data?.find((x) => x.name === name);
    if (!a) return undefined;
    return a.timezone_source === "none" || (!a.timezone_source && !a.has_geofence) ? "UTC" : a.timezone;
  };
  const problems = scheduleProblems(d);
  const set = (p: Partial<ScheduleDoc>) => setD((x) => ({ ...x, ...p }));
  const setTargets = (p: Partial<NonNullable<ScheduleDoc["targets"]>>) => setD((x) => ({ ...x, targets: { ...x.targets, ...p } }));

  const save = async () => {
    setTried(true);
    if (problems.length) return;
    setBusy(true);
    setError(undefined);
    try {
      await endpoints.scheduler.saveSchedule(stack.id, cleanSchedule(d), schedule?.id);
      toast({ text: `Schedule “${d.name.trim()}” ${schedule ? "saved" : "created"}${on(stack.id)}` });
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
      wide
      onClose={onClose}
      title={schedule ? `Edit ${schedule.name}` : `New schedule${on(stack.id)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner className="size-4" /> : null}
            {schedule ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pr-1 text-sm">
        {schedule?.source === "config" ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Config-seeded: it reproduces Dragonite's built-in cron behaviour.
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-[1fr_9rem_7rem]">
          <Field label="Name">
            <Input value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={100} autoFocus />
          </Field>
          <Field label="Kind">
            <Select value={d.schedule_kind} onChange={(e) => set({ schedule_kind: e.target.value })}>
              {Object.entries(KIND_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Input type="number" value={d.priority ?? ""} onChange={(e) => set({ priority: e.target.value === "" ? undefined : Number(e.target.value) })} />
          </Field>
        </div>
        <Note>
          Priority decides which schedule wins when two change the same thing on the same target at once: the higher number wins. Two enabled schedules with the same priority
          can't touch the same target and setting. Defaults: recurring 100 · dated 500 · manual 1000.
        </Note>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Timezone override (IANA, empty = area-local)" hint="Times run in each target area's own timezone (from its geofence; UTC if none), not yours.">
            <Input value={d.tz ?? ""} onChange={(e) => set({ tz: e.target.value })} placeholder="e.g. Europe/Madrid" />
          </Field>
          <Field label={d.schedule_kind === "manual" ? "Expires at (required)" : "Expires at (optional hard stop)"}>
            <Input
              type="datetime-local"
              value={toLocalInput(d.expires_at)}
              onChange={(e) => set({ expires_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
            />
          </Field>
        </div>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={d.enabled ?? true} onChange={(e) => set({ enabled: e.target.checked })} className="size-4 accent-[var(--primary)]" />
          Enabled
        </label>

        {d.schedule_kind !== "manual" ? <WindowsInput label="Windows" value={d.windows ?? []} onChange={(windows) => set({ windows })} /> : null}
        {d.schedule_kind === "dated" ? (
          <div className="flex flex-col gap-1.5">
            <Label>Dates</Label>
            <div className="flex flex-wrap gap-1.5">
              {(d.dates ?? []).map((x) => (
                <span key={x} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-2 text-xs tabular-nums">
                  {x}
                  <button type="button" aria-label={`Remove ${x}`} onClick={() => set({ dates: (d.dates ?? []).filter((y) => y !== x) })} className="rounded-full p-0.5 hover:bg-accent">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-44 text-xs" />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!okDate(date) || (d.dates ?? []).includes(date)}
                onClick={() => {
                  set({ dates: [...(d.dates ?? []), date].sort() });
                  setDate("");
                }}
              >
                Add
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t pt-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">Targets</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Groups</Label>
              <ChipSelect
                value={d.targets?.groups ?? []}
                options={groupNames}
                onChange={(groups) => setTargets({ groups })}
                placeholder="Add group"
                badge={(g) => (BUILTIN_GROUPS.includes(g) ? "built-in" : undefined)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Areas</Label>
              <ChipSelect value={d.targets?.areas ?? []} options={areaNames} onChange={(areas) => setTargets({ areas })} placeholder="Add area" badge={tzOf} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Exclude</Label>
            <ChipSelect value={d.targets?.exclude ?? []} options={[...groupNames, ...areaNames]} onChange={(exclude) => setTargets({ exclude })} placeholder="Group or area to leave out" custom />
            <Note>Names removed from the resolved set (e.g. all-fort except one group). At least one group or area is required.</Note>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase">Actions (in order)</h4>
            <Button type="button" size="sm" variant="outline" onClick={() => set({ actions: [...d.actions, { kind: "state", op: "scale", type: "pokemon" }] })}>
              <Plus />
              Add action
            </Button>
          </div>
          {d.actions.length === 0 ? <Note>No actions yet.</Note> : null}
          {d.actions.map((a, i) => (
            <ActionEditor
              key={i}
              a={a}
              i={i}
              onChange={(x) => set({ actions: d.actions.map((y, j) => (j === i ? x : y)) })}
              onRemove={() => set({ actions: d.actions.filter((_, j) => j !== i) })}
            />
          ))}
        </div>

        <details className="rounded-lg border px-3 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">Why isn't my schedule running?</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>Is it enabled?</li>
            <li>Its live effect is in the Run ledger and "Active now", not in the Areas list: the scheduler overlays counts and never edits an area's config.</li>
            <li>Is the window open in the area's timezone (UTC if it has no geofence)? Do its days and dates include today?</li>
            <li>Do the targets resolve to a real, enabled area or group?</li>
            <li>For all-&lt;type&gt; groups, the area needs that worker type above 0: a delta can't lift it from zero.</li>
            <li>Is "expires at" in the past?</li>
          </ol>
        </details>

        {tried ? <Problems list={problems} /> : null}
        {error ? <p className="text-red-300">{error}</p> : null}
      </div>
    </Modal>
  );
}

function groupProblems(g: { name: string; areas: { area: string; attributes: string[] }[]; pools: string[] }) {
  const out: string[] = [];
  if (!g.name.trim()) out.push("name is required");
  if (BUILTIN_GROUPS.includes(g.name.trim())) out.push(`name "${g.name.trim()}" is reserved`);
  const seen = new Set<string>();
  for (const a of g.areas) {
    if (!a.area.trim()) out.push("a member is missing its area");
    else if (seen.has(a.area)) out.push(`duplicate area "${a.area}"`);
    seen.add(a.area);
  }
  return out;
}

/** Create a group or edit one: areas (with the worker types they take part in) and global pools. */
export function GroupModal({ stack, group, onClose, onDone }: { stack: DragoniteInfo; group?: GroupOut; onClose: () => void; onDone: () => void }) {
  const { on } = useStacks();
  const [name, setName] = useState(group?.name ?? "");
  const [members, setMembers] = useState(group?.document.areas?.map((a) => ({ area: a.area, attributes: a.attributes ?? [] })) ?? []);
  const [pools, setPools] = useState(group?.document.pools?.map((p) => p.pool) ?? []);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const areas = useQuery({ queryKey: ["dragonite-areas", stack.id], queryFn: () => endpoints.dragoniteAreas(stack.id), staleTime: 60_000 });
  const areaNames = (areas.data?.areas ?? []).map((a) => a.name).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const problems = groupProblems({ name, areas: members, pools });

  const save = async () => {
    setTried(true);
    if (problems.length) return;
    setBusy(true);
    setError(undefined);
    const doc: GroupDoc = {
      name: name.trim(),
      areas: members.map((m) => ({ area: m.area, ...(m.attributes.length ? { attributes: m.attributes } : {}) })),
      pools: pools.map((pool) => ({ pool })),
    };
    try {
      await endpoints.scheduler.saveGroup(stack.id, doc, group?.id);
      toast({ text: `Group “${doc.name}” ${group ? "saved" : "created"}${on(stack.id)}` });
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
      wide
      onClose={onClose}
      title={group ? `Edit ${group.name}` : `New group${on(stack.id)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner className="size-4" /> : null}
            {group ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1 text-sm">
        <Field label="Name" hint={`Reserved: ${BUILTIN_GROUPS.join(", ")}`}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
        </Field>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Areas</Label>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMembers((m) => [...m, { area: "", attributes: [] }])}>
              <Plus />
              Add area
            </Button>
          </div>
          {members.map((m, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-2 sm:flex-row sm:items-start">
              <Select
                value={m.area}
                onChange={(e) => setMembers((x) => x.map((y, j) => (j === i ? { ...y, area: e.target.value } : y)))}
                className="h-8 text-xs sm:w-56"
              >
                <option value="">Choose an area…</option>
                {[...new Set([...(m.area ? [m.area] : []), ...areaNames])].map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">Worker types it takes part in (empty = all)</span>
                <ChipSelect
                  value={m.attributes}
                  options={AREA_TYPES}
                  onChange={(attributes) => setMembers((x) => x.map((y, j) => (j === i ? { ...y, attributes } : y)))}
                  placeholder="Add type"
                />
              </div>
              <Button type="button" size="icon" variant="ghost" className="size-8 self-end sm:self-start" aria-label="Remove area" onClick={() => setMembers((x) => x.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Global pools</Label>
          <ChipSelect value={pools} options={POOLS} onChange={setPools} placeholder="Add pool" />
          <Note>The unbound modes (level, invasion, scout…) a schedule aimed at this group also acts on.</Note>
        </div>
        {tried ? <Problems list={problems} /> : null}
        {error ? <p className="text-red-300">{error}</p> : null}
      </div>
    </Modal>
  );
}

/** Queue one job action of a schedule for one area now, outside its window. */
export function RunNowModal({ stack, schedule, actionIdx, onClose, onDone }: { stack: DragoniteInfo; schedule: ScheduleOut; actionIdx: number; onClose: () => void; onDone: () => void }) {
  const areas = useQuery({ queryKey: ["dragonite-areas", stack.id], queryFn: () => endpoints.dragoniteAreas(stack.id), staleTime: 60_000 });
  const list = [...(areas.data?.areas ?? [])].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  const [area, setArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const a = schedule.document.actions[actionIdx];
  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await endpoints.scheduler.runNow(stack.id, { schedule_id: schedule.id, action_idx: actionIdx, area_id: Number(area) });
      toast({ text: `Run queued (fires ${new Date(r.fire_at).toLocaleString("en-GB")})` });
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
      title={`Run ${a ? actionText(a) : `action ${actionIdx}`} now`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={run} disabled={!area || busy}>
            {busy ? <Spinner className="size-4" /> : null}
            {busy ? "Queuing…" : "Run"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          Queues action #{actionIdx} of “{schedule.name}” for one area right away, outside its window.
        </p>
        {areas.data && !list.length ? (
          <p className="text-muted-foreground">No areas available — configure an area first.</p>
        ) : (
          <Field label="Area">
            <Select value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">Choose an area…</option>
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {error ? <p className="text-red-300">{error}</p> : null}
      </div>
    </Modal>
  );
}

/** Legacy quest_mode_hours to start/check quest schedules: preview first, then migrate. */
export function QuestMigrationModal({ stack, onClose, onDone }: { stack: DragoniteInfo; onClose: () => void; onDone: () => void }) {
  const { on } = useStacks();
  const [minutes, setMinutes] = useState("5");
  const [preview, setPreview] = useState<QuestMigration>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const m = Math.min(59, Math.max(0, Number(minutes) || 0));
  const run = async (dry: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await endpoints.scheduler.questMigration(stack.id, dry, m);
      if (dry) setPreview(r);
      else {
        toast({ text: `Migrated ${r.migrated.length} schedule${r.migrated.length === 1 ? "" : "s"}${on(stack.id)}` });
        onDone();
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const hh = (h: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Migrate quest hours to the scheduler"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => run(true)} disabled={busy}>
            Preview
          </Button>
          <Button onClick={() => run(false)} disabled={busy || !preview?.migrated.length}>
            {busy ? <Spinner className="size-4" /> : null}
            Migrate
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          Turns each area's old quest hours into start_quest / check_quest schedules (the most common pattern goes to all-quest, others get their own groups), clears
          the migrated areas' hours and queues a reload. Preview first.
        </p>
        <Field label="Minutes past the hour" className="w-40">
          <Input
            type="number"
            min={0}
            max={59}
            value={minutes}
            onChange={(e) => {
              setMinutes(e.target.value);
              setPreview(undefined);
            }}
          />
        </Field>
        {preview ? (
          preview.migrated.length || preview.skipped.length ? (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3 text-xs">
              {preview.migrated.map((x) => (
                <div key={x.schedule}>
                  <p className="font-medium">
                    {x.schedule} → {x.target}
                    {x.group ? ` (${x.group})` : ""}
                  </p>
                  <p className="text-muted-foreground">
                    start {hh(x.first_hour)} · check {x.check_hours.map(hh).join(", ") || "—"} · {x.areas.length} area{x.areas.length === 1 ? "" : "s"}: {x.areas.join(", ")}
                    {x.excluded?.length ? ` · excludes ${x.excluded.join(", ")}` : ""}
                  </p>
                </div>
              ))}
              {preview.skipped.map((x) => (
                <p key={x.schedule} className="text-amber-300">
                  skipped {x.areas.join(", ")} — {x.reason}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">Nothing to migrate — no area has quest hours set.</p>
          )
        ) : null}
        {error ? <p className="text-red-300">{error}</p> : null}
      </div>
    </Modal>
  );
}

/**
 * Copy a schedule to another stack. Groups it uses that the other stack lacks
 * can go along (minus areas that stack doesn't have); areas it targets by name
 * must exist there too. The copy starts disabled unless asked otherwise.
 */
export function CopyScheduleModal({
  stack,
  others,
  schedule,
  groups,
  onClose,
  onDone,
}: {
  stack: DragoniteInfo;
  others: DragoniteInfo[];
  schedule: ScheduleOut;
  groups: GroupOut[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [to, setTo] = useState(others[0]?.id ?? "");
  const [name, setName] = useState(schedule.name);
  const [enable, setEnable] = useState(false);
  const [withGroups, setWithGroups] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const target = others.find((d) => d.id === to);
  const theirSchedules = useQuery({ queryKey: ["scheduler-schedules", to], queryFn: () => endpoints.scheduler.schedules(to), enabled: !!to });
  const theirGroups = useQuery({ queryKey: ["scheduler-groups", to], queryFn: () => endpoints.scheduler.groups(to), enabled: !!to });
  const theirAreas = useQuery({ queryKey: ["dragonite-areas", to], queryFn: () => endpoints.dragoniteAreas(to), enabled: !!to });
  const loading = theirSchedules.isLoading || theirGroups.isLoading || theirAreas.isLoading;
  const areaSet = new Set((theirAreas.data?.areas ?? []).map((a) => a.name));
  const t = schedule.document.targets ?? {};
  const mine = new Map(groups.map((g) => [g.name, g]));
  // Groups of this stack the schedule names (as a target or an exclusion) that the other stack lacks.
  const missingGroups = [...new Set([...(t.groups ?? []), ...(t.exclude ?? [])])]
    .filter((g) => mine.has(g) && !(theirGroups.data ?? []).some((x) => x.name === g))
    .map((g) => mine.get(g)!);
  const lostMembers = missingGroups.flatMap((g) => (g.document.areas ?? []).filter((a) => !areaSet.has(a.area)).map((a) => `${a.area} (${g.name})`));
  const missingAreas = (t.areas ?? []).filter((a) => !areaSet.has(a));
  const taken = (theirSchedules.data ?? []).some((s) => s.name === name.trim());
  const canRun = !!to && !!name.trim() && !taken && !loading && !busy && (withGroups || !missingGroups.length);

  const run = async () => {
    setBusy(true);
    setError(undefined);
    const made: string[] = [];
    try {
      if (withGroups) {
        for (const g of missingGroups) {
          await endpoints.scheduler.saveGroup(to, {
            name: g.name,
            areas: (g.document.areas ?? []).filter((a) => areaSet.has(a.area)),
            pools: g.document.pools ?? [],
          });
          made.push(g.name);
        }
      }
      await endpoints.scheduler.saveSchedule(to, cleanSchedule({ ...schedule.document, name: name.trim(), enabled: enable }));
      toast({
        text: `“${schedule.name}” copied to ${target?.name ?? to}${name.trim() !== schedule.name ? ` as “${name.trim()}”` : ""}${made.length ? ` with group${made.length > 1 ? "s" : ""} ${made.join(", ")}` : ""}${enable ? "" : " (disabled)"}`,
      });
      onDone();
      onClose();
    } catch (e) {
      setError(`${(e as Error).message}${made.length ? ` — group${made.length > 1 ? "s" : ""} ${made.join(", ")} already created there` : ""}`);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Copy ${schedule.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={run} disabled={!canRun}>
            {busy ? <Spinner className="size-4" /> : null}
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
                <StackTag id={d.id} force />
              </button>
            ))}
          </div>
        </div>
        <Field label="Name there">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          {taken ? <span className="text-[11px] text-amber-400">{target?.name} already has a schedule with this name.</span> : null}
        </Field>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={enable} onChange={(e) => setEnable(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          Enable the copy right away
        </label>
        {loading ? (
          <Spinner />
        ) : (
          <>
            {missingGroups.length ? (
              <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/20 p-3 text-xs">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={withGroups} onChange={(e) => setWithGroups(e.target.checked)} className="size-4 accent-[var(--primary)]" />
                  Also create the group{missingGroups.length > 1 ? "s" : ""} it uses: {missingGroups.map((g) => g.name).join(", ")}
                </label>
                {!withGroups ? <span className="text-amber-400">Without them the copy would target groups {target?.name} doesn't have.</span> : null}
                {withGroups && lostMembers.length ? (
                  <span className="text-amber-400">
                    Left out, {target?.name} has no such area: {lostMembers.join(", ")}.
                  </span>
                ) : null}
              </div>
            ) : null}
            {missingAreas.length ? (
              <p className="text-xs text-amber-400">
                {target?.name} has no area {missingAreas.join(", ")}: Dragonite may refuse the copy, or it will do nothing there.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Same kind, priority, timing, targets and {schedule.document.actions.length} action{schedule.document.actions.length === 1 ? "" : "s"}. The original stays on {stack.name}. Times
              run in each area's own timezone there.
            </p>
          </>
        )}
        {error ? <p className="text-red-300">{error}</p> : null}
      </div>
    </Modal>
  );
}
