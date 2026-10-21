import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, Play } from "lucide-react";
import { useState } from "react";
import type { InstanceInfo, Job, JobInstance } from "@shared/types";
import { useNotify } from "@/components/actions";
import { AccentCard, Badge, Button, Dot, Modal, Spinner, Table } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useInstanceColor, useInstances, useStatus } from "@/lib/state";
import { fmt } from "@/lib/utils";

export function JobsPage() {
  const { visible } = useInstances();
  const color = useInstanceColor();
  const withJobs = visible.filter((i) => i.config?.jobs?.enable);
  const without = visible.filter((i) => !i.config?.jobs?.enable);

  return (
    <div className="animate-in flex flex-col gap-6">
      {withJobs.length === 0 ? (
        <JobsDisabled instances={without} color={color} />
      ) : (
        <>
          {withJobs.map((i) => (
            <AccentCard key={i.id} accent={color(i.id)} hover={false}>
              <InstanceJobs instanceId={i.id} name={i.name} />
            </AccentCard>
          ))}
          {without.length ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              No jobs:
              {without.map((i) => (
                <span key={i.id} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1">
                  <Dot color={color(i.id)} />
                  {i.name}
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Empty state when no instance has the jobs system enabled. */
function JobsDisabled({ instances, color }: { instances: InstanceInfo[]; color: (id: string) => string }) {
  return (
    <AccentCard accent="var(--series-7)" hover={false} className="mx-auto mt-6 w-full max-w-xl">
      <div className="flex flex-col items-center gap-5 px-6 py-8 text-center">
        <div className="grid size-12 place-items-center rounded-xl bg-muted">
          <BriefcaseBusiness className="size-6 text-violet-300" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold">Jobs are not enabled</h2>
          <p className="text-sm text-muted-foreground">
            Jobs let you run commands on devices from here, such as restarting an app or clearing its cache.
            They are enabled in each instance's <code className="text-foreground">rotom-ng.toml</code>.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {instances.map((i) => (
            <span
              key={i.id}
              className="inline-flex items-center gap-1.5 rounded-full border bg-background/40 px-2.5 py-1 text-xs"
            >
              <Dot color={color(i.id)} />
              {i.name}
              <span className="text-muted-foreground">· {i.reachable ? "disabled" : "offline"}</span>
            </span>
          ))}
        </div>

        <div className="w-full text-left">
          <div className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            To enable them, in rotom-ng.toml
          </div>
          <pre className="overflow-x-auto rounded-lg border bg-background/70 px-4 py-3 font-mono text-xs leading-5">
            <span className="text-sky-300">[jobs]</span>
            {"\n"}
            <span className="text-foreground">enable</span> = <span className="text-green-400">true</span>
            {"\n"}
            <span className="text-foreground">path</span> = <span className="text-amber-300">"./jobs"</span>
            <span className="text-muted-foreground">   # folder with the job files</span>
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            Only works if the device's MITM app supports jobs. After restarting Rotom, the instance will show up
            here on its own.
          </p>
        </div>
      </div>
    </AccentCard>
  );
}

function InstanceJobs({ instanceId, name }: { instanceId: string; name: string }) {
  const jobs = useQuery({
    queryKey: ["jobs", instanceId],
    queryFn: () => endpoints.rotom<{ jobs: Job[] }>(instanceId, "/job"),
  });
  const runs = useQuery({
    queryKey: ["job-instances", instanceId],
    queryFn: () => endpoints.rotom<{ instances: JobInstance[] }>(instanceId, "/job-instance"),
    refetchInterval: 5000,
  });
  const [running, setRunning] = useState<Job>();
  const { notify, node } = useNotify();

  return (
    <div className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">{name}</h2>
      {jobs.isLoading ? (
        <Spinner />
      ) : jobs.error ? (
        <p className="text-sm text-red-300">{(jobs.error as Error).message}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {jobs.data?.jobs.map((j) => (
            <div key={j.id} className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{j.id}</div>
                  <div className="text-xs text-muted-foreground">{j.description}</div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setRunning(j)}>
                  <Play /> Run
                </Button>
              </div>
              <code className="truncate rounded bg-background/60 px-2 py-1 text-[11px] text-muted-foreground" title={j.exec}>
                {j.exec}
              </code>
            </div>
          ))}
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold">Recent runs</h3>
        {runs.data?.instances.length ? (
          <Table>
            <thead>
              <tr>
                <th>#</th>
                <th>Job</th>
                <th>Device</th>
                <th>Status</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.instances.slice(0, 50).map((r) => (
                <tr key={r.id}>
                  <td className="tabular-nums text-muted-foreground">{r.id}</td>
                  <td>{r.job_id}</td>
                  <td>{r.device_origin || r.device_id}</td>
                  <td>
                    <Badge tone={r.status === "completed" ? "good" : r.status === "running" ? "info" : "bad"}>{r.status}</Badge>
                  </td>
                  <td className="whitespace-nowrap">{fmt.time(r.started_at_ms)}</td>
                  <td className="tabular-nums">{r.finished_at_ms ? fmt.duration(r.finished_at_ms - r.started_at_ms) : "…"}</td>
                  <td className="max-w-72 truncate text-xs text-muted-foreground" title={r.result}>
                    {r.result || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No runs.</p>
        )}
      </div>
      {running ? (
        <RunJobModal instanceId={instanceId} job={running} onClose={() => setRunning(undefined)} notify={notify} />
      ) : null}
      {node}
    </div>
  );
}

function RunJobModal({
  instanceId,
  job,
  onClose,
  notify,
}: {
  instanceId: string;
  job: Job;
  onClose: () => void;
  notify: (m: { text: string; error?: boolean }) => void;
}) {
  const { data } = useStatus();
  const qc = useQueryClient();
  const devices = (data?.devices ?? []).filter((d) => d.instanceId === instanceId && d.is_connected);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await endpoints.rotom(instanceId, `/job/${encodeURIComponent(job.id)}/run`, {
        method: "PUT",
        body: JSON.stringify({ device_ids: [...picked] }),
      });
      notify({ text: `Job ${job.id} started on ${picked.size} device${picked.size === 1 ? "" : "s"}` });
      qc.invalidateQueries({ queryKey: ["job-instances", instanceId] });
      onClose();
    } catch (e) {
      notify({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Run ${job.id}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={picked.size === 0} loading={busy} onClick={run}>
            Run on {picked.size}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 border-b pb-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={picked.size === devices.length && devices.length > 0}
            onChange={(e) => setPicked(e.target.checked ? new Set(devices.map((d) => d.id)) : new Set())}
          />
          Select all ({devices.length} online)
        </label>
        {devices.map((d) => (
          <label key={d.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={picked.has(d.id)}
              onChange={(e) => {
                const n = new Set(picked);
                if (e.target.checked) n.add(d.id);
                else n.delete(d.id);
                setPicked(n);
              }}
            />
            {d.origin}
            <span className="truncate font-mono text-[11px] text-muted-foreground">{d.id}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}
