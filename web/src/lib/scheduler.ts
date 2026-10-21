import type { SchedAction, ScheduleDoc, SchedWindow } from "@shared/types";

// ---- What Dragonite's scheduler accepts (from its admin and API schema) ----

/** Area worker types (group attributes). */
export const AREA_TYPES = ["pokemon", "fort", "quest", "rare"];
/** Area types that scale or pause (not quest). */
export const SCALE_AREA_TYPES = ["pokemon", "fort", "rare"];
/** Global pools: the unbound modes. */
export const POOLS = ["level", "invasion", "scout", "encounter", "invasion_level"];
/** Pools that do nothing on public builds (logged only). */
export const NOOP_POOLS = ["encounter", "invasion_level"];
/** Built-in groups; their names are reserved. */
export const BUILTIN_GROUPS = ["all", "all-pokemon", "all-fort", "all-quest", "all-rare"];
export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/** Default priority per kind (the API applies it to 0 or nothing). */
export const KIND_PRIORITY: Record<string, number> = { recurring: 100, dated: 500, manual: 1000 };
export const JOBS = [
  ["fort", "fetch_route"],
  ["quest", "fetch_route"],
  ["pokemon", "fetch_route"],
  ["quest", "start_quest"],
  ["quest", "check_quest"],
];

/** The action picker: kind and op in one choice, as the admin's form. */
export const KIND_OPS = [
  { value: "state:scale", label: "State · scale" },
  { value: "state:pause", label: "State · pause" },
  { value: "state:route_mode", label: "State · route mode" },
  { value: "job:fetch_route", label: "Job · fetch route" },
  { value: "job:start_quest", label: "Job · start quest" },
  { value: "job:check_quest", label: "Job · check quest" },
];

export const KIND_LABEL: Record<string, string> = { recurring: "Recurring", dated: "Dated", manual: "Manual" };

// ---- Display ----

export const windowText = (w: SchedWindow) => `${w.at}${w.for ? ` for ${w.for}` : ""}${w.days?.length ? ` [${w.days.join(",")}]` : ""}`;

/** Every time a schedule acts: its windows, then each action's time and windows. */
export function timings(d: ScheduleDoc) {
  const out = (d.windows ?? []).map(windowText);
  for (const a of d.actions ?? []) {
    if (a.at) out.push(a.at);
    for (const w of a.windows ?? []) out.push(windowText(w));
  }
  return out;
}

/** "state · scale · pokemon", "job · fetch_route · quest". */
export const actionText = (a: SchedAction) => [a.kind, a.op, a.type].filter(Boolean).join(" · ");

/** What an action does, in one line (set 3, paused, mode full, on_missed skip…). */
export function actionEffect(a: SchedAction) {
  if (a.kind === "state" && a.op === "scale") return a.set != null ? `set ${a.set}` : a.delta != null ? `delta ${a.delta > 0 ? "+" : ""}${a.delta}` : "";
  if (a.kind === "state" && a.op === "pause") return a.value ? "paused" : "not paused";
  if (a.kind === "state" && a.op === "route_mode") return `mode ${a.value}`;
  if (a.kind === "job") {
    const p = Object.entries(a.params ?? {}).map(([k, v]) => `${k}=${v}`);
    return [`on missed: ${a.on_missed || "skip"}`, ...p].join(" · ");
  }
  return "";
}

// ---- Validation (the admin's rules, so mistakes show before Dragonite refuses them) ----

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DURATION = /^[-+]?((\d+(\.\d+)?)(ns|us|µs|ms|s|m|h))+$/;
const okDay = (d: string) => {
  const x = d.toLowerCase();
  if (DAYS.includes(x)) return true;
  const [a, b, ...rest] = x.split("-");
  return !rest.length && DAYS.includes(a) && DAYS.includes(b ?? "");
};
const positive = (d: string) => DURATION.test(d) && !d.startsWith("-") && !/^\+?(0+(\.0+)?(ns|us|µs|ms|s|m|h))+$/.test(d);
export const okDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);

function windowProblems(ws: SchedWindow[] | undefined, where: string) {
  const out: string[] = [];
  for (const w of ws ?? []) {
    if (!HHMM.test(w.at)) out.push(`${where}invalid at "${w.at}" (want HH:MM)`);
    if (w.for && !positive(w.for)) out.push(`${where}invalid for "${w.for}": must be a positive duration`);
    for (const d of w.days ?? []) if (!okDay(d)) out.push(`${where}invalid day "${d}" (want mon..sun or a range like mon-fri)`);
  }
  return out;
}

