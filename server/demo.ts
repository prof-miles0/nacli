// Synthetic RotomNG data for `demo://` instances, shaped like real replies,
// so the dashboard can be previewed without network access to an instance.

import type { Controller, Device, RotomStatus, Worker } from "../shared/types.ts";

const ORIGINS = ["Galilei", "Bohr", "Curie", "Tesla", "Newton", "Kepler", "Hopper", "Noether"];
const AREAS = ["Durangaldea", "Pinto", "Cabanillas del Campo", "Bilbao", "Getxo", "Leioa", "Barakaldo"];
const ACCOUNTS = ["GloriasFuertes", "TrainerAitor", "MiloPoke", "Txapela42", "LunaRota"];

interface DemoState {
  seed: number;
  started: number;
  devices: number;
  workersPerDevice: number;
  disabled: Set<number>;
  responses: Record<string, number>;
  lastTick: number;
}

const states = new Map<string, DemoState>();

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uuid(r: () => number): string {
  const h = () => Math.floor(r() * 16).toString(16);
  const part = (n: number) => Array.from({ length: n }, h).join("");
  return `${part(8)}-${part(4)}-${part(4)}-${part(4)}-${part(12)}`;
}

function state(key: string): DemoState {
  let s = states.get(key);
  if (!s) {
    const seed = hash(key);
    const r = rng(seed);
    s = {
      seed,
      started: Date.now() - Math.floor(r() * 5 * 86_400_000),
      devices: 3 + Math.floor(r() * 5),
      workersPerDevice: 6,
      disabled: new Set(),
      responses: { SUCCESS: 40_000 + Math.floor(r() * 10_000), ERROR_RECONNECT: 120, ERROR_TIMEOUT: 30 },
      lastTick: Date.now(),
    };
    states.set(key, s);
  }
  return s;
}

export function demoConfig(key: string) {
  return {
    version: "1.0.0",
    sha: "118d562d414f0b84815d2dd2c535b684781b302a",
    instance: key,
    tuning: { profiling: false },
    device_listener: { ping_interval: "30s", pong_wait: "30s" },
    controller_listener: {
      data_timeout: "2m0s",
      ping_interval: "30s",
      pong_wait: "30s",
      registration_timeout: "1m0s",
    },
    jobs: { enable: true },
  };
}

