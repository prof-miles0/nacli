// One account, read from its stack's Dragonite database: everything Dragonite
// stores about it but the password and refresh token (which never leave the
// server), and a form to change what an admin may need to fix by hand.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, UserRound } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { AccountChanges, AccountRow } from "@shared/types";
import { SwitchRow } from "@/components/area-form";
import { StackTag } from "@/components/stack-tag";
import { toast } from "@/components/toaster";
import { Button, Input, Label, Modal, Select, Spinner } from "@/components/ui";
import { endpoints } from "@/lib/api";
import { cn, fmt } from "@/lib/utils";

const PROVIDERS = ["ptc", "google"];

/** Unix seconds (Dragonite's columns) to a time, or nothing for 0 and null. */
const ts = (s: number | null | undefined) => (s && s > 1 ? s * 1000 : undefined);
/** "2h 5m ago" or "in 1d 3h" (a warning's expiry, the next time it may be used), and the date. */
const when = (s: number | null | undefined) => {
  const t = ts(s);
  if (!t) return "—";
  const rel = t > Date.now() ? `in ${fmt.duration(t - Date.now())}` : fmt.ago(t);
  return `${rel} · ${fmt.time(t)}`;
};
/** A datetime-local input's value and back, in the browser's time zone. */
const toLocal = (s: number | null | undefined) => {
  const t = ts(s);
  if (!t) return "";
  const d = new Date(t);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? Math.round(new Date(v).getTime() / 1000) : 0);

interface Form {
  email: string;
  provider: string;
  level: string;
  warn: boolean;
  warnUntil: string;
  suspended: boolean;
  banned: boolean;
  invalid: boolean;
  clearAuthBan: boolean;
  clearToken: boolean;
  password: string;
}

const formOf = (a: AccountRow): Form => ({
  email: a.email ?? "",
  provider: a.provider,
  level: String(a.level),
  warn: a.warn,
  warnUntil: toLocal(a.warn_expiration),
  suspended: a.suspended,
  banned: a.banned,
  invalid: a.invalid,
  clearAuthBan: false,
  clearToken: false,
  password: "",
});

/** Only what differs from the account as it was read. */
function changesOf(a: AccountRow, f: Form): AccountChanges {
  const c: AccountChanges = {};
  if (f.email.trim() !== (a.email ?? "")) c.email = f.email.trim() || null;
  if (f.provider !== a.provider) c.provider = f.provider;
  if (Number(f.level) !== a.level) c.level = Number(f.level);
  if (f.warn !== a.warn) c.warn = f.warn;
  // Compared as the field shows it (to the minute), so an untouched field is no change.
  if (f.warnUntil !== toLocal(a.warn_expiration)) c.warn_expiration = fromLocal(f.warnUntil);
  if (f.suspended !== a.suspended) c.suspended = f.suspended;
  if (f.banned !== a.banned) c.banned = f.banned;
  if (f.invalid !== a.invalid) c.invalid = f.invalid;
  if (f.clearAuthBan) c.clear_auth_ban = true;
  if (f.clearToken) c.clear_refresh_token = true;
  if (f.password) c.password = f.password;
  return c;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className="text-sm tabular-nums">{children}</span>
    </div>
  );
}