export function scheduleProblems(d: ScheduleDoc) {
  const out: string[] = [];
  if (!d.name.trim()) out.push("name is required");
  if (!["recurring", "dated", "manual"].includes(d.schedule_kind)) out.push("kind must be recurring, dated or manual");
  if (!(d.targets?.groups?.length ?? 0) && !(d.targets?.areas?.length ?? 0)) out.push("targets: at least one group or area is required");
  if (!d.actions.length) out.push("at least one action is required");
  out.push(...windowProblems(d.windows, "window: "));
  d.actions.forEach((a, i) => {
    const w = `action ${i}: `;
    out.push(...windowProblems(a.windows, w));
    if (a.at && !HHMM.test(a.at)) out.push(`${w}invalid at "${a.at}" (want HH:MM)`);
    if (a.kind === "state") {
      if (a.op === "scale") {
        if ((a.set != null) === (a.delta != null)) out.push(`${w}exactly one of set / delta`);
        if (![...SCALE_AREA_TYPES, ...POOLS].includes(a.type ?? "")) out.push(`${w}choose a type`);
      } else if (a.op === "pause") {
        if (!["", ...SCALE_AREA_TYPES, "invasion"].includes(a.type ?? "")) out.push(`${w}pause: invalid type "${a.type}"`);
        if (typeof a.value !== "boolean") out.push(`${w}paused must be yes or no`);
      } else if (a.op === "route_mode") {
        if (a.type !== "fort") out.push(`${w}route mode: type must be fort`);
        if (a.value !== "full" && a.value !== "optimised") out.push(`${w}route mode must be full or optimised`);
      } else out.push(`${w}unknown state op "${a.op}"`);
    } else if (a.kind === "job") {
      if (!JOBS.some(([t, o]) => t === a.type && o === a.op)) out.push(`${w}${a.op} needs type ${a.op === "fetch_route" ? "pokemon, fort or quest" : "quest"}`);
      if (!a.at && !a.windows?.length) out.push(`${w}a job needs a time (at) or windows`);
    } else out.push(`${w}invalid kind "${a.kind}"`);
  });
  if (d.schedule_kind === "recurring" && !d.windows?.length && d.actions.some((a) => !a.at && !a.windows?.length)) {
    out.push("a recurring schedule needs schedule windows or a time on every action");
  }
  if (d.schedule_kind === "dated") {
    if (!d.dates?.length) out.push("a dated schedule needs at least one date");
    for (const x of d.dates ?? []) if (!okDate(x)) out.push(`invalid date "${x}" (want YYYY-MM-DD)`);
  }
  if (d.schedule_kind === "manual") {
    if (!d.expires_at) out.push("a manual schedule needs an expiry (expires at)");
    if (d.windows?.length) out.push("a manual schedule must not have windows");
    if (d.dates?.length) out.push("a manual schedule must not have dates");
    if (d.actions.some((a) => a.kind === "job")) out.push("a manual schedule cannot have job actions (it only changes state)");
  }
  return out;
}

/** Only what Dragonite accepts for this kind (it refuses unknown or empty-but-present fields). */
export function cleanSchedule(d: ScheduleDoc): ScheduleDoc {
  const targets = Object.fromEntries(Object.entries(d.targets ?? {}).filter(([, v]) => v?.length));
  const action = (a: SchedAction): SchedAction => {
    const base: SchedAction = { kind: a.kind, op: a.op };
    if (a.kind === "state" && a.op === "scale") return { ...base, type: a.type, ...(a.set != null ? { set: a.set } : { delta: a.delta }), ...(a.windows?.length ? { windows: a.windows } : {}) };
    if (a.kind === "state" && a.op === "pause") return { ...base, ...(a.type ? { type: a.type } : {}), value: !!a.value, ...(a.windows?.length ? { windows: a.windows } : {}) };
    if (a.kind === "state") return { ...base, type: "fort", value: a.value, ...(a.windows?.length ? { windows: a.windows } : {}) };
    return {
      ...base,
      type: a.type,
      ...(Object.keys(a.params ?? {}).length ? { params: a.params } : {}),
      ...(a.at ? { at: a.at } : {}),
      ...(a.on_missed ? { on_missed: a.on_missed } : {}),
      ...(a.windows?.length ? { windows: a.windows.map(({ at, days }) => ({ at, ...(days?.length ? { days } : {}) })) } : {}),
    };
  };
  const windows = (d.windows ?? []).map((w) => ({ at: w.at, ...(w.for ? { for: w.for } : {}), ...(w.days?.length ? { days: w.days } : {}) }));
  return {
    name: d.name.trim(),
    enabled: d.enabled ?? true,
    schedule_kind: d.schedule_kind,
    priority: d.priority || KIND_PRIORITY[d.schedule_kind],
    ...(d.tz?.trim() ? { tz: d.tz.trim() } : {}),
    ...(d.schedule_kind !== "manual" && windows.length ? { windows } : {}),
    ...(d.schedule_kind === "dated" && d.dates?.length ? { dates: d.dates } : {}),
    ...(d.expires_at ? { expires_at: d.expires_at } : {}),
    targets,
    actions: d.actions.map(action),
  };
}
