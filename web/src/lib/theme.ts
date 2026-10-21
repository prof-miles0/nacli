import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const KEY = "nacli.theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function read(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark" || t === "system") return t;
  } catch {
    // Storage blocked: follow the system.
  }
  return "system";
}

function apply(t: Theme) {
  const dark = t === "dark" || (t === "system" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Light / dark / follow the system, remembered per browser (index.html applies it before load). */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    apply(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Not remembered; the choice still applies now.
    }
    if (theme !== "system") return;
    // Follow the system live while "System" is chosen.
    const m = media();
    const onChange = () => apply("system");
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [theme]);
  return [theme, setTheme] as const;
}
