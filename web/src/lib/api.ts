import type {
  AreaStatsResponse,
  AccountImportResult,
  AccountOwner,
  AccountCounts,
  AccountLevelCounts,
  AppInfo,
  DragoniteAccountPage,
  DragoniteArea,
  DragoniteAreas,
  StackGeofences,
  DragoniteMeta,
  DragoniteProxies,
  GroupDoc,
  GroupOut,
  LevelStat,
  QuestMigration,
  SchedActivity,
  SchedArea,
  SchedDiagnostics,
  ScheduleDoc,
  ScheduleOut,
  SchedRun,
  ScoutJob,
  SystemStatus,
  DragoniteStatus,
  UnboundModeDetail,
  UnboundModes,
  UnboundModeType,
  ProxyImportResult,
  DragoniteSummary,
  GolbatMeta,
  GolbatPanelData,
  GolbatSummary,
  HistoryPoint,
  MergedStatus,
  MapDevice,
  MapTrailPoint,
  MeResponse,
  VmPanelData,
} from "@shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Set by the auth provider so any 401 drops the user back to the login page. */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      "X-Nacli": "1",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized();
  const type = res.headers.get("content-type") ?? "";
  const body = type.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof body === "object" && body ? (body.error ?? body.message) : body;
    throw new ApiError(String(msg || `HTTP ${res.status}`), res.status);
  }
  return body as T;
}

