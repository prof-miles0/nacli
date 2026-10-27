// Shapes returned by RotomNG's HTTP API (see docs/RotomNG-API.md upstream),
// plus the aggregated shapes this dashboard's own API serves.

export interface CommonStats {
  message_last_received_at_ms: number;
  messages_received: number;
  bytes_received: number;
  message_last_sent_at_ms: number;
  messages_sent: number;
  bytes_sent: number;
  last_seen_at_ms?: number;
}

export interface TimeWindowedStats {
  requests_rate_over_30_seconds: number;
  requests_rate_over_1_min: number;
  requests_rate_over_5_min: number;
  requests_rate_over_15_min: number;
  request_ms_avg_over_30_seconds: number;
  request_ms_avg_over_1_min: number;
  request_ms_avg_over_5_min: number;
  request_ms_avg_over_15_min: number;
}

export interface Controller extends CommonStats {
  id: string;
  uuid: string;
  user_agent: string;
  weight: number;
  proto_major_version: number;
  proto_minor_version: number;
  account_username: string;
  account_source: string;
  connected_at_ms: number;
  worker_id?: string;
}

export interface WorkerSession extends CommonStats {
  connected_at_ms: number;
  controller?: Controller;
}

export interface Worker extends CommonStats {
  id: string;
  device_id: string;
  origin: string;
  version_code: number;
  version_name: string;
  user_agent: string;
  last_connected_at_ms: number;
  is_connected: boolean;
  is_in_use: boolean;
  platform: string;
  weight: number;
  can_be_used: boolean;
  session?: WorkerSession;
  time_windowed_stats?: TimeWindowedStats;
}

export interface Device extends CommonStats {
  id: string;
  origin: string;
  version: string;
  public_ip: string;
  worker_count: number;
  worker_in_use_count: number;
  worker_in_use_percent: number;
  worker_in_use_weight: number;
  worker_max_weight: number;
  worker_in_use_weight_percent: number;
  last_connected_at_ms: number;
  enabled: boolean;
  is_connected: boolean;
  can_be_used: boolean;
  is_in_use: boolean;
  last_memory?: { free: number; mitm: number; start: number };
  session?: CommonStats & { connected_at_ms: number };
  workers?: Worker[];
}

export interface RotomStatus {
  devices: Device[];
  controllers: Controller[];
  global_stats?: TimeWindowedStats;
}

export interface RotomConfig {
  version?: string;
  sha?: string;
  instance?: string;
  jobs?: { enable?: boolean };
  [key: string]: unknown;
}

export interface Job {
  id: string;
  description: string;
  exec: string;
}

export interface JobInstance {
  id: number;
  job_id: string;
  started_at_ms: number;
  finished_at_ms: number;
  device_id: string;
  device_origin: string;
  result: string;
  status: string;
}

// ---- Dashboard API ----

export interface InstanceSummary {
  devices: number;
  devicesConnected: number;
  devicesInUse: number;
  devicesEnabled: number;
  workers: number;
  workersConnected: number;
  workersInUse: number;
  weightInUse: number;
  weightMax: number;
  controllers: number;
  requestRate: number;
  latencyMs: number;
  /** Requests/second, by window. */
  rates: { "30s": number; "1m": number; "5m": number; "15m": number };
  latencies: { "30s": number; "1m": number; "5m": number; "15m": number };
}

export interface ProcessInfo {
  goroutines?: number;
  threads?: number;
  residentBytes?: number;
  heapBytes?: number;
  cpuSecondsTotal?: number;
  startTimeSeconds?: number;
  openFds?: number;
  goVersion?: string;
  networkRxBytes?: number;
  networkTxBytes?: number;
}

export interface WorkerResponseCount {
  method: string;
  status: string;
  error: string;
  count: number;
}

export interface InstanceMetrics {
  process: ProcessInfo;
  workerResponses: WorkerResponseCount[];
  controllersByAgent: { userAgent: string; count: number }[];
  rpcRequestsTotal?: number;
  workerAcceptsTotal?: number;
  controllerAcceptsTotal?: number;
  deviceRegistrationsTotal?: number;
  droppedResponsesTotal?: number;
}

