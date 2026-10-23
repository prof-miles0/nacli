// A stack's name, as every page shows it: only when more than one stack is
// configured (with one, it would only repeat itself), and then always beside
// a dot in the stack's colour (the colour of the Rotom its Dragonite feeds).

import { useAppInfo, useInstanceColor } from "@/lib/state";
import { cn } from "@/lib/utils";

export function useStacks() {
  const { data: app } = useAppInfo();
  const color = useInstanceColor();
  const stacks = app?.dragonite ?? [];
  const find = (id: string) => stacks.find((d) => d.id === id);
  return {
    stacks,
    /** More than one stack configured: names (and their dots) are worth showing. */
    multi: stacks.length > 1,
    colorOf: (id: string) => {
      const d = find(id);
      return d?.rotom ? color(d.rotom) : "var(--muted-foreground)";
    },
    nameOf: (id: string) => find(id)?.name ?? id,
    /** " on X" (or another preposition) for a sentence, empty with a single stack. */
    on: (id: string, prep = "on") => (stacks.length > 1 ? ` ${prep} ${find(id)?.name ?? id}` : ""),
  };
}

/** The stack's colour dot. */
export function StackDot({ id, className }: { id: string; className?: string }) {
  const { colorOf, nameOf } = useStacks();
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: colorOf(id) }} title={nameOf(id)} aria-hidden />;
}

/** The stack's dot and name, or nothing when it is the only stack. */
export function StackTag({ id, className, force }: { id: string; className?: string; /** Show it even with one stack (e.g. a list of stacks to pick from). */ force?: boolean }) {
  const { multi, nameOf } = useStacks();
  if (!multi && !force) return null;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <StackDot id={id} />
      <span className="truncate">{nameOf(id)}</span>
    </span>
  );
}
