// Small shadcn/ui-style primitives, matching the Dragonite admin look.

import { Loader2, X } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useEffect,
  useLayoutEffect,
  useRef,
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

let openModals = 0;
const modalStack: object[] = [];

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
  large,
  full,
  tall,
  icon,
  description,
  still,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** A small icon before the title. */
  icon?: ReactNode;
  /** A line under the title. */
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Wider still, for forms with a map beside their fields. */
  large?: boolean;
  /** Near full-screen, for content like logs. */
  full?: boolean;
  /** A fixed height (as tall as `full`), so it does not grow or shrink with its content, e.g. between tabs. */
  tall?: boolean;
  /** Appears without its entrance animation: when it replaces another, e.g. switching between add forms. */
  still?: boolean;
}) {
  // Escape closes only the topmost modal (one can open over another).
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const me = {};
    modalStack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && modalStack.at(-1) === me) close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      modalStack.splice(modalStack.indexOf(me), 1);
    };
  }, [open]);
  // The page behind stays still while any modal is open (they can stack).
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    if (openModals++ === 0) {
      const width = document.body.getBoundingClientRect().width;
      html.classList.add("modal-open");
      // Browsers without scrollbar-gutter drop the scrollbar when the overflow
      // is hidden: pad its width back so nothing behind the modal shifts.
      const grew = document.body.getBoundingClientRect().width - width;
      if (grew > 0) html.style.paddingRight = `${grew}px`;
    }
    return () => {
      if (--openModals === 0) {
        html.classList.remove("modal-open");
        html.style.paddingRight = "";
      }
    };
  }, [open]);
  if (!open) return null;
  // Portal to <body> so a modal opened from a table cell does not inherit its
  // alignment, overflow or stacking.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 text-left sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal
        className={cn(
          !still && "animate-in",
          "relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl ring-1 ring-white/5",
          (full || tall) && "h-[88vh]",
          full ? "max-w-6xl" : large ? "max-w-5xl" : wide ? "max-w-3xl" : "max-w-md",
        )}
      >
        <div className="flex items-start gap-3 border-b px-5 py-4">
          {icon ? <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border bg-muted/40 text-muted-foreground [&_svg]:size-4.5">{icon}</span> : null}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 self-center">
            <h3 className="text-base leading-snug font-semibold sm:text-lg">{title}</h3>
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className={cn("min-h-0 overflow-auto overscroll-contain px-5 py-4 text-sm", full && "flex-1 overflow-hidden", tall && "flex-1")}>{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/20 px-5 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/** The choice at the top of an "Add" modal: one item with its form, or several imported at once. */
export function AddChoice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; hint: string; icon: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" className="mb-4 grid grid-cols-2 gap-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
              on ? "border-primary bg-primary/10" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-lg border [&_svg]:size-4",
                on ? "border-primary/50 bg-primary/15 text-primary" : "bg-muted/40",
              )}
            >
              {o.icon}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className={cn("text-sm font-medium", on && "text-foreground")}>{o.label}</span>
              <span className="truncate text-[11px] text-muted-foreground">{o.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-muted-foreground", className)} />;
}

/** Table shell with Dragonite-like density. */
export function Table({ children, className, container }: { children: ReactNode; className?: string; container?: boolean }) {
  return (
    // Border on the outer box, scrolling on the inner one, so callers can pad
    // the bottom (e.g. for a control on the edge) without covering the scrollbar.
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      {/* `container`: a size container, so a row's content can match the visible
          width (100cqw) while the columns scroll. Only where asked: in Safari a page
          whose rows reorder on every refresh inside one jumped back to the top. */}
      <div className={cn("overflow-x-auto", container && "@container")}>
      <table className="w-full text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-medium [&_th]:tracking-wide [&_th]:text-muted-foreground [&_th]:uppercase [&_th]:whitespace-nowrap [&_thead_tr]:border-b [&_tbody_tr]:border-b [&_tbody_tr:last-child]:border-0 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-accent/40">
        {children}
      </table>
      </div>
    </div>
  );
}

/** Room kept between a hover card and the window's edges. */
const EDGE = 8;

/**
 * Hover/focus card rendered in a portal, so tables with overflow cannot clip
 * it. Opens above the trigger, or below when it does not fit above, and always
 * stays inside the window.
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
  // The trigger's box; where the card goes is worked out once it is drawn and its size known.
  const [at, setAt] = useState<DOMRect>();
  const [pos, setPos] = useState<{ left: number; top: number }>();
  const card = useRef<HTMLDivElement>(null);
  const show = (el: HTMLElement) => {
    setPos(undefined);
    setAt(el.getBoundingClientRect());
  };
  const hide = () => {
    setAt(undefined);
    setPos(undefined);
  };
  useLayoutEffect(() => {
    if (!at || !card.current) return;
    const { width, height } = card.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const above = at.top - 6 - height;
    const below = at.bottom + 6;
    // Above when it fits there, else below when it fits, else on the side with more room.
    const top =
      above >= EDGE ? above : below + height <= vh - EDGE ? below : at.top > vh - at.bottom ? above : below;
    setPos({
      left: Math.max(EDGE, Math.min(at.left, vw - width - EDGE)),
      top: Math.max(EDGE, Math.min(top, vh - height - EDGE)),
    });
  }, [at]);
  return (
    <span
      className={cn("cursor-default", className)}
      tabIndex={0}
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={hide}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={hide}
    >
      {children}
      {at
        ? createPortal(
            <div
              ref={card}
              role="tooltip"
              // Hidden for the moment it is measured, at the top left.
              style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
              className="animate-in pointer-events-none fixed z-50 max-h-[calc(100vh-16px)] max-w-[min(24rem,calc(100vw-16px))] overflow-hidden rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-lg"
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