export interface InstanceInfo {
  id: string;
  name: string;
  reachable: boolean;
  lastError?: string;
  lastPollAt?: number;
  lastSuccessAt?: number;
  latencyMs?: number;
  config?: RotomConfig;
  summary?: InstanceSummary;
  metrics?: InstanceMetrics;
}

export interface HistoryPoint {
  t: number;
  devicesConnected: number;
  workersConnected: number;
  workersInUse: number;
  controllers: number;
  requestRate: number;
  latencyMs: number;
  weightInUse: number;
  /** Worker responses per second since previous poll, by status. */
  responseRates?: Record<string, number>;
  /** Controllers rejected for lack of a free worker, per hour (Zapdos only). */
  rejectedPerHour?: number;
}

export interface MeResponse {
  authenticated: boolean;
  username?: string;
  title: string;
}

export interface AppInfo {
  title: string;
  pollIntervalMs: number;
  /** Where chart history comes from. */
  /** "zapdos" when at least one Rotom has data there (the rest use memory). */
  historySource: "zapdos" | "memory";
  /** Golbat charts available (its zapdos_instance in Zapdos, or its url for memory). */
  golbat: boolean;
  /** [golbat] has a url: the Dashboard map can ask Golbat for device locations. */
  golbatMap: boolean;
  /** Basemap for that map, from [map] in config.toml. */
  map?: { styleUrl?: string; styleUrlDark?: string; tilesUrl?: string; cartoKey?: string; attribution: string };
  /** Configured Dragonites (empty without [[dragonite]] + [zapdos]). */
  dragonite: DragoniteInfo[];
  /** Instances whose charts come from Zapdos but that sent nothing in the last 30 minutes: Zapdos may have stopped scraping them. */
  zapdosQuiet: { kind: "rotom" | "dragonite" | "golbat"; name: string; zapdosInstance: string }[];
  /** Dragonites whose metrics arrive but that handled no location in the last hour. */
  dragoniteIdle: { id: string; name: string }[];
  /** How far back Golbat's charts go (Zapdos or memory). */
  golbatHistoryMs?: number;
  /** Golbat's API and a Dragonite API are configured: per-area statistics. */
  golbatStats: boolean;
  /** How often the statistics are kept for their 24 h history (unset: no history). */
  golbatStatsHistoryMs?: number;
  /** [database] and [golbat] database are set: Golbat's database can be read. */
  golbatDb: boolean;
  /** Names from config.toml for the Help page's grants: the [database] user and each database. Never the host or password. */
  databases: { user?: string; golbat?: string; dragonite: { name: string; database: string }[] };
  /** That, plus a Dragonite API for the areas: the Spawnpoints page. */
  golbatSpawnpoints: boolean;
  instances: InstanceInfo[];
}

/** Rows tagged with the instance they came from, for cross-instance tables. */
export type Tagged<T> = T & { instanceId: string; instanceName: string };

export interface MergedStatus {
  devices: Tagged<Device>[];
  workers: Tagged<Worker>[];
  controllers: Tagged<Controller>[];
}

// ---- Golbat ----

export interface GolbatPanelMeta {
  id: string;
  row: string;
  title: string;
  areaAware: boolean;
  kind: "line" | "bars";
  stacked?: boolean;
  unit?: "minutes" | "seconds" | "percent";
}

export interface GolbatMeta {
  intervals: string[];
  areas: string[];
  panels: GolbatPanelMeta[];
}

export interface GolbatSeries {
  name: string;
  points: { t: number; v: number }[];
  /** Plotted against a second Y axis on the right. */
  axis?: "right";
}

export interface GolbatPanelData {
  start: number;
  end: number;
  stepMs: number;
  series: GolbatSeries[];
}

export interface GolbatSummary {
  pokemonNew: number;
  pokemonIv: number;
  hundos: number;
  shinies: number;
  raids: number;
  rawOk: number;
  rawErrors: number;
  ttlMinutes?: number;
  workerBacklog?: number;
  rawWaiting?: number;
  writeQueue?: number;
  lastSeenS?: number;
}

/** Golbat and Dragonite charts share the panel format. */
export type VmPanelMeta = GolbatPanelMeta;
export type VmPanelData = GolbatPanelData;

// ---- Dragonite ----

