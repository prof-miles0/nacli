import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, CircleHelp, LogOut, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { type Theme, useTheme } from "@/lib/theme";
import { cn, fmt } from "@/lib/utils";
import { useAuth } from "./auth";
import { Button } from "./ui";

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="px-2 py-1.5 text-sm font-semibold">{children}</div>
);

const itemClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";

/**
 * When the data on screen last arrived: the newest answer among the queries
 * the page is showing. Ticks every second while the menu is open.
 */
function useLastUpdate(active: boolean) {
  const qc = useQueryClient();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
  let last = 0;
  for (const q of qc.getQueryCache().getAll()) {
    if (q.getObserversCount() > 0 && q.state.dataUpdatedAt > last) last = q.state.dataUpdatedAt;
  }
  return last || undefined;
}

/** Top-right menu, as in Dragonite's admin: the session, the theme, help and logout. */
export function UserMenu() {
  const { username, logout } = useAuth();
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const fetching = useIsFetching() > 0;
  const lastUpdate = useLastUpdate(open);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Who is signed in: their initial as an avatar, plus a chevron for the menu. */}
      <Button
        variant="ghost"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Account: ${username}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn("h-9 gap-1.5 px-1.5", open && "bg-accent")}
      >
        <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground uppercase">
          {username?.trim().charAt(0) || "?"}
        </span>
        <ChevronDown className={cn("text-muted-foreground transition-transform", open && "rotate-180")} />
      </Button>
      {open ? (
        <div
          role="menu"
          className="animate-in absolute top-full right-0 z-50 mt-1.5 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <Label>{username}</Label>
          <div role="separator" className="-mx-1 my-1 h-px bg-border" />
          {/* Re-asks the server for everything on screen now, without waiting for each poll. */}
          <button
            type="button"
            role="menuitem"
            onClick={() => qc.refetchQueries({ type: "active" })}
            className={itemClass}
          >
            <RefreshCw className={cn(fetching && "animate-spin")} />
            <span className="flex-1">Refresh</span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
              {fetching ? "refreshing…" : lastUpdate ? fmt.ago(lastUpdate) : "—"}
            </span>
          </button>
          <div role="separator" className="-mx-1 my-1 h-px bg-border" />
          {/* Theme: one segmented control, icons only (the name is in its tooltip). */}
          <div role="radiogroup" aria-label="Theme" className="m-1 flex rounded-md border bg-background/40 p-0.5">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={theme === t.value}
                aria-label={t.label}
                title={t.label}
                onClick={() => setTheme(t.value)}
                className={cn(
                  "grid h-7 flex-1 cursor-pointer place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground [&>svg]:size-4",
                  theme === t.value && "bg-accent text-foreground shadow-sm",
                )}
              >
                <t.icon />
              </button>
            ))}
          </div>
          <div role="separator" className="-mx-1 my-1 h-px bg-border" />
          {/* How to connect each part of the stack, and the database account's permissions. */}
          <Link to="/help" role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
            <CircleHelp />
            Help
          </Link>
          <button type="button" role="menuitem" onClick={logout} className={itemClass}>
            <LogOut />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
