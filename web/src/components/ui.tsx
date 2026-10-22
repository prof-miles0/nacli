// Small shadcn/ui-style primitives, matching the Dragonite admin look.

import { Loader2, X } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-md",
        className,
      )}
      {...p}
    />
  );
}

/** Dragonite's signature: a thin gradient bar along the top edge of a card. */
export function AccentCard({
  accent,
  hover = true,
  className,
  children,
  ...p
}: HTMLAttributes<HTMLDivElement> & { accent: string; hover?: boolean }) {
  return (
    <Card
      className={cn(hover && "transition hover:-translate-y-0.5 hover:shadow-lg", className)}
      {...p}
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px] rounded-t-[inherit]"
        style={{ background: `linear-gradient(to right, ${accent}, color-mix(in oklab, ${accent} 30%, transparent))` }}
      />
      {children}
    </Card>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-10 mb-3 flex items-end justify-between gap-3 first:mt-0">
      <h2 className="text-2xl font-bold tracking-tight">{children}</h2>
      {right}
    </div>
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("text-[11px] font-medium tracking-wide text-muted-foreground uppercase", className)}>
      {children}
    </div>
  );
}

type Variant = "default" | "outline" | "ghost" | "destructive" | "secondary";
const VARIANTS: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  outline: "border bg-background/40 hover:bg-accent",
  ghost: "hover:bg-accent",
  destructive: "bg-destructive/90 text-white hover:bg-destructive",
};

export function Button({
  variant = "default",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "icon";
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
        size === "md" && "h-9 px-4",
        size === "sm" && "h-8 px-3 text-xs",
        size === "icon" && "size-9",
        VARIANTS[variant],
        className,
      )}
      {...p}
    >
      {loading ? <Loader2 className="animate-spin" /> : null}
      {children}
    </button>
  );
}

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      {...p}
    />
  );
}

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      {...p}
    >
      {children}
    </select>
  );
}

const TONES = {
  neutral: "bg-muted text-muted-foreground",
  good: "bg-green-500/15 text-green-400",
  warn: "bg-amber-500/15 text-amber-400",
  bad: "bg-red-500/15 text-red-400",
  info: "bg-blue-500/15 text-blue-400",
  violet: "bg-violet-500/15 text-violet-300",
};
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full", className)} style={{ background: color }} />;
}

/** One labelled horizontal bar, as in Dragonite's "Workers" card. */
export function BarRow({
  label,
  value,
  total,
  color,
  display,
}: {
  label: ReactNode;
  value: number;
  total: number;
  color: string;
  display?: ReactNode;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2.5 text-xs">
      <Dot color={color} />
      <span className="w-24 shrink-0 truncate text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-12 shrink-0 text-right font-semibold tabular-nums">{display ?? value}</span>
      <span className="w-9 shrink-0 text-right text-muted-foreground tabular-nums">{pct}%</span>
    </div>
  );
}

/** Segmented bar with a legend underneath (Dragonite's "Accounts" card). */
export function StackBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-muted">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <div
              key={s.label}
              title={`${s.label}: ${s.value}`}
              className="h-full transition-[width] duration-500"
              style={{ width: `${(s.value / Math.max(total, 1)) * 100}%`, background: s.color }}
            />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <Dot color={s.color} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-semibold tabular-nums">{s.value.toLocaleString("en-GB")}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
  large,
  full,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Wider still, for forms with a map beside their fields. */
  large?: boolean;
  /** Near full-screen, for content like logs. */
  full?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  // Portal to <body> so a modal opened from a table cell does not inherit its
  // alignment, overflow or stacking.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 text-left">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal
        className={cn(
          "animate-in relative flex max-h-[90vh] w-full flex-col gap-4 overflow-hidden rounded-xl border bg-card p-5 shadow-2xl",
          full ? "h-[88vh] max-w-6xl" : large ? "max-w-5xl" : wide ? "max-w-3xl" : "max-w-md",
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className={cn("min-h-0 overflow-auto text-sm", full && "flex-1 overflow-hidden")}>{children}</div>
        {footer ? <div className="flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-muted-foreground", className)} />;
}

/** Table shell with Dragonite-like density. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    // Border on the outer box, scrolling on the inner one, so callers can pad
    // the bottom (e.g. for a control on the edge) without covering the scrollbar.
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      <div className="overflow-x-auto">
      <table className="w-full text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-medium [&_th]:tracking-wide [&_th]:text-muted-foreground [&_th]:uppercase [&_th]:whitespace-nowrap [&_thead_tr]:border-b [&_tbody_tr]:border-b [&_tbody_tr:last-child]:border-0 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-accent/40">
        {children}
      </table>
      </div>
    </div>
  );
}

/**
 * Hover/focus card rendered in a portal, so tables with overflow cannot clip
 * it. Opens above the trigger, or below when there is no room above.
 */
export function HoverCard({
  children,
  content,
  className,
}: {
  children: ReactNode;
  content: ReactNode;
  /** Classes for the trigger wrapper, e.g. "block" to make it fill a cell. */
  className?: string;
}) {
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean }>();
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const above = r.top > 120;
    setPos({ x: r.left, y: above ? r.top - 6 : r.bottom + 6, above });
  };
  return (
    <span
      className={cn("cursor-default", className)}
      tabIndex={0}
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={() => setPos(undefined)}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={() => setPos(undefined)}
    >
      {children}
      {pos
        ? createPortal(
            <div
              role="tooltip"
              style={{ left: pos.x, top: pos.y }}
              className={cn(
                "animate-in pointer-events-none fixed z-50 max-w-sm rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-lg",
                pos.above && "-translate-y-full",
              )}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
