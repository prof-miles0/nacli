import { Check, ChevronDown, Clock, ListFilter, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type MenuPlace, placeMenu } from "@/lib/popover";
import { cn, fmt } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
  /** Its colour: a dot beside it and, with counts, a bar of its share. */
  color?: string;
  count?: number;
}

/**
 * A filter as a dropdown: "all" first, then each option with its colour, its
 * count and its share of the total. The chosen one tints the button. In a
 * portal, so a table's overflow cannot clip it.
 */
export function FilterMenu({
  value,
  onChange,
  options,
  allLabel,
  label,
  icon: Icon = ListFilter,
  total,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  /** The "every option" entry, whose value is "". Left out: one option must always be chosen. */
  allLabel?: string;
  /** Its accessible name, e.g. "Account state". */
  label: string;
  /** Shown when nothing is chosen, or for options without a colour. */
  icon?: LucideIcon;
  /** The count beside allLabel; the options' counts added up when left out. */
  total?: number;
  /** For the button, e.g. "flex-1" to share a row with others. */
  className?: string;
}) {
  const [pos, setPos] = useState<MenuPlace>();
  const ref = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = !!pos;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setPos(undefined);
    };
    // Scrolling the page closes it, but not scrolling its own list.
    const dismiss = (e: Event) => !menuRef.current?.contains(e.target as Node) && setPos(undefined);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPos(undefined);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  const counted = options.some((o) => o.count !== undefined);
  const sum = total ?? options.reduce((n, o) => n + (o.count ?? 0), 0);
  const current = options.find((o) => o.value === value);

  const toggle = () => {
    if (open) return setPos(undefined);
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos(placeMenu(r, Math.max(r.width, 224), (options.length + (allLabel !== undefined ? 1 : 0)) * 44 + 16));
  };
  const pick = (v: string) => {
    setPos(undefined);
    onChange(v);
  };
  const dot = (color: string) => <span className="size-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 0 3px color-mix(in oklab, ${color} 16%, transparent)` }} />;
  const item = (o: FilterOption, all = false) => {
    const on = o.value === value;
    return (
      <button
        key={o.value || "all"}
        type="button"
        role="option"
        aria-selected={on}
        onClick={() => pick(o.value)}
        className={cn("flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-foreground/10", on && "bg-foreground/5")}
      >
        <span className="flex w-full items-center gap-2 text-sm">
          {o.color ? dot(o.color) : <Icon className={cn("size-3.5 shrink-0", all ? "text-muted-foreground" : "text-muted-foreground/60")} />}
          <span className={cn("flex-1 truncate", on && "font-medium")}>{o.label}</span>
          {o.count !== undefined ? <span className="text-xs text-muted-foreground tabular-nums">{fmt.int(o.count)}</span> : null}
          <Check className={cn("size-3.5 shrink-0", on ? "text-foreground" : "invisible")} />
        </span>
        {!all && o.color && o.count !== undefined && sum ? (
          <span className="mr-[22px] ml-[18px] h-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (o.count / sum) * 100)}%`, background: o.color }} />
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={toggle}
        className={cn(
          "inline-flex h-9 max-w-full shrink-0 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm transition-colors hover:bg-accent",
          open && "ring-2 ring-ring/50",
          className,
        )}
        style={current?.color ? { borderColor: `color-mix(in oklab, ${current.color} 50%, transparent)` } : undefined}
      >
        {current?.color ? dot(current.color) : <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="flex-1 truncate text-left">{current ? current.label : (allLabel ?? "")}</span>
        {counted ? (
          <span className="hidden rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums sm:inline">{fmt.int(current ? (current.count ?? 0) : sum)}</span>
        ) : null}
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {pos
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              aria-label={label}
              style={{ ...pos, maxHeight: Math.min(pos.maxHeight, 320) }}
              className="animate-in fixed z-50 flex flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 shadow-xl"
            >
              {allLabel !== undefined ? (
                <>
                  {item({ value: "", label: allLabel, count: counted ? sum : undefined }, true)}
                  <div className="my-0.5 shrink-0 border-t" />
                </>
              ) : null}
              {options.map((o) => item(o))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

const UNIT: Record<string, [string, string]> = { m: ["minute", "minutes"], h: ["hour", "hours"], d: ["day", "days"] };

/** "15m" → "Last 15 minutes", "1h" → "Last hour". */
export function rangeLabel(short: string): string {
  const m = /^(\d+)([mhd])$/.exec(short);
  if (!m) return short;
  const [one, many] = UNIT[m[2]];
  return m[1] === "1" ? `Last ${one}` : `Last ${m[1]} ${many}`;
}

/** A chart page's time range, as a dropdown. Options keep their short labels ("6h"). */
export function RangeMenu({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <FilterMenu
      value={value}
      onChange={onChange}
      options={options.map((o) => ({ value: o.value, label: rangeLabel(o.label) }))}
      label="Time range"
      icon={Clock}
      className={className}
    />
  );
}