/** The account's modal: what Dragonite stores, and the form to change it (not while in use). */
export function AccountModal({ stack, username, onClose }: { stack: string; username: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["account-one", stack, username], queryFn: () => endpoints.account(stack, username) });
  const a = q.data?.account;
  const [form, setForm] = useState<Form>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (a && !form) setForm(formOf(a));
  }, [a, form]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const changes = a && form ? changesOf(a, form) : {};
  const level = Number(form?.level);
  const invalidLevel = !Number.isInteger(level) || level < 0 || level > 80;
  const locked = !!q.data?.inUse;

  const save = async () => {
    setBusy(true);
    try {
      const r = await endpoints.editAccount(stack, username, changes);
      toast(
        r.reloadError
          ? { tone: "warning", text: `${username} saved, but Dragonite did not reload its accounts: ${r.reloadError}` }
          : { tone: "success", text: `${username} saved; Dragonite reloaded its accounts` },
      );
      void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith("account") });
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      icon={<UserRound />}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{username}</span>
          <StackTag id={stack} />
        </span>
      }
      description={locked ? "In use by a worker: it can be edited once it is let go." : "From the stack's Dragonite database."}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {locked ? "Close" : "Cancel"}
          </Button>
          {locked ? null : (
            <Button disabled={busy || !Object.keys(changes).length || invalidLevel} onClick={save}>
              {busy ? <Spinner className="size-4" /> : null}
              Save
            </Button>
          )}
        </>
      }
    >
      {q.error ? (
        <p className="text-sm text-red-300">{(q.error as Error).message}</p>
      ) : !a || !form ? (
        <Spinner className="mx-auto my-10" />
      ) : (
        <fieldset disabled={locked || busy} className={cn("flex flex-col gap-5", locked && "[&_input]:opacity-60 [&_select]:opacity-60 [&_[role=switch]]:opacity-60")}>
          <section className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <Label>Level</Label>
              <Input type="number" min={0} max={80} value={form.level} onChange={(e) => set("level", e.target.value)} className={cn(invalidLevel && "border-red-500/60")} />
            </label>
            <label className="flex flex-col gap-1.5">
              <Label>Provider</Label>
              <Select value={form.provider} onChange={(e) => set("provider", e.target.value)}>
                {[...new Set([...PROVIDERS, a.provider])].map((p) => (
                  <option key={p} value={p}>
                    {p.toUpperCase()}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="none" />
            </label>
          </section>

          <section className="flex flex-col gap-2">
            <Label>State</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <SwitchRow title="Warned" hint={a.warn ? `Until ${when(a.warn_expiration)}` : "Niantic's warning"} on={form.warn} onChange={(v) => set("warn", v)} />
              <SwitchRow title="Suspended" hint={a.last_suspended ? `Last ${when(a.last_suspended)}` : "Never"} on={form.suspended} onChange={(v) => set("suspended", v)} />
              <SwitchRow title="Banned" hint={a.last_banned ? `Last ${when(a.last_banned)}` : "Never"} on={form.banned} onChange={(v) => set("banned", v)} />
              <SwitchRow title="Invalid" hint="Dragonite will not use it" on={form.invalid} onChange={(v) => set("invalid", v)} />
            </div>
            {form.warn ? (
              <label className="flex flex-col gap-1.5 sm:w-1/2">
                <span className="text-xs text-muted-foreground">Warning expires</span>
                <Input type="datetime-local" value={form.warnUntil} onChange={(e) => set("warnUntil", e.target.value)} />
              </label>
            ) : null}
            {a.auth_banned ? (
              <SwitchRow
                title="Lift the login ban"
                hint={`The provider refused its login ${when(a.auth_banned)}`}
                on={form.clearAuthBan}
                onChange={(v) => set("clearAuthBan", v)}
              />
            ) : null}
          </section>

          <section className="flex flex-col gap-2">
            <Label>Login</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">New password</span>
                <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="unchanged" />
              </label>
              <div className="flex items-end">
                {a.has_refresh_token ? (
                  <SwitchRow
                    title={
                      <span className="inline-flex items-center gap-1.5">
                        <KeyRound className="size-3.5 text-green-400" />
                        Clear the refresh token
                      </span>
                    }
                    hint={`Refreshed ${when(a.last_refreshed)}; Dragonite logs in again`}
                    on={form.clearToken}
                    onChange={(v) => set("clearToken", v)}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">No refresh token stored: Dragonite logs in with the password.</span>
                )}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-3">
            <Fact label="Last used">{when(a.last_selected)}</Fact>
            <Fact label="Released">{when(a.last_released)}</Fact>
            <Fact label="Next available">{when(a.next_available_time)}</Fact>
            <Fact label="Last disabled">{when(a.last_disabled)}</Fact>
            <Fact label="Disables in a row">{a.consecutive_disable_count ?? 0}</Fact>
            <Fact label="AR ban check">{a.ar_ban_last_checked ? `${a.ar_ban_state ?? "?"} · ${when(a.ar_ban_last_checked)}` : "—"}</Fact>
          </section>
        </fieldset>
      )}
    </Modal>
  );
}
