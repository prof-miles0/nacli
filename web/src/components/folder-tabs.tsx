import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface FolderTab {
  id: string;
  label: string;
  /** Dot and accent colour; "All" style tabs can leave it out. */
  color?: string;
  /** Short figures shown on closed tabs (the open one shows them in its panel). */
  summary?: ReactNode;
  /** Only as wide as its content (the "All" tab), while the stacks share the rest. */
  compact?: boolean;
}

/** The tint of an open tab and of the top of its panel. */
export const tabTint = (c: string) => `color-mix(in oklab, ${c} 12%, var(--card))`;

const NEUTRAL = "var(--muted-foreground)";

/**
 * Folder tabs, as in a browser: the open one shares its background with the
 * panel below (FolderPanel) and has no bottom edge, so both read as one piece.
 */
export function FolderTabs({ tabs, value, onChange, label }: { tabs: FolderTab[]; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex items-end gap-1">
      {tabs.map((t) => {
        const selected = t.id === value;
        const c = t.color ?? NEUTRAL;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(t.id)}
            className={cn(
              "relative flex min-w-0 items-center justify-center gap-2.5 overflow-hidden rounded-t-xl border px-3 text-sm transition-colors",
              t.compact ? "flex-none px-4" : "flex-1",
              selected
                ? // 1px over the panel's top border, with the panel's colour: the tab opens into it.
                  "z-10 -mb-px border-b-transparent pt-3 pb-3 text-foreground"
                : "border-transparent bg-muted/40 pt-2 pb-2 text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            )}
            style={selected ? { background: tabTint(c) } : undefined}
          >
            {/* The open tab's top edge, in its colour (as in a browser). */}
            {selected ? <span aria-hidden className="absolute inset-x-0 top-0 h-0.5" style={{ background: c }} /> : null}
            {t.color ? <span className="size-2.5 shrink-0 rounded-full" style={{ background: t.color }} /> : null}
            <span className="truncate font-semibold">{t.label}</span>
            {t.summary && !selected ? (
              <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">{t.summary}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** The panel an open tab belongs to: the tab's tint at its top, fading to the card. */
export function FolderPanel({
  color,
  tabbed,
  className,
  children,
}: {
  color?: string;
  /** Under folder tabs: square top corners, since the tabs cover its whole top edge. */
  tabbed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("relative overflow-hidden rounded-xl border px-4 py-3", tabbed && "rounded-t-none", className)}
      style={{ background: `linear-gradient(180deg, ${tabTint(color ?? NEUTRAL)}, var(--card) 85%)` }}
    >
      {children}
    </div>
  );
}
