// Moving accounts to another stack: the ticked ones (a bar like the proxies'
// one) or a number of available ones. The rows move from one Dragonite
// database to the other and both Dragonites reload their accounts.

import { useQueries, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowRightLeft, X } from "lucide-react";
import { useState } from "react";
import type { AccountMoveResult, DragoniteInfo } from "@shared/types";
import { FilterMenu } from "@/components/filter-menu";
import { toast } from "@/components/toaster";
import { Button, Input, Label, Modal, Spinner } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { fmt } from "@/lib/utils";

export interface PickedAccount {
  stack: string;
  username: string;
}

/** Stacks whose accounts can move: their API and their database. */
export const movableStacks = (stacks: DragoniteInfo[]) => stacks.filter((d) => d.accounts && d.database);

const plural = (n: number, one: string, many = `${one}s`) => `${fmt.int(n)} ${n === 1 ? one : many}`;

/** One toast for the whole move: what moved, what stayed and why, and the reloads. */
function report(r: AccountMoveResult, to: string, nameOf: (id: string) => string) {
  const moved = r.results.reduce((n, x) => n + x.moved, 0);
  const notes: string[] = [];
  const inUse = r.results.reduce((n, x) => n + x.inUse, 0);
  const there = r.results.reduce((n, x) => n + x.inTarget, 0);
  const gone = r.results.reduce((n, x) => n + x.missing, 0);
  if (inUse) notes.push(`${plural(inUse, "account")} in use, left`);
  if (there) notes.push(`${plural(there, "account")} already in ${nameOf(to)}`);
  if (gone) notes.push(`${plural(gone, "account")} no longer there`);
  for (const x of r.results.filter((x) => x.error)) notes.push(`${nameOf(x.stack)}: ${x.error}`);
  for (const x of r.reloads.filter((x) => x.error)) notes.push(`reload accounts failed in ${nameOf(x.stack)}: ${x.error}`);
  const failed = r.results.some((x) => x.error) || r.reloads.some((x) => x.error);
  toast({
    tone: failed ? (moved ? "warning" : "error") : notes.length ? (moved ? "warning" : "error") : "success",
    text: moved
      ? `${plural(moved, "account")} moved to ${nameOf(to)}; accounts reloaded in ${r.reloads.filter((x) => !x.error).map((x) => nameOf(x.stack)).join(", ") || "none"}${notes.length ? ` · ${notes.join(" · ")}` : ""}`
      : notes.join(" · ") || "Nothing to move",
  });
  return moved;
}

function useMove(nameOf: (id: string) => string) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async (to: string, body: Parameters<typeof endpoints.moveAccounts>[0]) => {
    setBusy(true);
    try {
      return report(await endpoints.moveAccounts(body), to, nameOf);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
      return 0;
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("account") });
    }
  };
  return { busy, run };
}

