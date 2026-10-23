// Adding accounts as Dragonite's admin does ("Create One Account" and "Import
// multiple accounts"), plus the stack they go to: one only, since an account
// belongs to a single stack.

import { useQueryClient } from "@tanstack/react-query";
import { Check, FileUp, Plus, Upload, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type { AccountImportResult, DragoniteInfo } from "@shared/types";
import { StackTag } from "@/components/stack-tag";
import { toast } from "@/components/toaster";
import { AddChoice, Button, Input, Label, Modal, Select, Spinner, Table } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { useInstanceColor } from "@/lib/state";
import { cn, fmt } from "@/lib/utils";

/** The admin's providers, with its names. */
const PROVIDERS = [
  { id: "ptc", name: "Pokemon Club" },
  { id: "nk", name: "Niantic Kids" },
  { id: "g", name: "Google" },
  { id: "fb", name: "Facebook" },
];
const LEVEL_MAX = 100;
/** The admin's "Use Immediately": released at unix second 1, so available now. */
const USE_NOW = 1;

/** After adding accounts: the counts, lists and duplicates are stale. */
function useForgetAccounts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("account") });
}

/** Pick the one stack the accounts go to. */
function StackChoice({ stacks, value, onChange }: { stacks: DragoniteInfo[]; value?: string; onChange: (id: string) => void }) {
  const color = useInstanceColor();
  return (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {stacks.map((d) => {
        const on = value === d.id;
        return (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(d.id)}
            className={cn("inline-flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-accent", on && "border-primary bg-accent")}
          >
            <span className={cn("grid size-4 place-items-center rounded-full border", on ? "border-primary" : "border-input")}>
              {on ? <span className="size-2 rounded-full bg-primary" /> : null}
            </span>
            <span className="size-2.5 rounded-full" style={{ background: d.rotom ? color(d.rotom) : "var(--muted-foreground)" }} />
            {d.name}
          </button>
        );
      })}
    </div>
  );
}

const field = "flex flex-col gap-1.5";
const noSpaces = (v: string) => !!v && !/\s/.test(v);
const levelOk = (v: string) => /^\d+$/.test(v) && Number(v) <= LEVEL_MAX;

function ProviderSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {PROVIDERS.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

/** Accounts' "Add": one account, or several imported from a CSV; the choice sits at the top. */
export function AddAccountsModal({ stacks, onClose }: { stacks: DragoniteInfo[]; onClose: () => void }) {
  const [kind, setKind] = useState<"one" | "import">("one");
  const [switched, setSwitched] = useState(false);
  const choice = (
    <AddChoice
      value={kind}
      onChange={(v) => {
        setKind(v);
        setSwitched(true);
      }}
      options={[
        { value: "one", label: "One account", hint: "Username and password", icon: <Plus /> },
        { value: "import", label: "Import several", hint: "Paste or load a CSV", icon: <Upload /> },
      ]}
    />
  );
  return kind === "one" ? (
    <CreateAccountModal stacks={stacks} onClose={onClose} choice={choice} still={switched} />
  ) : (
    <ImportAccountsModal stacks={stacks} onClose={onClose} choice={choice} still={switched} />
  );
}

/** What AddAccountsModal passes each form: its choice on top, and no entrance animation after a switch. */
interface Chosen {
  choice?: ReactNode;
  still?: boolean;
}

/** The admin's "Create One Account": username, password, provider and level. */
function CreateAccountModal({ stacks, onClose, choice, still }: { stacks: DragoniteInfo[]; onClose: () => void } & Chosen) {
  const forget = useForgetAccounts();
  const [stack, setStack] = useState(stacks.length === 1 ? stacks[0].id : undefined);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [provider, setProvider] = useState("ptc");
  const [level, setLevel] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // With one stack, its name would only repeat itself.
  const stackName = stacks.length > 1 ? stacks.find((d) => d.id === stack)?.name : undefined;
  const canRun = !!stack && noSpaces(username) && noSpaces(password) && levelOk(level) && !busy;

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await endpoints.createAccount(stack!, { username, password, provider, level: Number(level) });
      toast({ tone: "success", text: `Account ${username} created${stackName ? ` in ${stackName}` : ""}` });
      forget();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      wide
      still={still}
      onClose={onClose}
      title={choice ? "Add accounts" : "Create one account"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={run} disabled={!canRun}>
            {busy ? <Spinner className="size-4" /> : <Plus />}
            Create{stackName ? ` in ${stackName}` : ""}
          </Button>
        </>
      }
    >
      {choice}
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canRun) run();
        }}
      >
        {stacks.length > 1 ? (
          <div className={field}>
            <Label>Stack</Label>
            <StackChoice stacks={stacks} value={stack} onChange={setStack} />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={field}>
            <Label>Username</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value.trim())} autoComplete="off" spellCheck={false} autoFocus />
          </label>
          <label className={field}>
            <Label>Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </label>
          <label className={field}>
            <Label>Provider</Label>
            <ProviderSelect value={provider} onChange={setProvider} />
          </label>
          <label className={field}>
            <Label>Level</Label>
            <Input type="number" min={0} max={LEVEL_MAX} value={level} onChange={(e) => setLevel(e.target.value)} />
          </label>
        </div>
        {password && /\s/.test(password) ? <p className="-mt-2 text-[11px] text-amber-400">The password cannot contain spaces.</p> : null}
        {error ? <p className="text-red-300">{error}</p> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/**
 * The accounts in a CSV, one "username,password" per line, as the admin reads
 * it: the separator is guessed (comma, tab, semicolon, pipe or colon), quotes
 * are removed, and lines without both values are dropped.
 */
export function parseAccounts(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sep = [",", "\t", ";", "|", ":"].find((c) => lines.length && lines.every((l) => l.includes(c))) ?? ",";
  // Split one line on the separator, keeping quoted values (with "" for a quote) whole.
  const cells = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"' && !cur.trim()) (quoted = true), (cur = "");
      else if (ch === sep) out.push(cur.trim()), (cur = "");
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  return lines
    .map(cells)
    .map(([username = "", password = ""]) => ({ username, password }))
    .filter((a) => a.username && a.password);
}

/** datetime-local value for now, in local time. */
const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset(), 0, 0);
  return d.toISOString().slice(0, 16);
};