export const endpoints = {
  me: () => api<MeResponse>("/auth/me"),
  login: (username: string, password: string) =>
    api<{ ok: boolean }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => api("/auth/logout", { method: "POST" }),
  app: () => api<AppInfo>("/app"),
  status: (instance: string) => api<MergedStatus>(`/status?instance=${encodeURIComponent(instance)}`),
  history: (rangeMs: number) => api<Record<string, HistoryPoint[]>>(`/history?range=${rangeMs}`),
  deviceSeries: (metric: "memory" | "workers_in_use" | "workers_connected", rangeMs: number) =>
    api<Record<string, { origin: string; points: { t: number; v: number }[] }[]>>(
      `/history/device/${metric}?range=${rangeMs}`,
    ),
  controllerDemand: () =>
    api<{ windowS: number; instances: Record<string, { attempts: number; served: number; rejected: number }> }>(
      "/controller-demand",
    ),
  golbatMeta: () => api<GolbatMeta>("/golbat/meta"),
  golbatPanel: (id: string, rangeMs: number, inter: string, areas: string[] = []) => {
    const q = new URLSearchParams({ range: String(rangeMs), inter });
    for (const a of areas) q.append("area", a);
    return api<GolbatPanelData>(`/golbat/panel/${encodeURIComponent(id)}?${q}`);
  },
  golbatSummary: () => api<GolbatSummary>("/golbat/summary"),
  golbatDevices: () => api<MapDevice[]>("/golbat/devices"),
  golbatAreaStats: () => api<AreaStatsResponse>("/golbat/area-stats"),
  golbatTrail: (instance: string, controller: string) =>
    api<MapTrailPoint[]>(`/golbat/trail?${new URLSearchParams({ instance, controller })}`),
  dragoniteMeta: () => api<DragoniteMeta>("/dragonite/meta"),
  dragonitePanel: (id: string, rangeMs: number, instances: string[] = [], areas: string[] = []) => {
    const q = new URLSearchParams({ range: String(rangeMs) });
    for (const i of instances) q.append("instance", i);
    for (const a of areas) q.append("area", a);
    return api<VmPanelData>(`/dragonite/panel/${encodeURIComponent(id)}?${q}`);
  },
  dragoniteSummary: () => api<DragoniteSummary>("/dragonite/summary"),
  dragoniteProxies: () => api<DragoniteProxies>("/dragonite-proxies"),
  importProxies: (body: { text: string; stacks: string[]; prefix: string; enabled: boolean; skipExisting: boolean; reload: boolean }) =>
    api<{ parsed: number; badLines: number[]; results: ProxyImportResult[] }>("/dragonite-proxies/import", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createProxy: (body: { name: string; address: string; user: string; password: string; stacks: string[]; enabled: boolean; reload: boolean }) =>
    api<{ results: ProxyImportResult[] }>("/dragonite-proxies/create", { method: "POST", body: JSON.stringify(body) }),
  copyProxies: (keys: string[], to: string[]) =>
    api<{ results: ProxyImportResult[]; missing: number }>("/dragonite-proxies/copy", { method: "POST", body: JSON.stringify({ keys, to }) }),
  setProxyEnabled: (stack: string, id: number, on: boolean) =>
    api<{ ok: true }>(`/dragonite-proxies/${encodeURIComponent(stack)}/${id}/${on ? "enable" : "disable"}`, { method: "POST" }),
  deleteProxy: (stack: string, id: number) =>
    api<{ ok: true }>(`/dragonite-proxies/${encodeURIComponent(stack)}/${id}`, { method: "DELETE" }),
  geofences: () => api<StackGeofences[]>("/dragonite-geofences"),
  dragoniteAreas: (id: string) => api<DragoniteAreas>(`/dragonite/${encodeURIComponent(id)}/areas`),
  setAreaEnabled: (id: string, area: number, on: boolean) =>
    api<{ ok: true }>(`/dragonite/${encodeURIComponent(id)}/areas/${area}/${on ? "enable" : "disable"}`, { method: "POST" }),
  createArea: (body: { stacks: string[]; enabledIn?: string; area: Record<string, unknown> }) =>
    api<{ results: { stack: string; id?: number; enabled?: boolean; error?: string }[] }>("/dragonite-areas/create", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  transferArea: (id: string, area: number, body: { to: string; name: string; mode: "copy" | "move"; enable: boolean }) =>
    api<{ id: number; steps: string[] }>(`/dragonite/${encodeURIComponent(id)}/areas/${area}/transfer`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  unboundModes: (id: string) => api<UnboundModes>(`/dragonite/${encodeURIComponent(id)}/modes`),
  unboundMode: (id: string, type: UnboundModeType, mode: number) =>
    api<UnboundModeDetail>(`/dragonite/${encodeURIComponent(id)}/modes/${type}/${mode}`),
  createMode: (id: string, type: UnboundModeType, body: { name: string; workers: number; route?: { lat: number; lon: number }[] }) =>
    api<{ ok: true }>(`/dragonite/${encodeURIComponent(id)}/modes/${type}`, { method: "POST", body: JSON.stringify(body) }),
  updateMode: (id: string, type: UnboundModeType, mode: number, body: { name?: string; workers?: number; route?: { lat: number; lon: number }[] }) =>
    api<{ ok: true }>(`/dragonite/${encodeURIComponent(id)}/modes/${type}/${mode}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteMode: (id: string, type: UnboundModeType, mode: number) =>
    api<{ ok: true }>(`/dragonite/${encodeURIComponent(id)}/modes/${type}/${mode}`, { method: "DELETE" }),
  copyMode: (id: string, type: UnboundModeType, mode: number, body: { to: string; name: string }) =>
    api<{ ok: true }>(`/dragonite/${encodeURIComponent(id)}/modes/${type}/${mode}/copy`, { method: "POST", body: JSON.stringify(body) }),
  levelStats: (id: string) => api<LevelStat[]>(`/dragonite/${encodeURIComponent(id)}/level`),
  scoutJobs: (id: string) => api<{ total: number; jobs: ScoutJob[] }>(`/dragonite/${encodeURIComponent(id)}/scout`),
  systemStatus: () => api<SystemStatus>("/system-status"),
  dragoniteControl: (id: string, action: "pause-limit" | "reset-limit" | "reload-proxies" | "reload-accounts" | "reload-dragonite", seconds?: number) =>
    api<{ ok: true }>(`/dragonite/${encodeURIComponent(id)}/control/${action}`, {
      method: "POST",
      ...(seconds ? { body: JSON.stringify({ seconds }) } : {}),
    }),
  rateLimits: () => api<{ id: string; name: string; rateLimit: NonNullable<DragoniteStatus["rateLimit"]> }[]>("/dragonite-rate-limits"),
  scheduler: {
    schedules: (id: string) => api<ScheduleOut[]>(`/dragonite/${encodeURIComponent(id)}/scheduler/schedules`),
    groups: (id: string) => api<GroupOut[]>(`/dragonite/${encodeURIComponent(id)}/scheduler/groups`),
    runs: (id: string, scheduleId?: number) =>
      api<SchedRun[]>(`/dragonite/${encodeURIComponent(id)}/scheduler/runs${scheduleId ? `?schedule_id=${scheduleId}` : ""}`),
    active: (id: string) => api<SchedActivity>(`/dragonite/${encodeURIComponent(id)}/scheduler/active`),
    areas: (id: string) => api<SchedArea[]>(`/dragonite/${encodeURIComponent(id)}/scheduler/areas`),
    diagnostics: (id: string) => api<SchedDiagnostics>(`/dragonite/${encodeURIComponent(id)}/scheduler/diagnostics`),
    saveSchedule: (id: string, doc: ScheduleDoc, sid?: number) =>
      api<ScheduleOut>(`/dragonite/${encodeURIComponent(id)}/scheduler/schedules${sid ? `/${sid}` : ""}`, { method: sid ? "PUT" : "POST", body: JSON.stringify(doc) }),
    deleteSchedule: (id: string, sid: number) => api<unknown>(`/dragonite/${encodeURIComponent(id)}/scheduler/schedules/${sid}`, { method: "DELETE" }),
    setEnabled: (id: string, sid: number, on: boolean) =>
      api<ScheduleOut>(`/dragonite/${encodeURIComponent(id)}/scheduler/schedules/${sid}/${on ? "enable" : "disable"}`, { method: "POST" }),
    saveGroup: (id: string, doc: GroupDoc, gid?: number) =>
      api<GroupOut>(`/dragonite/${encodeURIComponent(id)}/scheduler/groups${gid ? `/${gid}` : ""}`, { method: gid ? "PUT" : "POST", body: JSON.stringify(doc) }),
    deleteGroup: (id: string, gid: number) => api<unknown>(`/dragonite/${encodeURIComponent(id)}/scheduler/groups/${gid}`, { method: "DELETE" }),
    runNow: (id: string, body: { schedule_id: number; action_idx: number; area_id: number }) =>
      api<{ status: string; fire_at: string }>(`/dragonite/${encodeURIComponent(id)}/scheduler/runs`, { method: "POST", body: JSON.stringify(body) }),
    questMigration: (id: string, dryRun: boolean, pastMinutes: number) =>
      api<QuestMigration>(`/dragonite/${encodeURIComponent(id)}/scheduler/quest-migration?dry_run=${dryRun}&past_minutes=${pastMinutes}`, { method: "POST" }),
    reload: (id: string) => api<{ ok: true }>(`/dragonite/${encodeURIComponent(id)}/reload`, { method: "POST" }),
  },
  clearScoutQueue: (id: string) => api<{ ok: true }>(`/dragonite/${encodeURIComponent(id)}/scout/clear`, { method: "POST" }),
  updateArea: (id: string, area: number, patch: Record<string, unknown>) =>
    api<DragoniteArea>(`/dragonite/${encodeURIComponent(id)}/areas/${area}`, { method: "PATCH", body: JSON.stringify(patch) }),
  accountStats: (id: string) => api<AccountCounts>(`/dragonite/${encodeURIComponent(id)}/accounts/stats`),
  accountLevelStats: (id: string) =>
    api<AccountLevelCounts[]>(`/dragonite/${encodeURIComponent(id)}/accounts/level-stats`),
  allAccountLevels: () => api<AccountLevelCounts[]>("/dragonite-accounts/levels"),
  createAccount: (stack: string, body: { username: string; password: string; provider: string; level: number }) =>
    api<{ ok: true }>(`/dragonite/${encodeURIComponent(stack)}/accounts`, { method: "POST", body: JSON.stringify(body) }),
  importAccounts: (
    stack: string,
    body: { accounts: { username: string; password: string }[]; level: number; provider: string; last_released: number },
  ) => api<AccountImportResult>(`/dragonite/${encodeURIComponent(stack)}/accounts/import`, { method: "POST", body: JSON.stringify(body) }),
  accountDuplicates: () => api<AccountOwner[]>("/dragonite-accounts/duplicates"),
  allAccounts: (p: {
    page: number;
    perPage: number;
    sortBy: string;
    order: "asc" | "desc";
    q: string;
    stack?: string;
    inUse?: boolean;
  }) => {
    const q = new URLSearchParams({ page: String(p.page), per_page: String(p.perPage), sort_by: p.sortBy, order: p.order });
    if (p.q) q.set("q", p.q);
    if (p.stack) q.set("stack", p.stack);
    if (p.inUse !== undefined) q.set("in_use", String(p.inUse));
    return api<DragoniteAccountPage>(`/dragonite-accounts?${q}`);
  },
  accounts: (id: string, p: { page: number; perPage: number; sortBy: string; order: "asc" | "desc"; q: string }) => {
    const q = new URLSearchParams({ page: String(p.page), per_page: String(p.perPage), sort_by: p.sortBy, order: p.order });
    if (p.q) q.set("q", p.q);
    return api<DragoniteAccountPage>(`/dragonite/${encodeURIComponent(id)}/accounts?${q}`);
  },
  rotom: <T>(instanceId: string, path: string, init?: RequestInit) =>
    api<T>(`/rotom/${encodeURIComponent(instanceId)}${path}`, init),
};