/** What can be done with the ticked accounts: move them to another stack. */
export function MoveBar({
  picked,
  stacks,
  nameOf,
  colorOf,
  onDone,
  onClear,
}: {
  picked: PickedAccount[];
  stacks: DragoniteInfo[];
  nameOf: (id: string) => string;
  colorOf: (id: string) => string;
  onDone: () => void;
  onClear: () => void;
}) {
  const [to, setTo] = useState<string>();
  const { busy, run } = useMove(nameOf);
  const leaving = (id: string) => picked.filter((a) => a.stack !== id);
  const from = to ? [...new Set(leaving(to).map((a) => a.stack))] : [];
  return (
    <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-popover/95 px-3 py-2 text-sm shadow-lg backdrop-blur">
      <span className="font-medium tabular-nums">{fmt.int(picked.length)} selected</span>
      <span className="mr-auto text-xs text-muted-foreground">Accounts in use when moving stay where they are.</span>
      {busy ? <Spinner className="size-4" /> : null}
      {stacks.map((d) => {
        const n = leaving(d.id).length;
        return (
          <Button key={d.id} size="sm" variant="outline" disabled={busy || !n} onClick={() => setTo(d.id)} title={n ? undefined : `All of them are in ${d.name}`}>
            <ArrowRightLeft />
            <span className="size-2 rounded-full" style={{ background: colorOf(d.id) }} />
            Move {n ? fmt.int(n) : ""} to {d.name}
          </Button>
        );
      })}
      <Button size="sm" variant="ghost" onClick={onClear} aria-label="Clear selection">
        <X />
      </Button>
      {to ? (
        <Modal
          open
          onClose={() => setTo(undefined)}
          title={`Move ${plural(leaving(to).length, "account")} to ${nameOf(to)}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setTo(undefined)}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  const target = to;
                  const accounts = leaving(target);
                  setTo(undefined);
                  if (await run(target, { to: target, accounts })) onDone();
                }}
              >
                Move
              </Button>
            </>
          }
        >
          <MoveText from={from.map(nameOf)} to={nameOf(to)} />
        </Modal>
      ) : null}
    </div>
  );
}

const list = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]);

function MoveText({ from, to }: { from: string[]; to: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      They leave {list(from)}'s database for {to}'s, with their level, token and timestamps. Then {list([...from, to])} reload their accounts. Accounts a worker is using by then stay where they are, and so do those {to} already has.
    </p>
  );
}

/** Move a number of available accounts: Nacli picks them, highest level first. */
export function MoveCountModal({
  stacks,
  nameOf,
  colorOf,
  onClose,
}: {
  stacks: DragoniteInfo[];
  nameOf: (id: string) => string;
  colorOf: (id: string) => string;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(stacks[0]?.id ?? "");
  const [to, setTo] = useState(stacks[1]?.id ?? "");
  const [count, setCount] = useState("");
  const { busy, run } = useMove(nameOf);
  // Every stack's free accounts, so each option in the menus shows its own.
  const available = useQueries({
    queries: stacks.map((d) => ({
      queryKey: ["accounts-available", d.id],
      queryFn: () => endpoints.allAccounts({ page: 0, perPage: 1, sortBy: "username", order: "asc", q: "", stack: d.id, inUse: false, status: "available" }),
    })),
  });
  const countOf = (id: string) => available[stacks.findIndex((d) => d.id === id)]?.data?.total;
  const loading = available[stacks.findIndex((d) => d.id === from)]?.isLoading;
  const max = countOf(from) ?? 0;
  const options = stacks.map((d) => ({ value: d.id, label: d.name, color: colorOf(d.id), count: countOf(d.id) }));
  // Picking the other side's stack swaps the two.
  const pickFrom = (v: string) => (setFrom(v), v === to && setTo(from));
  const pickTo = (v: string) => (setTo(v), v === from && setFrom(to));
  const n = Number(count);
  const valid = from && to && from !== to && Number.isInteger(n) && n >= 1 && n <= max;
  return (
    <Modal
      open
      onClose={onClose}
      icon={<ArrowRightLeft className="size-4" />}
      title="Move accounts"
      description="Available accounts, highest level first."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || busy}
            onClick={async () => {
              if (await run(to, { to, from, count: n })) onClose();
            }}
          >
            {busy ? <Spinner className="size-4" /> : <ArrowRightLeft />}
            Move
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label>From</Label>
            <FilterMenu value={from} onChange={pickFrom} options={options} label="From" className="w-full" />
          </div>
          <button
            type="button"
            onClick={() => (setFrom(to), setTo(from))}
            title="Swap"
            aria-label="Swap from and to"
            className="grid size-9 place-items-center rounded-full border bg-muted/40 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowRight className="size-4" />
          </button>
          <div className="flex flex-col gap-1.5">
            <Label>To</Label>
            <FilterMenu value={to} onChange={pickTo} options={options} label="To" className="w-full" />
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <Label>How many</Label>
          <Input type="number" min={1} max={max || undefined} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} className="w-40" />
          <span className="text-xs text-muted-foreground">
            {loading ? "Counting…" : `${plural(max, "available account")} in ${nameOf(from)}`}
          </span>
        </label>
        {from && to && from !== to ? <MoveText from={[nameOf(from)]} to={nameOf(to)} /> : null}
      </div>
    </Modal>
  );
}
