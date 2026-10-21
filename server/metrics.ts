import type { InstanceMetrics } from "../shared/types.ts";

export interface Sample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const LINE_RE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)/;
const LABEL_RE = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

/** Parses the Prometheus text exposition format (enough of it for RotomNG). */
export function parsePrometheus(text: string): Sample[] {
  const out: Sample[] = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const labels: Record<string, string> = {};
    if (m[2]) {
      for (const l of m[2].matchAll(LABEL_RE)) {
        labels[l[1]] = l[2].replace(/\\(.)/g, "$1");
      }
    }
    out.push({ name: m[1], labels, value: Number(m[3]) });
  }
  return out;
}

const P = "rotom_ng_";

export function summarizeMetrics(samples: Sample[]): InstanceMetrics {
  const one = (name: string) => samples.find((s) => s.name === P + name)?.value;
  const sum = (name: string) => {
    const matches = samples.filter((s) => s.name === P + name);
    return matches.length ? matches.reduce((a, s) => a + s.value, 0) : undefined;
  };

  return {
    process: {
      goroutines: one("go_goroutines"),
      threads: one("go_threads"),
      residentBytes: one("process_resident_memory_bytes"),
      heapBytes: one("go_memstats_heap_inuse_bytes"),
      cpuSecondsTotal: one("process_cpu_seconds_total"),
      startTimeSeconds: one("process_start_time_seconds"),
      openFds: one("process_open_fds"),
      goVersion: samples.find((s) => s.name === `${P}go_info`)?.labels.version,
      networkRxBytes: one("process_network_receive_bytes_total"),
      networkTxBytes: one("process_network_transmit_bytes_total"),
    },
    workerResponses: samples
      .filter((s) => s.name === `${P}worker_responses_total`)
      .map((s) => ({
        method: s.labels.method ?? "",
        status: s.labels.status ?? "",
        error: s.labels.error ?? "",
        count: s.value,
      })),
    controllersByAgent: samples
      .filter((s) => s.name === `${P}controller_connections`)
      .map((s) => ({ userAgent: s.labels.user_agent ?? "", count: s.value })),
    rpcRequestsTotal: one("rpc_requests_total"),
    workerAcceptsTotal: one("worker_accepts_total"),
    controllerAcceptsTotal: one("controller_accepts_total"),
    deviceRegistrationsTotal: sum("device_registrations_total"),
    droppedResponsesTotal: one("worker_dropped_responses_total"),
  };
}

/** Total worker responses by status, used to derive per-poll rates. */
export function responsesByStatus(m: InstanceMetrics): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of m.workerResponses) out[r.status] = (out[r.status] ?? 0) + r.count;
  return out;
}
