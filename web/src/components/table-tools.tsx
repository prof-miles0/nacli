import { ArrowDown, ArrowUp, ArrowUpDown, type LucideIcon, Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "./ui";

type Getter<T> = (row: T) => string | number | boolean | undefined | null;

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function useSorted<T>(rows: T[], getters: Record<string, Getter<T>>, initial: string, initialDesc = false) {
  const [key, setKey] = useState(initial);
  const [desc, setDesc] = useState(initialDesc);
  const sorted = useMemo(() => {
    const g = getters[key];
    if (!g) return rows;
    const out = [...rows].sort((a, b) => {
      const va = g(a);
      const vb = g(b);
      if (typeof va === "number" && typeof vb === "number") return va - vb;
      return collator.compare(String(va ?? ""), String(vb ?? ""));
    });
    return desc ? out.reverse() : out;
    // getters is a fresh object each render but its functions are stable in meaning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, key, desc]);

  const header = (k: string, label: ReactNode, className?: string) => (
    <th className={className} aria-sort={key === k ? (desc ? "descending" : "ascending") : undefined}>
      <button
        type="button"
        className={cn("inline-flex items-center gap-1 uppercase hover:text-foreground", key === k && "text-foreground")}
        onClick={() => {
          if (key === k) setDesc((d) => !d);
          else {
            setKey(k);
            setDesc(false);
          }
        }}
      >
        {label}
        {key === k ? (
          desc ? (
            <ArrowDown className="size-3" />
          ) : (
            <ArrowUp className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-40" />
        )}
      </button>
    </th>
  );
  return { sorted, header };
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-8" />
    </div>
  );
}

export function matches(q: string, ...fields: (string | number | undefined | null)[]) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return fields.some((f) => f != null && String(f).toLowerCase().includes(needle));
}

export function Toggle({
  options,
  value,
  onChange,
  size = "sm",
  fill,
}: {
  options: { value: string; label: string; icon?: LucideIcon; count?: number }[];
  value: string;
  onChange: (v: string) => void;
  /** "md": a larger switch between a page's views. */
  size?: "sm" | "md";
  /**
   * On a phone it spans the whole width, its options sharing it; each label
   * shows when there is room for it, else only its icon (the label stays as
   * the accessible name).
   */
  fill?: boolean;
}) {
  const md = size === "md";
  const bar = (
    <div role="tablist" className={cn("inline-flex rounded-lg border bg-card p-0.5", md && "rounded-xl p-1", fill && "flex w-full sm:inline-flex sm:w-auto")}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={fill ? o.label : undefined}
            title={fill ? o.label : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0",
              md && "gap-2 rounded-lg px-3.5 py-1.5 text-sm [&_svg]:size-4",
              fill && "flex-1 justify-center sm:flex-none",
              on && "bg-accent text-foreground shadow-sm",
            )}
          >
            {o.icon ? <o.icon /> : null}
            <span className={cn(fill && o.icon && "hidden @[18rem]:inline")}>{o.label}</span>
            {o.count !== undefined ? (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] leading-4 tabular-nums",
                  on ? "bg-foreground/10 text-foreground" : "bg-muted text-muted-foreground",
                  fill && "hidden @md:inline",
                )}
              >
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
  // The wrapper measures the room the labels have (a container query).
  return fill ? <div className="@container w-full sm:w-auto">{bar}</div> : bar;
}