export function demoStatus(key: string, name: string): RotomStatus {
  const s = state(key);
  const r = rng(s.seed);
  const now = Date.now();
  // Slow drift so charts have something to show.
  const wave = Math.sin(now / 600_000 + (s.seed % 10));
  const jitter = () => 0.9 + Math.random() * 0.2;

  const devices: Device[] = [];
  const controllers: Controller[] = [];
  let totalRate = 0;
  let totalLatency = 0;

  for (let d = 0; d < s.devices; d++) {
    const id = uuid(r);
    const origin = `${ORIGINS[(s.seed + d) % ORIGINS.length]}${d > 6 ? ` (${d})` : ""}`;
    const connected = !(d === s.devices - 1 && wave < -0.7);
    const enabled = !s.disabled.has(d);
    const workers: Worker[] = [];
    const connectedAt = now - Math.floor(r() * 6 * 3_600_000);

    for (let w = 0; w < s.workersPerDevice; w++) {
      const workerId = `${id}_${String(w + 1).padStart(3, "0")}`;
      const inUse = connected && enabled && r() > 0.12 + wave * 0.08;
      const rate = inUse ? (0.55 + r() * 0.3) * jitter() : 0;
      const latency = inUse ? (220 + r() * 180) * jitter() : 0;
      totalRate += rate;
      totalLatency += latency * rate;
      const area = AREAS[Math.floor(r() * AREAS.length)];
      const ctrl: Controller | undefined = inUse
        ? {
            id: `${area}_${String(1 + Math.floor(r() * 9)).padStart(2, "0")}`,
            uuid: uuid(r),
            user_agent: `Dragonite/1.20.16-testing (Dragonite - ${name})`,
            weight: 3,
            proto_major_version: 1,
            proto_minor_version: 0,
            account_username: ACCOUNTS[Math.floor(r() * ACCOUNTS.length)] + Math.floor(r() * 99),
            account_source: "PTC_OAUTH",
            connected_at_ms: now - Math.floor(r() * 3_600_000),
            message_last_received_at_ms: now - Math.floor(r() * 3000),
            messages_received: Math.floor(r() * 400),
            bytes_received: Math.floor(r() * 40_000),
            message_last_sent_at_ms: now - Math.floor(r() * 3000),
            messages_sent: Math.floor(r() * 400),
            bytes_sent: Math.floor(r() * 700_000),
            last_seen_at_ms: now - Math.floor(r() * 2000),
            worker_id: workerId,
          }
        : undefined;
      if (ctrl) controllers.push(ctrl);
      workers.push({
        id: workerId,
        device_id: id,
        origin,
        version_code: 300269,
        version_name: "",
        user_agent: "",
        last_connected_at_ms: connectedAt,
        last_seen_at_ms: now - Math.floor(r() * 2000),
        message_last_received_at_ms: now - Math.floor(r() * 2000),
        messages_received: Math.floor(r() * 5000),
        bytes_received: Math.floor(r() * 4_000_000),
        message_last_sent_at_ms: now - Math.floor(r() * 2000),
        messages_sent: Math.floor(r() * 5000),
        bytes_sent: Math.floor(r() * 90_000),
        is_connected: connected,
        is_in_use: inUse,
        platform: "UNSET",
        weight: 3,
        can_be_used: connected && enabled,
        session: connected
          ? {
              connected_at_ms: connectedAt,
              message_last_received_at_ms: now,
              messages_received: Math.floor(r() * 300),
              bytes_received: Math.floor(r() * 300_000),
              message_last_sent_at_ms: now,
              messages_sent: Math.floor(r() * 300),
              bytes_sent: Math.floor(r() * 9000),
              controller: ctrl,
            }
          : undefined,
        time_windowed_stats: {
          requests_rate_over_30_seconds: rate,
          requests_rate_over_1_min: rate * 1.02,
          requests_rate_over_5_min: rate * 0.98,
          requests_rate_over_15_min: rate * 0.97,
          request_ms_avg_over_30_seconds: latency,
          request_ms_avg_over_1_min: latency * 1.01,
          request_ms_avg_over_5_min: latency * 1.03,
          request_ms_avg_over_15_min: latency * 1.05,
        },
      });
    }

    const inUseCount = workers.filter((w) => w.is_in_use).length;
    devices.push({
      id,
      origin,
      version: "300269",
      public_ip: "0.0.0.0",
      worker_count: workers.length,
      worker_in_use_count: inUseCount,
      worker_in_use_percent: (inUseCount / workers.length) * 100,
      worker_in_use_weight: inUseCount * 3,
      worker_max_weight: 60,
      worker_in_use_weight_percent: ((inUseCount * 3) / 60) * 100,
      last_connected_at_ms: connectedAt,
      last_seen_at_ms: connected ? now - 1000 : now - 900_000,
      message_last_received_at_ms: now - 30_000,
      messages_received: 50_000 + Math.floor(r() * 5000),
      bytes_received: 4_400_000 + Math.floor(r() * 100_000),
      message_last_sent_at_ms: now - 30_000,
      messages_sent: 50_000 + Math.floor(r() * 5000),
      bytes_sent: 2_700_000 + Math.floor(r() * 100_000),
      enabled,
      is_connected: connected,
      can_be_used: connected && enabled,
      is_in_use: inUseCount > 0,
      last_memory: { free: 3_000_000 + Math.floor(r() * 1_000_000), mitm: 61_000 + Math.floor(r() * 5000), start: 9377 },
      session: connected
        ? {
            connected_at_ms: connectedAt,
            message_last_received_at_ms: now - 30_000,
            messages_received: 298,
            bytes_received: 24_353,
            message_last_sent_at_ms: now - 30_000,
            messages_sent: 297,
            bytes_sent: 15_336,
          }
        : undefined,
      workers,
    });
  }

  // Advance cumulative counters for the Prometheus view.
  const dt = (now - s.lastTick) / 1000;
  s.lastTick = now;
  s.responses.SUCCESS += Math.round(totalRate * dt * 0.97);
  s.responses.ERROR_RECONNECT += Math.round(totalRate * dt * 0.02);
  s.responses.ERROR_TIMEOUT += Math.round(totalRate * dt * 0.01);

  const latency = totalRate ? totalLatency / totalRate : 0;
  return {
    devices,
    controllers,
    global_stats: {
      requests_rate_over_30_seconds: totalRate,
      requests_rate_over_1_min: totalRate * 1.01,
      requests_rate_over_5_min: totalRate * 0.99,
      requests_rate_over_15_min: totalRate * 0.98,
      request_ms_avg_over_30_seconds: latency,
      request_ms_avg_over_1_min: latency * 1.02,
      request_ms_avg_over_5_min: latency * 1.04,
      request_ms_avg_over_15_min: latency * 1.05,
    },
  };
}

export function demoMetrics(key: string, name: string): string {
  const s = state(key);
  const lines = [
    `rotom_ng_go_goroutines ${90 + Math.floor(Math.random() * 30)}`,
    "rotom_ng_go_threads 12",
    'rotom_ng_go_info{version="go1.26.6"} 1',
    `rotom_ng_process_resident_memory_bytes ${28_000_000 + Math.floor(Math.random() * 4_000_000)}`,
    `rotom_ng_go_memstats_heap_inuse_bytes ${6_000_000 + Math.floor(Math.random() * 2_000_000)}`,
    `rotom_ng_process_cpu_seconds_total ${((Date.now() - s.started) / 1000) * 0.05}`,
    `rotom_ng_process_start_time_seconds ${s.started / 1000}`,
    "rotom_ng_process_open_fds 43",
    `rotom_ng_process_network_receive_bytes_total ${(Date.now() - s.started) * 300}`,
    `rotom_ng_process_network_transmit_bytes_total ${(Date.now() - s.started) * 290}`,
    `rotom_ng_rpc_requests_total ${s.responses.SUCCESS * 2}`,
    `rotom_ng_worker_accepts_total ${Math.floor(s.responses.SUCCESS / 2)}`,
    `rotom_ng_controller_accepts_total ${Math.floor(s.responses.SUCCESS / 3)}`,
    "rotom_ng_worker_dropped_responses_total 0",
    `rotom_ng_controller_connections{user_agent="Dragonite/1.20.16-testing (Dragonite - ${name})"} ${s.devices * 5}`,
    ...Object.entries(s.responses).map(
      ([status, n]) => `rotom_ng_worker_responses_total{error="",method="RPC",status="${status}"} ${n}`,
    ),
    `rotom_ng_worker_responses_total{error="",method="LOGIN",status="SUCCESS"} ${Math.floor(s.responses.SUCCESS / 20)}`,
  ];
  return `${lines.join("\n")}\n`;
}

export function demoToggleDevice(key: string, deviceIndex: number, enable: boolean) {
  const s = state(key);
  if (enable) s.disabled.delete(deviceIndex);
  else s.disabled.add(deviceIndex);
}