export interface DragoniteInfo {
  id: string;
  name: string;
  /** RotomNG instance id it is configured to feed (`rotom` in config.toml). */
  rotom?: string;
  /** Its API is configured (`api_url`), so the accounts page can read it. */
  accounts: boolean;
  /** How far back its own charts go (0: no charts for it). */
  historyMs: number;
  /** Its charts come from Zapdos (else from memory). */
  fromVm: boolean;
  /** Its database is set ([database] + database in [stack.dragonite]). */
  database: boolean;
}

/** Whether Nacli can read a Dragonite's database (sidebar mark). */
export interface DragoniteDbCheck {
  id: string;
  name: string;
  ok: boolean;
  ms?: number;
  error?: string;
  /** The server takes the login but not this database or its tables (else: unreachable or login refused). */
  denied?: boolean;
}

export interface DragoniteMeta {
  rows: string[];
  areas: string[];
  /** The areas of each stack (Dragonite id). */
  areasByStack?: Record<string, string[]>;
  panels: VmPanelMeta[];
}

export interface DragoniteStats {
  id: string;
  version?: string;
  lastSeenS?: number;
  locations: number;
  locationSeconds?: number;
  rpcOkPct?: number;
  gmoOkPct?: number;
  accountsOk: number;
  accountsLimited: number;
  noWorkers: number;
  invasions: number;
}

export interface DragoniteSummary {
  instances: (DragoniteStats & {
    name: string;
    rotom?: string;
    /** Rotoms where controllers of this Dragonite are connected right now. */
    links: { rotomId: string; controllers: number }[];
  })[];
  /** Controllers from a Dragonite that no [[dragonite]] entry matches. */
  unmatched: { rotomId: string; source: string; controllers: number }[];
}

/** Account counts by status; the status keys add up to `total`. */
export interface AccountCounts {
  total: number;
  good: number;
  in_use: number;
  disabled: number;
  provider_disabled: number;
  cooldown: number;
  warned: number;
  suspended: number;
  banned: number;
  auth_banned: number;
  invalid: number;
  missing_token: number;
  zero_last_released: number;
}

export interface AccountLevelCounts extends AccountCounts {
  level: number;
  /** Accounts of this level in each stack (Dragonite id), when several are combined. */
  byStack?: Record<string, number>;
}

/** One account as the panel shows it (no password, email or tokens). */
/** A username and the stacks that have it (more than one is a problem). */
export interface AccountOwner {
  username: string;
  stacks: string[];
}

/** What an import did: Dragonite's count plus what Nacli left out. */
export interface AccountImportResult {
  inserted: number;
  /** Already in this stack (Dragonite skips them). */
  alreadyHere: number;
  /** Repeated within the list itself. */
  repeated: number;
  /** In another stack: not imported, since an account belongs to one stack. */
  elsewhere: AccountOwner[];
}

export interface DragoniteAccount {
  username: string;
  provider: string;
  level: number;
  warn: boolean;
  warn_expiration: number | null;
  suspended: boolean;
  banned: boolean;
  invalid: boolean;
  auth_banned: number | null;
  disabled: boolean;
  in_use: boolean;
  valid_refresh_token: boolean;
  last_selected: number | null;
  last_released: number | null;
  last_disabled: number | null;
  last_banned: number | null;
  last_suspended: number | null;
  last_refreshed: number | null;
  consecutive_disabled: number | null;
  /** The stack (Dragonite id) it belongs to, in the combined list. */
  stack?: string;
}

/** How a move of accounts to another stack went, per stack they came from. */
export interface AccountMoveResult {
  results: { stack: string; moved: number; inUse: number; inTarget: number; missing: number; error?: string }[];
  /** The Dragonites told to reload their accounts (sources with moves, then the target). */
  reloads: { stack: string; error?: string }[];
}

export interface DragoniteAccountPage {
  total: number;
  pages: number;
  rows: DragoniteAccount[];
  /** How many of the listed accounts are in each state, with every filter but ?status= applied. */
  states?: Partial<Record<AccountState, number>>;
  /** The same for ?token= ("valid" or "none") … */
  tokens?: Partial<Record<AccountToken, number>>;
  /** … and for ?provider= (lowercase, e.g. "ptc"). */
  providers?: Record<string, number>;
}

