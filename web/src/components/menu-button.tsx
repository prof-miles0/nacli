import { type LucideIcon, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "./ui";

export interface MenuItem {
  key: string;
  label: string;
  /** One line under the label saying what the option does. */
  hint?: string;
  icon: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * A "…" button with a menu, styled like the device actions menu: headed by
 * what it acts on, in a portal so a table's overflow cannot clip it, and
 * opening upwards when there is no room below.
 */
export function MenuButton({ kind, subject, items }: { kind: string; subject: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>();
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  const toggle = () => {
    if (open) return setOpen(false);
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const height = items.length * 46 + 44;
    const below = r.bottom + 4 + height <= window.innerHeight - 8;
    setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - height), right: window.innerWidth - r.right });
    setOpen(true);
  };

  return (
    <div ref={ref} className="relative inline-block">
      <Button variant="ghost" size="icon" className="size-8" aria-label={`Options for ${subject}`} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        <MoreHorizontal />
      </Button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ top: pos.top, right: pos.right }}
              className="animate-in fixed z-50 w-64 rounded-lg border bg-popover p-1 text-left shadow-xl"
            >
              <div className="truncate border-b px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground">
                <span className="font-medium tracking-wide uppercase">{kind}</span> · {subject}
              </div>
              {items.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  role="menuitem"
                  disabled={a.disabled}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
                    a.danger && "text-red-400",
                  )}
                  onClick={() => {
                    setOpen(false);
                    a.onSelect();
                  }}
                >
                  <a.icon className={a.danger ? "text-red-400" : "text-muted-foreground"} />
                  <span className="min-w-0">
                    <span className="block">{a.label}</span>
                    {a.hint ? <span className="block text-[11px] text-muted-foreground">{a.hint}</span> : null}
                  </span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
