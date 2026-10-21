import { Copy, Download, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { endpoints } from "@/lib/api";
import { cn, fmt } from "@/lib/utils";
import { Toggle } from "./table-tools";
import { Button, Input, Modal, Select, Spinner } from "./ui";

interface LogFile {
  name: string;
  text: string;
  truncated: boolean;
  bytes: number;
}

const AUTO_REFRESH_MS = 5000;

/** Lines rendered at once; the rest stay searchable. */
const MAX_RENDERED = 5000;

const LEVELS = ["V", "D", "I", "W", "E", "F"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_CLASS: Record<Level, string> = {
  V: "text-muted-foreground/60",
  D: "text-muted-foreground",
  I: "text-foreground/90",
  W: "text-amber-400",
  E: "text-red-400",
  F: "text-red-300 font-semibold",
};

// logcat "threadtime": "10-19 23:12:01.123  1234  1240 E Tag: message",
// and "brief": "E/Tag( 1234): message".
const THREADTIME = /^\S+\s+\S+\s+\d+\s+\d+\s+([VDIWEF])\s/;
const BRIEF = /^([VDIWEF])\//;

// Device agents such as Exeggcute write "19/10/2026 20:51:14 [Worker 3] msg"
// with no level field, so infer one from the wording.
const AGENT = /^(\d{1,2}\/\d{1,2}\/\d{4} \d{2}:\d{2}:\d{2})\s+(?:\[([^\]]+)\]\s*)?(.*)$/;
const ERROR_WORDS = /\b(error|exception|fatal|failed|failure|crash(ed)?|panic)\b/i;
const WARN_WORDS = /\b(warn(ing)?|disconnected|reconnect(ing|ion)?|timeout|timed out|retry(ing)?)\b/i;

function levelOf(line: string): Level | undefined {
  const explicit = THREADTIME.exec(line)?.[1] ?? BRIEF.exec(line)?.[1];
  if (explicit) return explicit as Level;
  if (!line.trim()) return undefined;
  if (ERROR_WORDS.test(line)) return "E";
  if (WARN_WORDS.test(line)) return "W";
  return "I";
}

/** "[Worker 3]" style tag of an agent line, used to filter by component. */
function tagOf(line: string): string | undefined {
  return AGENT.exec(line)?.[2];
}

const MIN_LEVEL_OPTIONS = [
  { value: "V", label: "All" },
  { value: "W", label: "Warnings+" },
  { value: "E", label: "Errors" },
];

function LogLine({ line }: { line: string }) {
  const lv = levelOf(line);
  const m = AGENT.exec(line);
  return (
    <div className={cn("break-all whitespace-pre-wrap hover:bg-accent/40", lv ? LEVEL_CLASS[lv] : "text-foreground/80")}>
      {m ? (
        <>
          <span className="text-muted-foreground/70">{m[1]} </span>
          {m[2] ? <span className="text-sky-300/90">[{m[2]}] </span> : null}
          {m[3]}
        </>
      ) : (
        line || " "
      )}
    </div>
  );
}

export function LogcatModal({
  instanceId,
  deviceId,
  subject,
  onClose,
  onDownload,
}: {
  instanceId: string;
  deviceId: string;
  subject: string;
  onClose: () => void;
  onDownload: () => void;
}) {
  const [files, setFiles] = useState<LogFile[]>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [fileIdx, setFileIdx] = useState(0);
  const [q, setQ] = useState("");
  const [minLevel, setMinLevel] = useState<Level>("V");
  const [tag, setTag] = useState("");
  const [copied, setCopied] = useState(false);
  const [auto, setAuto] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const scroller = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  /** Follow the tail while the user is at the bottom; stop once they scroll up. */
  const stick = useRef(true);

  const load = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const r = await endpoints.rotom<{ files: LogFile[] }>(
        instanceId,
        `/device/${encodeURIComponent(deviceId)}/logcat-view`,
        { method: "POST" },
      );
      setFiles(r.files);
      // Keep the selected file across refreshes when it still exists.
      setFileIdx((i) => (i < r.files.length ? i : 0));
      setError(undefined);
      setUpdatedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on open
  useEffect(() => {
    void load();
  }, []);

  // Auto-refresh: wait 5s after each answer so slow devices never pile up
  // requests; skip while the browser tab is hidden.
  // biome-ignore lint/correctness/useExhaustiveDependencies: load is stable enough here
  useEffect(() => {
    if (!auto) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState === "visible") await load();
      if (!stopped) timer = setTimeout(tick, AUTO_REFRESH_MS);
    };
    timer = setTimeout(tick, AUTO_REFRESH_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [auto]);

  // Re-render "Ns ago" once a second while auto-refreshing.
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [auto]);

  const file = files?.[fileIdx];
  const lines = useMemo(() => (file ? file.text.split(/\r?\n/) : []), [file]);
  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const l of lines) {
      const t = tagOf(l);
      if (t) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  }, [lines]);
  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    const min = LEVELS.indexOf(minLevel);
    return lines.filter((l) => {
      if (needle && !l.toLowerCase().includes(needle)) return false;
      if (tag && tagOf(l) !== tag) return false;
      if (min > 0) {
        const lv = levelOf(l);
        // Lines without a level (continuations, headers) only show unfiltered.
        if (!lv || LEVELS.indexOf(lv) < min) return false;
      }
      return true;
    });
  }, [lines, q, minLevel, tag]);
  const rendered = filtered.length > MAX_RENDERED ? filtered.slice(-MAX_RENDERED) : filtered;

  // A filter change jumps back to the newest lines.
  // biome-ignore lint/correctness/useExhaustiveDependencies: triggers only
  useEffect(() => {
    stick.current = true;
  }, [q, minLevel, tag, fileIdx]);

  // The newest entries are at the bottom: stay there unless the user scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rendered]);

  const copy = async () => {
    await navigator.clipboard.writeText(filtered.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal open full onClose={onClose} title={`Logcat · ${subject}`}>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter text…"
            className="w-full sm:w-64"
            disabled={!files}
          />
          <Toggle value={minLevel} onChange={(v) => setMinLevel(v as Level)} options={MIN_LEVEL_OPTIONS} />
          {tags.length > 1 ? (
            <Select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Component">
              <option value="">All components</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          ) : null}
          {files && files.length > 1 ? (
            <Toggle
              value={String(fileIdx)}
              onChange={(v) => setFileIdx(Number(v))}
              options={files.map((f, i) => ({ value: String(i), label: f.name.split("/").pop() ?? f.name }))}
            />
          ) : null}
          <div className="ml-auto flex gap-1">
            <Button
              variant={auto ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setAuto((a) => !a)}
              aria-pressed={auto}
              title="Fetch the log every 5 seconds"
            >
              <span
                className={cn("size-2 rounded-full", auto ? "animate-pulse bg-green-500" : "bg-muted-foreground/50")}
              />
              Auto 5s
            </Button>
            <Button variant="ghost" size="icon" onClick={load} disabled={loading} title="Fetch the log again">
              <RefreshCw className={cn(loading && "animate-spin")} />
            </Button>
            <Button variant="ghost" size="icon" onClick={copy} disabled={!filtered.length} title="Copy filtered lines">
              <Copy />
            </Button>
            <Button variant="ghost" size="icon" onClick={onDownload} title="Download original ZIP">
              <Download />
            </Button>
          </div>
        </div>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          className="min-h-0 flex-1 overflow-auto rounded-lg border bg-background/70 p-3 font-mono text-[11.5px] leading-5"
        >
          {loading && !files ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 font-sans text-sm text-muted-foreground">
              <Spinner />
              Requesting logcat from the device… this can take a few seconds.
            </div>
          ) : error && !files ? (
            <p className="font-sans text-sm text-red-300">{error}</p>
          ) : rendered.length === 0 ? (
            <p className="font-sans text-sm text-muted-foreground">No lines match.</p>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are static once loaded
            rendered.map((l, i) => <LogLine key={i} line={l} />)
          )}
        </div>

        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {file
              ? `${fmt.int(filtered.length)} of ${fmt.int(lines.length)} line${lines.length === 1 ? "" : "s"}${
                  filtered.length > MAX_RENDERED ? ` · showing the last ${fmt.int(MAX_RENDERED)}` : ""
                }`
              : ""}
            {copied ? " · copied" : ""}
            {updatedAt ? ` · updated ${fmt.ago(updatedAt)}` : ""}
            {error && files ? <span className="text-red-300"> · last attempt failed: {error}</span> : null}
          </span>
          <span>
            {file ? `${file.name} · ${fmt.bytes(file.bytes)}${file.truncated ? " · last 4 MB only" : ""}` : ""}
          </span>
        </div>
      </div>
    </Modal>
  );
}
