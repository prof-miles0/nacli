import { Check, ChevronDown, MapPin, Minus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Areas look like "Zone/Subzone"; those without a slash go under "Other". */
function groupAreas(areas: string[]) {
  const groups = new Map<string, { area: string; label: string }[]>();
  for (const area of areas) {
    const slash = area.indexOf("/");
    const group = slash > 0 ? area.slice(0, slash) : "";
    const label = slash > 0 ? area.slice(slash + 1) : area;
    const list = groups.get(group) ?? [];
    list.push({ area, label });
    groups.set(group, list);
  }
  return [...groups.entries()].sort(([a], [b]) => (!a ? 1 : !b ? -1 : a.localeCompare(b, "en")));
}

function Checkbox({ state }: { state: "on" | "off" | "some" }) {
  return (
    <span
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded border transition-colors",
        state === "off" ? "border-input bg-transparent" : "border-primary bg-primary text-primary-foreground",
      )}
    >
      {state === "on" ? <Check className="size-3" strokeWidth={3} /> : null}
      {state === "some" ? <Minus className="size-3" strokeWidth={3} /> : null}
    </span>
  );
}

/**
 * Multi-select for Golbat areas: search, areas grouped by zone (a zone's box
 * toggles all of it), and "All" meaning no filter. An empty selection is "all".
 */
export function AreaSelect({
  areas,
  value,
  onChange,
}: {
  areas: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => new Set(value), [value]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const groups = groupAreas(areas.filter((a) => !needle || a.toLowerCase().includes(needle)));

  const toggle = (area: string) => {
    const next = new Set(selected);
    if (next.has(area)) next.delete(area);
    else next.add(area);
    onChange([...next]);
  };
  const toggleGroup = (list: { area: string }[]) => {
    const all = list.every((i) => selected.has(i.area));
    const next = new Set(selected);
    for (const i of list) {
      if (all) next.delete(i.area);
      else next.add(i.area);
    }
    onChange([...next]);
  };

  const short = (a: string) => a.slice(a.indexOf("/") + 1);
  const label =
    value.length === 0
      ? "All areas"
      : value.length <= 2
        ? value.map(short).join(", ")
        : `${short(value[0])} and ${value.length - 1} more`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        // Same shell as the range Toggle: bordered card with one inner segment.
        className="inline-flex max-w-72 rounded-lg border bg-card p-0.5"
      >
        <span
          className={cn(
            "flex min-w-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value.length || open ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <MapPin className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
          {value.length ? (
            <span className="rounded-full bg-foreground/10 px-1.5 text-[10px] font-semibold tabular-nums">
              {value.length}
            </span>
          ) : null}
          <ChevronDown className={cn("size-3.5 shrink-0 opacity-60 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open ? (
        <div className="animate-in absolute top-full right-0 z-40 mt-1.5 flex w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border bg-popover shadow-2xl">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search areas…"
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {q ? (
              <button type="button" onClick={() => setQ("")} aria-label="Clear search">
                <X className="size-4 text-muted-foreground hover:text-foreground" />
              </button>
            ) : null}
          </div>

          <div className="max-h-80 overflow-y-auto p-1" role="listbox" aria-multiselectable>
            {!needle ? (
              <button
                type="button"
                onClick={() => onChange([])}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <Checkbox state={value.length === 0 ? "on" : "off"} />
                <span className="font-medium">All areas</span>
              </button>
            ) : null}
            {groups.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">No areas match.</p>
            ) : null}
            {groups.map(([group, list]) => {
              const on = list.filter((i) => selected.has(i.area)).length;
              return (
                <div key={group || "other"} className="mt-1">
                  {group ? (
                    <button
                      type="button"
                      onClick={() => toggleGroup(list)}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                    >
                      <Checkbox state={on === 0 ? "off" : on === list.length ? "on" : "some"} />
                      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                        {group}
                      </span>
                      <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                        {on ? `${on}/` : ""}
                        {list.length}
                      </span>
                    </button>
                  ) : groups.length > 1 ? (
                    <div className="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                      Other
                    </div>
                  ) : null}
                  {list.map((i) => (
                    <button
                      key={i.area}
                      type="button"
                      role="option"
                      aria-selected={selected.has(i.area)}
                      onClick={() => toggle(i.area)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md py-1.5 pr-2 text-left text-sm hover:bg-accent",
                        group ? "pl-7" : "pl-2",
                      )}
                    >
                      <Checkbox state={selected.has(i.area) ? "on" : "off"} />
                      <span className="truncate">{i.label}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            <span>{value.length ? `${value.length} selected` : "No filter"}</span>
            <div className="flex gap-1">
              {value.length ? (
                <button type="button" onClick={() => onChange([])} className="rounded px-2 py-1 hover:bg-accent hover:text-foreground">
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded bg-secondary px-2 py-1 font-medium text-foreground hover:bg-secondary/80"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