/** The admin's "Import multiple accounts": a CSV plus level, provider and release time. */
function ImportAccountsModal({ stacks, onClose, choice, still }: { stacks: DragoniteInfo[]; onClose: () => void } & Chosen) {
  const forget = useForgetAccounts();
  const file = useRef<HTMLInputElement>(null);
  const [stack, setStack] = useState(stacks.length === 1 ? stacks[0].id : undefined);
  const [csv, setCsv] = useState("");
  const [level, setLevel] = useState("0");
  const [provider, setProvider] = useState("ptc");
  const [useNow, setUseNow] = useState(true);
  const [released, setReleased] = useState(localNow);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<AccountImportResult>();
  const name = (id?: string) => stacks.find((d) => d.id === id)?.name ?? id ?? "";
  // " into X" / " in X", only when there is more than one stack to tell apart.
  const into = (prep: string) => (stacks.length > 1 && stack ? ` ${prep} ${name(stack)}` : "");
  const accounts = parseAccounts(csv);
  const releasedS = useNow ? USE_NOW : Math.floor(new Date(released).getTime() / 1000);
  const withSpaces = accounts.filter((a) => /\s/.test(a.username) || /\s/.test(a.password)).length;
  const canRun = !!stack && accounts.length > 0 && !withSpaces && levelOk(level) && Number.isFinite(releasedS) && !busy;

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await endpoints.importAccounts(stack!, { accounts, level: Number(level), provider, last_released: releasedS });
      setResult(r);
      toast({
        tone: r.inserted ? (r.elsewhere.length ? "warning" : "success") : "info",
        text: `${fmt.int(r.inserted)} account${r.inserted === 1 ? "" : "s"} imported${into("into")}${
          r.elsewhere.length ? ` · ${fmt.int(r.elsewhere.length)} left out (in another stack)` : ""
        }`,
      });
      forget();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      wide
      still={still}
      onClose={onClose}
      title={choice ? "Add accounts" : "Import multiple accounts"}
      footer={
        result ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={run} disabled={!canRun}>
              {busy ? <Spinner className="size-4" /> : <Upload />}
              Import {accounts.length ? fmt.int(accounts.length) : ""}
              {into("into")}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-2">
          <ResultRow ok text={`${fmt.int(result.inserted)} imported${into("into")}`} />
          {result.alreadyHere ? <ResultRow text={`${fmt.int(result.alreadyHere)} already ${stacks.length > 1 ? `in ${name(stack)}` : "there"} (skipped by Dragonite)`} /> : null}
          {result.repeated ? <ResultRow text={`${fmt.int(result.repeated)} repeated in the list`} /> : null}
          {result.elsewhere.length ? (
            <div className="flex flex-col gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <span className="flex items-center gap-2 font-medium text-amber-300">
                <X className="size-4" />
                {fmt.int(result.elsewhere.length)} left out: already in another stack
              </span>
              <ul className="max-h-40 overflow-auto font-mono text-xs text-muted-foreground">
                {result.elsewhere.map((o) => (
                  <li key={o.username}>
                    {o.username} ·{" "}
                    {o.stacks.map((id) => (
                      <StackTag key={id} id={id} className="mr-2 align-middle" />
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {choice}
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canRun) run();
            }}
          >
            {stacks.length > 1 ? (
              <div className={field}>
                <Label>Stack</Label>
                <StackChoice stacks={stacks} value={stack} onChange={setStack} />
              </div>
            ) : null}
            <label className={field}>
              <span className="flex items-center justify-between gap-2">
                <Label>Accounts</Label>
                <button type="button" onClick={() => file.current?.click()} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <FileUp className="size-3.5" />
                  Load a file
                </button>
              </span>
              <textarea
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                rows={7}
                spellCheck={false}
                autoComplete="off"
                placeholder={"username,password\nusername,password"}
                className="rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="text-[11px] text-muted-foreground">CSV of the accounts list, one account per line.</span>
              <input
                ref={file}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setCsv(await f.text());
                  e.target.value = "";
                }}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={field}>
                <Label>Level</Label>
                <Input type="number" min={0} max={LEVEL_MAX} value={level} onChange={(e) => setLevel(e.target.value)} />
              </label>
              <label className={field}>
                <Label>Provider</Label>
                <ProviderSelect value={provider} onChange={setProvider} />
              </label>
              <label className="flex cursor-pointer items-center gap-2 self-end pb-2">
                <input type="checkbox" checked={useNow} onChange={(e) => setUseNow(e.target.checked)} className="size-4 accent-[var(--primary)]" />
                Use immediately
              </label>
              <label className={field}>
                <Label>Last released</Label>
                <Input type="datetime-local" value={released} onChange={(e) => setReleased(e.target.value)} disabled={useNow} />
              </label>
            </div>
            {withSpaces ? <p className="text-[11px] text-amber-400">{fmt.int(withSpaces)} line(s) have spaces in the username or password.</p> : null}
            {accounts.length ? (
              <div className="flex flex-col gap-1.5">
                <Label>
                  Preview · {fmt.int(accounts.length)} account{accounts.length === 1 ? "" : "s"}
                </Label>
                <div className="max-h-48 overflow-auto rounded-lg border">
                  <Table>
                    <thead>
                      <tr>
                        <th>Username</th>
                        <th>Password</th>
                        <th>Level</th>
                        <th>Provider</th>
                        <th>Last released</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.slice(0, 100).map((a, i) => (
                        <tr key={i}>
                          <td className="font-mono text-xs">{a.username}</td>
                          <td className="text-muted-foreground">••••••</td>
                          <td className="tabular-nums">{level}</td>
                          <td>{provider}</td>
                          <td className="text-muted-foreground">{useNow ? "Use immediately" : new Date(released).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
                {accounts.length > 100 ? <span className="text-[11px] text-muted-foreground">Showing the first 100.</span> : null}
              </div>
            ) : null}
            {error ? <p className="text-red-300">{error}</p> : null}
            <button type="submit" hidden />
          </form>
        </>
      )}
    </Modal>
  );
}

function ResultRow({ ok, text }: { ok?: boolean; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
      {ok ? <Check className="size-4 text-green-400" /> : <span className="size-4 text-center text-muted-foreground">·</span>}
      {text}
    </div>
  );
}
