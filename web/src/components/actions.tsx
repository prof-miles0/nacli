import { useQueryClient } from "@tanstack/react-query";
import {
  type LucideIcon,
  MoreHorizontal,
  Power,
  RefreshCw,
  RotateCcw,
  ScrollText,
  ToggleLeft,
  ToggleRight,
  Unplug,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { endpoints } from "@/lib/api";
import { cn } from "@/lib/utils";
import { LogcatModal } from "./logcat";
import { toast, type ToastInput } from "./toaster";
import { Button, Modal } from "./ui";

export interface ActionDef {
  action: string;
  label: string;
  /** Destructive actions are confirmed and shown in red. */
  danger?: boolean;
  confirm?: string;
  download?: boolean;
  /** Opens the in-page log viewer instead of calling the action. */
  logView?: boolean;
  icon: LucideIcon;
  /** One line under the label saying what the option acts on. */
  hint: string;
}

export const DEVICE_ACTIONS: ActionDef[] = [
  { action: "restart", label: "Restart app", icon: RotateCcw, hint: "Restarts the app on the device", confirm: "The app on the device will be restarted." },
  { action: "reboot", label: "Reboot device", icon: Power, hint: "Reboots the whole device", danger: true, confirm: "The whole device will be rebooted." },
  { action: "disable", label: "Disable", icon: ToggleLeft, hint: "Rotom stops giving it work", confirm: "The device will stop receiving work." },
  { action: "enable", label: "Enable", icon: ToggleRight, hint: "Rotom gives it work again" },
  { action: "disconnect", label: "Disconnect", icon: Unplug, hint: "Closes its connection and its workers'", danger: true, confirm: "The device and all its workers will be disconnected." },
  { action: "logcat", label: "View logcat", icon: ScrollText, hint: "Shows the device log", logView: true },
];

export const CONTROLLER_ACTIONS: ActionDef[] = [
  { action: "reconnect", label: "Request reconnect", icon: RefreshCw, hint: "Dragonite restarts its session", confirm: "The controller will be asked to restart its session." },
  { action: "disconnect", label: "Disconnect", icon: Unplug, hint: "Closes the Dragonite connection", danger: true, confirm: "The controller's connection will be closed." },
];

/**
 * Kept for the pages that already use it: notify() now raises a toast in the
 * shared stack (see toaster.tsx), so `node` is nothing to render any more.
 */
export function useNotify() {
  return { notify: toast, node: null };
}

async function download(instanceId: string, path: string) {
  const res = await fetch(`/api/rotom/${encodeURIComponent(instanceId)}${path}`, {
    method: "PUT",
    headers: { "X-Nacli": "1" },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  const name = /filename="?([^";]+)/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "logcat.zip";
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

/** "…" menu that runs RotomNG actions through the dashboard's proxy. */
export function ActionsMenu({
  instanceId,
  basePath,
  actions,
  subject,
  kind,
  notify,
}: {
  instanceId: string;
  basePath: string;
  actions: ActionDef[];
  subject: string;
  /** What the menu acts on, shown at its top, e.g. "Device" or "Controller". */
  kind: string;
  notify: (m: ToastInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<ActionDef>();
  const [busy, setBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    // The menu is fixed-positioned, so it would drift away from its button on scroll.
    const dismiss = () => setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  // Place the menu next to its button, in a portal so the table's overflow
  // cannot clip it; open upwards when there is no room below.
  const toggleMenu = () => {
    if (open) return setOpen(false);
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const height = actions.length * 46 + 44;
    const below = r.bottom + 4 + height <= window.innerHeight - 8;
    setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - height), right: window.innerWidth - r.right });
    setOpen(true);
  };

  const run = async (a: ActionDef) => {
    setBusy(true);
    const path = `${basePath}/action/${a.action}`;
    try {
      if (a.download) {
        await download(instanceId, path);
        notify({ text: `${a.label}: download started` });
      } else {
        const r = await endpoints.rotom<{ message?: string }>(instanceId, path, { method: "PUT" });
        notify({ text: `${subject}: ${r.message ?? "done"}` });
      }
      setTimeout(() => qc.invalidateQueries({ queryKey: ["status"] }), 1200);
    } catch (e) {
      notify({ text: `${a.label}: ${(e as Error).message}`, error: true });
    } finally {
      setBusy(false);
      setPending(undefined);
    }
  };

  return (
    <div ref={ref} className="relative inline-block">
      <Button variant="ghost" size="icon" className="size-8" aria-label="Actions" onClick={toggleMenu}>
        <MoreHorizontal />
      </Button>
      {open && pos ? createPortal(
        <div
          ref={menuRef}
          style={{ top: pos.top, right: pos.right }}
          className="animate-in fixed z-50 w-64 rounded-lg border bg-popover p-1 text-left shadow-xl"
        >
          <div className="truncate border-b px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium tracking-wide uppercase">{kind}</span> · {subject}
          </div>
          {actions.map((a) => (
            <button
              key={a.action}
              type="button"
              className={cn(
                "flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
                a.danger && "text-red-400",
              )}
              onClick={() => {
                setOpen(false);
                if (a.logView) setLogOpen(true);
                else if (a.confirm) setPending(a);
                else void run(a);
              }}
            >
              <a.icon className={a.danger ? "text-red-400" : "text-muted-foreground"} />
              <span className="min-w-0">
                <span className="block">{a.label}</span>
                <span className="block text-[11px] text-muted-foreground">{a.hint}</span>
              </span>
            </button>
          ))}
        </div>,
        document.body,
      ) : null}
      {logOpen ? (
        <LogcatModal
          instanceId={instanceId}
          deviceId={decodeURIComponent(basePath.split("/").pop() ?? "")}
          subject={subject}
          onClose={() => setLogOpen(false)}
          onDownload={() =>
            download(instanceId, `${basePath}/action/logcat`).catch((e) =>
              notify({ text: `Logcat: ${(e as Error).message}`, error: true }),
            )
          }
        />
      ) : null}
      <Modal
        open={!!pending}
        onClose={() => setPending(undefined)}
        title={`${pending?.label} · ${subject}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setPending(undefined)}>
              Cancel
            </Button>
            <Button variant={pending?.danger ? "destructive" : "default"} loading={busy} onClick={() => pending && run(pending)}>
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-muted-foreground">{pending?.confirm}</p>
      </Modal>
    </div>
  );
}
