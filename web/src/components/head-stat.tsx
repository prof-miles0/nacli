import type { ReactNode } from "react";
import { HoverCard } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * One figure in a stack's header. Every box has the same three rows (label,
 * figure, a line for a bar or a note, empty if none) and fills its cell, so a
 * row of them lines up whatever each one shows.
 */
export function HeadStat({
  label,
  value,
  tone,
  hint,
  children,
}: {
  label: string;
  value: ReactNode;
  tone?: "warn";
  hint?: string;
  children?: ReactNode;
}) {
  const box = (
    <div className="flex h-full min-w-0 flex-col gap-1 rounded-lg border bg-background/50 px-3 py-2 sm:min-w-28">
      <span className="truncate text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className={cn("truncate text-base leading-none font-bold tabular-nums", tone === "warn" && "text-amber-400")}>{value}</span>
      <div className="mt-auto flex h-4 min-w-0 items-center [&>span]:truncate [&>span]:leading-4">{children}</div>
    </div>
  );
  return hint ? (
    <HoverCard className="block h-full min-w-0" content={<span>{hint}</span>}>
      {box}
    </HoverCard>
  ) : (
    box
  );
}

/** A thin bar of value out of max. */
export function MiniProgress({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full" style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%`, background: color }} />
    </div>
  );
}

