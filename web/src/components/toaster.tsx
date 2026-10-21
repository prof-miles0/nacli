import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type ToastTone = "success" | "error" | "warning" | "info";

export interface ToastInput {
  text: string;
  /** Short heading; defaults to one for the tone. */
  title?: string;
  tone?: ToastTone;
  /** Older calls pass `error: true` instead of a tone. */
  error?: boolean;
  /** How long it stays, in ms (defaults per tone). */
  duration?: number;
}

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  text: string;
  duration: number;
}

const DEFAULTS: Record<ToastTone, { title: string; duration: number }> = {
  success: { title: "Done", duration: 5000 },
  info: { title: "Notice", duration: 5000 },
  warning: { title: "Warning", duration: 7000 },
  error: { title: "Error", duration: 9000 },
};

/** Colour (for the ring, icon and accent) and icon of each tone. */
const STYLE: Record<ToastTone, { color: string; icon: typeof CircleCheck }> = {
  success: { color: "#22c55e", icon: CircleCheck },
  info: { color: "#3b82f6", icon: Info },
  warning: { color: "#f59e0b", icon: TriangleAlert },
  error: { color: "#ef4444", icon: CircleAlert },
};

// A tiny global store, so any page can raise a toast and one stack shows them.
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(input: ToastInput) {
  const tone = input.tone ?? (input.error ? "error" : "success");
  const d = DEFAULTS[tone];
  toasts = [
    ...toasts.slice(-4), // at most 5 on screen; the oldest give way
    { id: nextId++, tone, title: input.title ?? d.title, text: input.text, duration: input.duration ?? d.duration },
  ];
  emit();
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The stack of toasts, bottom right; mounted once in the layout. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts);
  return createPortal(
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {list.map((t) => (
        <ToastCard key={t.id} t={t} />
      ))}
    </div>,
    document.body,
  );
}

const R = 15;
const C = 2 * Math.PI * R;

function ToastCard({ t }: { t: Toast }) {
  const { color, icon: Icon } = STYLE[t.tone];
  // Time left, paused while the pointer is over the toast.
  const [paused, setPaused] = useState(false);
  const left = useRef(t.duration);
  const startedAt = useRef(performance.now());
  useEffect(() => {
    if (paused) {
      left.current -= performance.now() - startedAt.current;
      return;
    }
    startedAt.current = performance.now();
    const timer = setTimeout(() => dismiss(t.id), Math.max(0, left.current));
    return () => clearTimeout(timer);
  }, [paused, t.id]);

  return (
    <div
      role={t.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="toast-in pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl border bg-popover/95 py-3 pr-9 pl-3 text-sm shadow-2xl backdrop-blur"
      style={{ borderColor: `color-mix(in oklab, ${color} 45%, var(--border))` }}
    >
      {/* A faint wash of the tone's colour behind the icon. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `linear-gradient(90deg, color-mix(in oklab, ${color} 14%, transparent), transparent 60%)` }}
      />
      {/* Icon inside a ring that empties as the toast runs out of time. */}
      <span className="relative grid size-9 shrink-0 place-items-center">
        <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
          <circle cx="18" cy="18" r={R} fill="none" stroke={color} strokeOpacity={0.18} strokeWidth="2.5" />
          <circle
            cx="18"
            cy="18"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={C}
            className="toast-ring"
            style={{
              animationDuration: `${t.duration}ms`,
              animationPlayState: paused ? "paused" : "running",
              ["--ring-c" as string]: `${C}`,
            }}
          />
        </svg>
        <Icon className="relative size-4.5" style={{ color }} />
      </span>
      <div className="relative min-w-0 flex-1 pt-0.5">
        <div className="font-semibold" style={{ color }}>
          {t.title}
        </div>
        <div className="mt-0.5 break-words text-muted-foreground">{t.text}</div>
      </div>
      <button
        type="button"
        onClick={() => dismiss(t.id)}
        aria-label="Dismiss notification"
        className={cn("absolute top-2.5 right-2.5 text-muted-foreground transition-colors hover:text-foreground")}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
