import { useSyncExternalStore } from "react";

// The stack picked last, shared by every page with stack tabs (Areas, Modes,
// Proxies, Scheduler, Metrics), so moving between them keeps it. "" is "All",
// which only some pages offer; the others fall back to their first stack
// without forgetting the choice.
const KEY = "nacli.stack";
const listeners = new Set<() => void>();

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

let current = read();

function subscribe(fn: () => void) {
  listeners.add(fn);
  // Another tab picking a stack changes it here too.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    current = read();
    fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function chooseStack(id: string) {
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Not remembered across visits; the choice still applies now.
  }
  for (const fn of listeners) fn();
}

/** The stack picked last ("" for "All" or none yet), and the setter every page shares. */
export function useChosenStack(): [string, (id: string) => void] {
  return [useSyncExternalStore(subscribe, () => current), chooseStack];
}