/** Whether Dragonite holds a refresh token it can still log in with (the Token column). */
export type AccountToken = "valid" | "none";
export const accountToken = (a: DragoniteAccount): AccountToken => (a.valid_refresh_token ? "valid" : "none");

/** The one state that best describes an account, worst first (as its Status column shows). */
export type AccountState = "banned" | "auth_banned" | "invalid" | "suspended" | "warned" | "disabled" | "in_use" | "available";

export function accountState(a: DragoniteAccount): AccountState {
  if (a.banned) return "banned";
  if (a.auth_banned) return "auth_banned";
  if (a.invalid) return "invalid";
  if (a.suspended) return "suspended";
  if (a.warn) return "warned";
  if (a.disabled) return "disabled";
  if (a.in_use) return "in_use";
  return "available";
}

export interface DragoniteLiveWorker {
  name: string;
  deviceId: string;
  account: string;
  mode: string;
  task?: { name: string; pos: number; total: number; part: number; seconds: number };
  /** Unix seconds. */
  lastData: number;
  status: string;
  /** The Rotom device running it, matched by worker id. */
  /** Its device, found in the stack's own RotomNG: that instance, the device's name and its id there. */
  rotom?: { rotomId: string; device: string; deviceId: string };
}

export interface DragoniteLiveGroup {
  expected: number;
  active: number;
  workers: DragoniteLiveWorker[];
}

export interface DragoniteArea {
  id: number;
  name: string;
  enabled: boolean;
  timezone?: string;
  pokemon: { enabled: boolean; workers: number; routePoints: number; scout: boolean; invasion: boolean };
  quest: { enabled: boolean; workers: number; routePoints: number; hours: number[] };
  fort: { enabled: boolean; workers: number; prioRaid: boolean; showcase: boolean; invasion: boolean };
  rare: { enabled: boolean; workers: number; permyriad: number };
  live?: DragoniteLiveGroup;
}

export interface DragoniteAreas {
  areas: DragoniteArea[];
  /** Modes not tied to an area (e.g. Rocket invasions). */
  unbounds: (DragoniteLiveGroup & { name: string })[];
  queues: { name: string; size: number }[];
}

/** What Golbat sees in one area right now. */
export interface AreaStatsCounts {
  /** As Dragonite's admin dashboard counts them: stops with an AR / non-AR quest, of all stops. */
  quests: { ar: number; noAr: number; stops: number };
  pokemon: { active: number; withIv: number; hundo: number; shiny: number };
  invasions: { grunts: number; leaders: number; giovanni: number; decoys: number; golden: number; kecleon: number };
  stops: { total: number; lures: number };
  gyms: { total: number; raids: number; eggs: number };
  stations: { active: number; battles: number };
}

/** One Dragonite area's statistics from Golbat, or why they are missing. */
export interface AreaStats {
  stack: string;
  stackName: string;
  rotom?: string;
  areaId: number;
  area: string;
  stats?: AreaStatsCounts;
  /** Golbat cut a list at its result limit: the counts are a lower bound. */
  partial?: boolean;
  error?: string;
}

/** Quests Golbat has in each area of a stack, by area id (Areas page). */
export type AreaQuests = Record<number, { ar: number; noAr: number; stops: number } | { error: string }>;

/** The statistics over the last 24 h: the totals, or one area. */
export interface AreaStatsHistory {
  intervalMs: number;
  points: { t: number; stats: AreaStatsCounts }[];
}

/** Spawnpoints Golbat keeps in its database: how many, with a known despawn time, and how recently seen. */
export interface SpawnpointCounts {
  total: number;
  /** With despawn_sec: Golbat has seen the exact time they despawn. */
  known: number;
  /** Last seen within the day, the week, the month (30 days), or before (each one excludes the previous). */
  seen24h: number;
  seen7d: number;
  seen30d: number;
  older: number;
}

/** Every stack's areas with their spawnpoints (Spawnpoints page). */
export interface SpawnpointOverview {
  checkedAt: number;
  /**
   * One entry per area; an area with the same name and geofence in several
   * stacks is one entry listing them all in `stacks`. `stack` and `id` are the
   * copy to read it from (an active one when there is one); `enabled` is true
   * when it is active in any of them.
   */
  areas: {
    stack: string;
    id: number;
    name: string;
    enabled: boolean;
    stacks: { stack: string; id: number; enabled: boolean }[];
    counts?: SpawnpointCounts;
    error?: string;
  }[];
  /** Stacks whose areas could not be read from Dragonite. */
  errors: { stack: string; error: string }[];
  /** Each spawnpoint once, though it may lie in several areas. */
  totals: SpawnpointCounts;
}

