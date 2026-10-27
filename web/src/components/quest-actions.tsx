// Start or stop quest scanning, as Dragonite's admin quest buttons do: in one
// area or in every active area of a stack.

import { useQueryClient } from "@tanstack/react-query";
import { Check, CirclePlay, CircleStop, X } from "lucide-react";
import { useState } from "react";
import type { AreaQuests, DragoniteArea, DragoniteInfo } from "@shared/types";
import { useStacks } from "@/components/stack-tag";
import { toast } from "@/components/toaster";
import { Button, Modal, Spinner } from "@/components/ui";
import { endpoints } from "@/lib/api";

/**
 * Areas where quests were started from here, by "stack:area", and when: their
 * share is read every 15 s from the start, before Dragonite's workers switch
 * to quests (which is what marks an area as scanning otherwise).
 */
const started = new Map<string, number>();

/** Areas of a stack whose quest scan was started here in the last 5 minutes. */
export function questsStarted(stack: string): number[] {
  const now = Date.now();
  const out: number[] = [];
  for (const [k, at] of started) {
    if (now - at > 5 * 60_000) started.delete(k);
    else if (k.startsWith(`${stack}:`)) out.push(Number(k.slice(stack.length + 1)));
  }
  return out;
}

export interface QuestRequest {
  action: "start" | "stop";
  /** One area; none means every active area of the stack. */
  area?: DragoniteArea;
}

export function QuestModal({
  stack,
  areas,
  request,
  onClose,
}: {
  stack: DragoniteInfo;
  /** The stack's areas, to name them in the result. */
  areas: DragoniteArea[];
  request: QuestRequest;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { action, area } = request;
  // Dragonite clears the stored quests when starting unless told not to.
  const [clear, setClear] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<Awaited<ReturnType<typeof endpoints.questAction>>>();
  const start = action === "start";
  const { on } = useStacks();
  const where = area ? area.name : `every active area${on(stack.id, "of")}`;
  const name = (id: string) => areas.find((a) => String(a.id) === id)?.name ?? `Area ${id}`;

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await endpoints.questAction(stack.id, action, { area: area?.id, clear: start && clear });
      setResult(r);
      const done = area ? (r.errors[area.id] ? [] : [area.id]) : Object.keys(r.areas).filter((id) => r.areas[id]).map(Number);
      for (const id of done) {
        if (start) started.set(`${stack.id}:${id}`, Date.now());
        else started.delete(`${stack.id}:${id}`);
      }
      // Dragonite has just cleared their quests: 0% at once, then Golbat's reads take over.
      if (start && clear) {
        qc.setQueryData<AreaQuests>(["area-quests", stack.id], (old) => {
          if (!old) return old;
          const next = { ...old };
          for (const id of done) {
            const q = next[id];
            if (q && !("error" in q)) next[id] = { ...q, ar: 0, noAr: 0 };
          }
          return next;
        });
      }
      qc.invalidateQueries({ queryKey: ["area-quests", stack.id] });
      const failed = Object.keys(r.errors).length;
      toast({
        tone: failed ? "warning" : "success",
        text: `Quests ${start ? "started" : "stopped"} in ${where}${failed ? ` · ${failed} failed` : ""}`,
      });
      qc.invalidateQueries({ queryKey: ["dragonite-areas", stack.id] });
      // A single area answers with just its message: nothing more to show.
      if (area && !failed) onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ok = result ? Object.entries(result.areas).filter(([, v]) => v) : [];
  const failed = result ? Object.entries(result.errors) : [];

  return (
    <Modal
      open
      onClose={onClose}
      title={`${start ? "Start" : "Stop"} quests`}
      footer={
        result ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant={start ? "default" : "destructive"}
              className={start ? "bg-green-600 text-white hover:bg-green-700" : undefined}
              onClick={run}
              disabled={busy}
            >
              {busy ? <Spinner className="size-4" /> : start ? <CirclePlay /> : <CircleStop />}
              {start ? "Start" : "Stop"}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-2">
          {result.message ? <p className="text-muted-foreground">{result.message}</p> : null}
          {ok.length ? (
            <div className="flex flex-col gap-1">
              {ok.map(([id]) => (
                <span key={id} className="flex items-center gap-2">
                  <Check className="size-4 text-green-400" />
                  {name(id)}
                </span>
              ))}
            </div>
          ) : null}
          {failed.map(([id, why]) => (
            <span key={id} className="flex items-start gap-2">
              <X className="mt-0.5 size-4 shrink-0 text-red-400" />
              <span>
                {name(id)} <span className="text-muted-foreground">· {why}</span>
              </span>
            </span>
          ))}
          {!ok.length && !failed.length && !result.message ? <p className="text-muted-foreground">Done.</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p>
            {start ? "Quest scanning will start in " : "Quest scanning will stop in "}
            <b>{where}</b>
            {start ? ", using the workers of its Pokémon and Fort modes." : "."}
          </p>
          {start ? (
            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
              <span>
                Clear the current quests first
                <span className="block text-[11px] text-muted-foreground">Dragonite's default: every Pokéstop is scanned again.</span>
              </span>
            </label>
          ) : null}
          {error ? <p className="text-red-300">{error}</p> : null}
        </div>
      )}
    </Modal>
  );
}
