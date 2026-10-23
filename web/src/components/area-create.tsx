// A new area with the same fields as Dragonite's admin "Create", in one or
// several stacks. At most one of them gets it enabled: two stacks scanning the
// same place only repeat each other's work.

import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { useState } from "react";
import type { DragoniteInfo } from "@shared/types";
import { AreaForm, type Draft, EMPTY, type FormTab, problems, SwitchRow, toArea } from "@/components/area-form";
import { StackTag } from "@/components/stack-tag";
import { toast } from "@/components/toaster";
import { Button, Label, Modal, Spinner } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useAppInfo, useInstanceColor } from "@/lib/state";
import { cn } from "@/lib/utils";

export function CreateAreaModal({ stacks, initial, onClose }: { stacks: DragoniteInfo[]; initial?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const color = useInstanceColor();
  const [targets, setTargets] = useState<string[]>(initial ? [initial] : stacks.slice(0, 1).map((d) => d.id));
  // Which chosen stack scans it (one at most); the rest keep it disabled.
  const [enabledIn, setEnabledIn] = useState<string>();
  const [tab, setTab] = useState<FormTab>("general");
  const [d, setD] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [results, setResults] = useState<{ stack: string; id?: number; enabled?: boolean; error?: string }[]>();
  const set = <K extends keyof Draft>(k: K, v: Partial<Draft[K]> | Draft[K]) => setD((x) => ({ ...x, [k]: typeof v === "object" && !Array.isArray(v) ? { ...(x[k] as object), ...v } : v }));
  const name = (id: string) => stacks.find((s) => s.id === id)?.name ?? id;
  const multi = stacks.length > 1;

  // Names already used in the chosen stacks (Dragonite allows it, but it confuses).
  const lists = useQueries({ queries: stacks.map((s) => ({ queryKey: ["dragonite-areas", s.id], queryFn: () => endpoints.dragoniteAreas(s.id) })) });
  const taken = stacks.filter((s, i) => targets.includes(s.id) && lists[i].data?.areas.some((a) => a.name.trim().toLowerCase() === d.name.trim().toLowerCase())).map((s) => s.name);

  const errs = problems(d);
  const { data: app } = useAppInfo();
  const canRun = targets.length > 0 && !Object.keys(errs).length && !busy;
  const enabledTarget = enabledIn && targets.includes(enabledIn) ? enabledIn : undefined;

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await endpoints.createArea({ stacks: targets, enabledIn: enabledTarget, area: toArea(d) });
      setResults(r.results);
      const ok = r.results.filter((x) => !x.error);
      const bad = r.results.filter((x) => x.error);
      toast({
        tone: bad.length ? (ok.length ? "warning" : "error") : "success",
        text: ok.length
          ? `Area “${d.name.trim()}” created${multi ? ` in ${ok.map((x) => name(x.stack)).join(", ")}` : ""}${bad.length ? ` · failed in ${bad.map((x) => name(x.stack)).join(", ")}` : ""}`
          : bad.map((x) => (multi ? `${name(x.stack)}: ${x.error}` : x.error)).join(" · "),
      });
      for (const s of targets) {
        qc.invalidateQueries({ queryKey: ["dragonite-areas", s] });
      }
      qc.invalidateQueries({ queryKey: ["dragonite-geofences"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      large
      tall
      onClose={onClose}
      title="New area"
      footer={
        results ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={run} disabled={!canRun}>
              {busy ? <Spinner className="size-4" /> : <Plus />}
              {multi ? `Create in ${targets.map(name).join(", ") || "…"}` : "Create"}
            </Button>
          </>
        )
      }
    >
      {results ? (
        <div className="flex flex-col gap-2">
          {results.map((r) => (
            <div key={r.stack} className="flex items-center gap-2 rounded-lg border px-3 py-2">
              {r.error ? <X className="size-4 shrink-0 text-red-400" /> : <Check className="size-4 shrink-0 text-green-400" />}
              <StackTag id={r.stack} className="font-medium" />
              <span className="min-w-0 text-muted-foreground">{r.error ?? `created (id ${r.id}), ${r.enabled ? "enabled" : "disabled"}`}</span>
            </div>
          ))}
        </div>
      ) : (
        <form
          className="flex min-h-full flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canRun) run();
          }}
        >
          <AreaForm
            d={d}
            set={set}
            errs={errs}
            tab={tab}
            setTab={setTab}
            create
            basemap={app?.map}
            nameNote={
              taken.length && d.name.trim() ? (
                <p className="-mt-2 text-[11px] text-amber-400">
                  {taken.join(" and ")} already {taken.length === 1 ? "has" : "have"} an area with this name.
                </p>
              ) : null
            }
            general={
              // With one stack there is nothing to choose: just its Enabled switch.
              !multi ? (
                <SwitchRow
                  title="Area enabled"
                  hint={enabledTarget ? "Its workers will scan it right away" : "Created disabled, ready to switch on"}
                  on={!!enabledTarget}
                  onChange={(v) => setEnabledIn(v ? targets[0] : undefined)}
                />
              ) : (
                <div className="flex flex-col gap-3 rounded-lg border px-3 py-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Create in</Label>
                    <div className="flex flex-wrap gap-2">
                      {stacks.map((s) => {
                        const on = targets.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setTargets(on ? targets.filter((x) => x !== s.id) : [...targets, s.id])}
                            className={cn("inline-flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-accent", on && "border-primary bg-accent")}
                          >
                            <span className={cn("grid size-4 place-items-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                              {on ? <Check className="size-3" strokeWidth={3} /> : null}
                            </span>
                            <span className="size-2.5 rounded-full" style={{ background: s.rotom ? color(s.rotom) : "var(--muted-foreground)" }} />
                            {s.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {targets.length ? (
                    <div className="flex flex-col gap-1.5">
                      <Label>Enabled</Label>
                      {/* One switch per stack; turning one on turns the others off. */}
                      {targets.map((id) => {
                        const st = stacks.find((x) => x.id === id);
                        return (
                          <SwitchRow
                            key={id}
                            title={targets.length > 1 ? `Enabled in ${name(id)}` : "Area enabled"}
                            hint={enabledTarget === id ? "Its workers will scan it right away" : "Created disabled, ready to switch on"}
                            dot={targets.length > 1 ? (st?.rotom ? color(st.rotom) : "var(--muted-foreground)") : undefined}
                            on={enabledTarget === id}
                            onChange={(v) => setEnabledIn(v ? id : undefined)}
                          />
                        );
                      })}
                      {targets.length > 1 ? <span className="text-[11px] text-muted-foreground">Only one stack should scan it; the others get it disabled, ready to switch over.</span> : null}
                    </div>
                  ) : null}
                </div>
              )
            }
          />
          {error ? <p className="text-red-300">{error}</p> : null}
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}