/**
 * Encounters with and without a verified despawn time, and Pokémon scanned
 * and with IV, from Golbat's pokemon_area_stats (read every 5 minutes, kept
 * 90 days), for one of Golbat's areas ("world" is all of them) or one fence.
 */
export interface EncounterHistory {
  /** Golbat's areas and their fences, as its geofences name them. */
  areas: { area: string; fences: string[] }[];
  /**
   * pokemon: every one scanned (totMon); iv: those with IV (ivMon); tth:
   * encounters by minutes left until despawn, under 5, 5-10 … 50-55, over 55.
   */
  points: { t: number; verified: number; unverified: number; pokemon: number; iv: number; tth: number[] }[];
  /** The oldest sample kept (none yet: undefined). */
  since?: number;
  /** The newest sample kept: when it is older than the range, the range shows nothing. */
  last?: number;
}

/** What the Spawnpoints tool deletes: every condition given must hold. */
export interface SpawnpointDeleteRequest {
  /** "area": the area `area` ("stack:areaId"); "areas": inside any area; "outside": outside every area. */
  where: "area" | "areas" | "outside";
  area?: string;
  /** Last seen more than this many days ago (unset: any time). */
  olderThanDays?: number;
  despawn: "any" | "known" | "unknown";
  /** Only count them. */
  dryRun?: boolean;
  /** When deleting: the count the preview showed; a different one now refuses. */
  expect?: number;
}

/** One area's spawnpoints for the map: [lat, lon, despawn second of the hour or -1, last seen unix s]. */
export interface SpawnpointMap {
  checkedAt: number;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
  points: [number, number, number, number][];
}

export interface AreaStatsResponse {
  checkedAt: number;
  areas: AreaStats[];
  totals: AreaStatsCounts;
}

/** An enabled area's outline, for the Dashboard map. */
export interface AreaGeofence {
  id: number;
  name: string;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
}

/** One stack's enabled areas, drawn in its Rotom's colour. */
export interface StackGeofences {
  id: string;
  name: string;
  /** Its Rotom instance, whose colour the stack wears. */
  rotom?: string;
  areas: AreaGeofence[];
  error?: string;
}

export type UnboundModeType = "level" | "invasion" | "scout";

/** A Level, Invasion or Scout mode: not tied to an area. */
export interface UnboundMode {
  type: UnboundModeType;
  id: number;
  name: string;
  workers: number;
  /** Level mode only: how many points its route has. */
  routePoints?: number;
  /** Its workers right now, from /status (matched by name). */
  live?: DragoniteLiveGroup;
}

export interface UnboundModes {
  modes: UnboundMode[];
  scoutQueue: { total: number; fulfilled: number; failed: number; pending: number };
}

/** One point in the scout queue. Times are Unix seconds; fulfilled is 0 while pending, -1 if it failed. */
export interface ScoutJob {
  id: number;
  lat: number;
  lon: number;
  requested: number;
  fulfilled: number;
  /** The account that scouted it. */
  account: string;
}

/** One account in level mode: where it started and where it is now (time in Unix seconds). */
export interface LevelStat {
  account: string;
  status: string;
  level: { start: number; last: number };
  xp: { start: number; last: number };
  time: { start: number; last: number };
  error?: string;
  /** More counters, each from when it started levelling to now. */
  stats: Record<string, { start: number; last: number }>;
  extra: Record<string, string | number | boolean>;
}

/** One mode with its route, to edit or copy it. */
export interface UnboundModeDetail {
  id: number;
  name: string;
  workers: number;
  route?: { lat: number; lon: number }[];
}

