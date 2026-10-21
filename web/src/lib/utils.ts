import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const nf0 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

export const fmt = {
  int: (n?: number) => (n == null ? "—" : nf0.format(n)),
  dec: (n?: number) => (n == null ? "—" : nf1.format(n)),
  dec2: (n?: number) => (n == null ? "—" : nf2.format(n)),
  pct: (n?: number) => (n == null || !Number.isFinite(n) ? "—" : `${nf0.format(n)}%`),
  ms: (n?: number) => (n == null ? "—" : `${nf0.format(n)} ms`),
  rate: (n?: number) => (n == null ? "—" : `${nf2.format(n)}/s`),
  bytes(n?: number) {
    if (n == null) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${nf1.format(v)} ${units[i]}`;
  },
  /** RotomNG reports device memory in KB. */
  kb: (n?: number) => (n == null ? "—" : fmt.bytes(n * 1024)),
  ago(ms?: number) {
    if (!ms) return "—";
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ${m % 60}m ago`;
    return `${Math.floor(h / 24)}d ago`;
  },
  duration(ms?: number) {
    if (ms == null || ms < 0) return "—";
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s % 60}s`;
    return `${s}s`;
  },
  time: (ms?: number) =>
    ms ? new Date(ms).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "medium" }) : "—",
};

export const SERIES = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `var(--series-${i})`);
