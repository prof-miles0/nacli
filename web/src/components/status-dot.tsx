import { cn } from "@/lib/utils";

export type StatusTone = "good" | "info" | "warn" | "bad" | "off";

const DOT_COLOR: Record<StatusTone, string> = {
  good: "bg-green-500 shadow-[0_0_6px] shadow-green-500/70",
  info: "bg-blue-500 shadow-[0_0_6px] shadow-blue-500/60",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  off: "bg-muted-foreground/40",
};

/** Coloured state dot with a hover card to its right (stays inside the table row). */
export function StatusDot({
  tone,
  label,
  detail,
}: {
  tone: StatusTone;
  label: string;
  detail?: string;
}) {
  return (
    <span className="group/dot relative flex size-4 shrink-0 items-center justify-center" tabIndex={0} aria-label={label}>
      <span className={cn("size-2.5 rounded-full", DOT_COLOR[tone])} />
      <span
        role="tooltip"
        className="pointer-events-none absolute top-1/2 left-full z-20 ml-2 -translate-y-1/2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap opacity-0 shadow-lg transition-opacity group-hover/dot:opacity-100 group-focus/dot:opacity-100"
      >
        <span className="font-medium">{label}</span>
        {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
      </span>
    </span>
  );
}
