import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useState } from "react";
import { endpoints, setUnauthorizedHandler } from "@/lib/api";
import { AccentCard, Button, Input, Spinner } from "./ui";

interface AuthState {
  username: string;
  title: string;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);
export const useAuth = () => useContext(AuthCtx)!;

export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: endpoints.me, staleTime: Number.POSITIVE_INFINITY });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(["me"], (old: { title?: string } | undefined) => ({
        authenticated: false,
        title: old?.title ?? "",
      }));
    });
  }, [qc]);

  useEffect(() => {
    if (me.data?.title) document.title = me.data.title;
  }, [me.data?.title]);

  if (me.isLoading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner />
      </div>
    );
  }

  if (!me.data?.authenticated) {
    return (
      <LoginPage
        title={me.data?.title || "Nacli"}
        onSuccess={async () => {
          // Keep the ["me"] query (its observer is mounted) and drop the rest.
          qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
          await qc.refetchQueries({ queryKey: ["me"] });
        }}
      />
    );
  }

  const logout = async () => {
    await endpoints.logout().catch(() => {});
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    qc.setQueryData(["me"], { authenticated: false, title: me.data?.title });
  };

  return (
    <AuthCtx.Provider value={{ username: me.data.username ?? "", title: me.data.title, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

function LoginPage({ title, onSuccess }: { title: string; onSuccess: () => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await endpoints.login(username, password);
      await onSuccess();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(closest-side, oklch(48.8% 0.243 264.376), transparent)" }}
      />
      <AccentCard accent="var(--series-1)" hover={false} className="animate-in w-full max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-5 p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <img src="/nacli.png" alt="" width={96} height={96} className="size-24 drop-shadow-lg" />
            <div>
              <h1 className="text-xl font-bold">{title}</h1>
              <p className="text-xs text-muted-foreground">Sign in to continue</p>
            </div>
          </div>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">Username</span>
            <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">Password</span>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error ? (
            <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          ) : null}
          <Button type="submit" loading={busy}>
            {busy ? null : <Lock />}
            Sign in
          </Button>
        </form>
      </AccentCard>
    </div>
  );
}