/** One device on the Dashboard map: Golbat's last location plus who it is. */
export interface MapDevice {
  /** Rotom worker id, as Golbat and Dragonite report it. */
  id: string;
  lat: number;
  lon: number;
  /** Unix ms of Golbat's last data from it. */
  lastUpdate: number;
  scanContext: string;
  rotom?: { instanceId: string; device: string; connected: boolean };
  /** Dragonite's view of it: its area and mode, and the controller's name there. */
  dragonite?: { id: string; name: string; area: string; controller: string; mode: string };
  /**
   * The controller on this Rotom worker (e.g. "Barakaldo_04", its id in
   * Rotom): what the map follows, since a controller can move between workers.
   */
  controller?: string;
  /** Set when no controller is on it now: `controller` is the last one seen, until this time (ms). */
  controllerLeftAt?: number;
  /**
   * No controller is on this Rotom worker and its last one now runs on the
   * Rotom worker given here (or "unknown" when it is not known who left it): the
   * point is a position a controller has left, so the map does not show it.
   */
  relocatedTo?: string;
}

/** One position on a controller's trail (Golbat's location at time t, ms). */
export interface MapTrailPoint {
  t: number;
  lat: number;
  lon: number;
}

// ---- Dragonite proxies (credentials never leave the server) ----

export interface ProxyInstance {
  stack: string;
  /** Its id in that Dragonite's database; absent for one from its config file. */
  id?: number;
  name: string;
  enabled: boolean;
  /** Login state per auth provider (ptc…), from /proxies/stats. */
  providers: { provider: string; good: boolean; lastStatus: string; lastSuccess?: number }[];
}

export interface ProxyEntry {
  /** Stable id of host:port + user, for the actions on it. */
  key: string;
  endpoint: string;
  /** It has a username and password (not shown). */
  auth: boolean;
  instances: ProxyInstance[];
}

export interface ProxyStackSummary {
  stack: string;
  total: number;
  enabled: number;
  good: number;
  failing: number;
  error?: string;
}

export interface DragoniteProxies {
  stacks: ProxyStackSummary[];
  proxies: ProxyEntry[];
}

export interface ProxyImportResult {
  stack: string;
  created: number;
  skipped: number;
  reloaded: boolean;
  /** Names that stack already uses for another proxy, so those were not copied. */
  conflicts?: string[];
  error?: string;
}

// ---- Dragonite scheduler (as Dragonite's API has it) ----

export interface SchedWindow {
  /** HH:MM, area-local. */
  at: string;
  /** Go duration ("8h", "90m"); absent = an instant fire point. */
  for?: string;
  /** sun..sat or ranges like mon-fri; empty = every day. */
  days?: string[];
}

export interface SchedAction {
  kind: "state" | "job" | string;
  type?: string;
  op?: string;
  set?: number | null;
  delta?: number | null;
  value?: boolean | string;
  params?: Record<string, string>;
  at?: string;
  on_missed?: string;
  windows?: SchedWindow[];
}

export interface ScheduleDoc {
  name: string;
  enabled?: boolean;
  schedule_kind: "recurring" | "dated" | "manual" | string;
  priority?: number;
  tz?: string;
  windows?: SchedWindow[];
  dates?: string[];
  expires_at?: string | null;
  targets?: { groups?: string[]; areas?: string[]; exclude?: string[] };
  actions: SchedAction[];
}

export interface ScheduleOut {
  id: number;
  name: string;
  enabled: boolean;
  priority: number;
  /** "config" (seeded, replaces the old crons) or "api". */
  source: string;
  document: ScheduleDoc;
}

export interface GroupDoc {
  name: string;
  areas?: { area: string; attributes?: string[] }[];
  pools?: { pool: string }[];
}

export interface GroupOut {
  id: number;
  name: string;
  document: GroupDoc;
}

export interface SchedRun {
  id: number;
  schedule_id: number;
  action_idx: number;
  target_key: string;
  fire_at: string;
  started_at?: string;
  finished_at?: string;
  outcome: "pending" | "success" | "error" | "skipped" | string;
  kind: string;
  summary: string;
  detail?: string;
  area_id?: number;
  area_name?: string;
  schedule_name?: string;
  pool_type?: string;
  slot?: string;
  worker_type?: string;
}

/** One page of the run ledger, filtered and counted on Nacli's server. */
export interface SchedRunPage {
  runs: SchedRun[];
  /** Runs matching every filter, across all pages. */
  total: number;
  /** Per outcome, among the runs matching the other filters (for the outcome filter). */
  counts: Record<string, number>;
  /** Where the next page starts; null on the last. */
  next: number | null;
  /** Whether Dragonite's list was full (it keeps the newest 1000). */
  capped: boolean;
}

interface Attribution {
  schedule_id: number;
  schedule_name: string;
}

export interface SchedAreaActivity {
  name?: string;
  workers?: Record<string, { baseline: number; effective: number } & Attribution>;
  paused?: Record<string, Attribution>;
  route_mode?: { mode: string } & Attribution;
}

export interface SchedActivity {
  tick_at: string;
  schedules: { id: number; name: string }[];
  areas: Record<string, SchedAreaActivity>;
  pools: Record<string, { scale?: Record<string, { baseline: number; effective: number } & Attribution>; paused?: Attribution }>;
}

export interface SchedArea {
  id: number;
  name: string;
  timezone: string;
  has_geofence: boolean;
  timezone_source?: string;
}

export interface SchedProblem {
  severity: "error" | "warning" | string;
  code: string;
  message: string;
  schedule_id?: number;
  schedule_name?: string;
  group_id?: number;
  group_name?: string;
}

export interface SchedDiagnostics {
  checked_at: string;
  schedules_loaded_at?: string;
  areas_loaded_at?: string;
  problems: SchedProblem[];
}

export interface QuestMigration {
  dry_run: boolean;
  reload_triggered?: boolean;
  migrated: { schedule: string; target: string; group?: string; first_hour: number; check_hours: number[]; minute: number; areas: string[]; excluded?: string[] }[];
  skipped: { schedule: string; areas: string[]; reason: string }[];
}

// ---- Status page ----

export interface DragoniteRateEvent {
  /** Unix seconds of the decrease. */
  at: number;
  reason: string;
  allowedPerSecond: number;
  ratio: number;
}

export interface DragoniteStatus {
  id: string;
  name: string;
  rotom?: string;
  /** Its API answered /config/ just now. */
  reachable: boolean;
  error?: string;
  latencyMs?: number;
  version?: string;
  gitSha?: string;
  hasKoji?: boolean;
  /** testing or stable, from the version's suffix. */
  channel?: "testing" | "stable";
  /** On the stable channel: a newer version out only on testing. */
  testing?: string;
  /** Newest version on its channel, when it is newer than the running one. */
  update?: string;
  rateLimit?: {
    allowedPerSecond: number;
    ratio: number;
    lastDecreaseAt?: number;
    lastDecreaseReason: string;
    lastRecoveryAt?: number;
    waiters: number;
    pauseSecondsRemaining?: number;
  };
  /** Rate-limit drops seen while Nacli has been running, newest first. */
  rateEvents: DragoniteRateEvent[];
  /** Data Dragonite sends to Golbat: whether it has a target, and what it threw away in the last 15 min by reason. */
  golbat?: { configured: boolean; discarded: Record<string, number> };
}

export interface SystemStatus {
  checkedAt: number;
  releases?: { stable?: string; testing?: string; checkedAt: number; error?: string };
  dragonite: DragoniteStatus[];
  golbat?: {
    metrics: boolean;
    lastSeenS?: number;
    rawOk?: number;
    rawErrors?: number;
    api: boolean;
    apiOk?: boolean;
    /** How long its /api/health took. */
    apiLatencyMs?: number;
    apiError?: string;
  };
  /** Zapdos (its VictoriaMetrics): whether it answers, and which instances it has data for. */
  zapdos: {
    configured: boolean;
    /** Some charts come from the history kept in memory. */
    local: boolean;
    health?: { ok: boolean; latencyMs?: number; error?: string };
    /** Each instance with a zapdos_instance: whether Zapdos has its data (unknown before the first check). */
    /** quiet: data in Zapdos, but none in the last 30 minutes. */
    instances: { kind: "rotom" | "dragonite" | "golbat"; name: string; zapdosInstance: string; hasData?: boolean; quiet?: boolean }[];
  };
  /** RotomNG on GitHub: newest stable and newest of all (pre-releases included). */
  rotomReleases?: { stable?: string; latest?: string; checkedAt: number; error?: string };
  /** Each Rotom's version against those. */
  rotom: { id: string; name: string; version?: string; update?: string; preRelease?: string }[];
}
