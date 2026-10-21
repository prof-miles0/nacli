import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Text kept on one line. When it doesn't fit it slides slowly to its end and
 * back (hovering pauses it); with reduced motion it scrolls by hand instead.
 */
export function OneLine({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => setShift(Math.max(0, Math.ceil(i.scrollWidth - o.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, [children]);
  return (
    <span ref={outer} className={cn("one-line block min-w-0 overflow-hidden whitespace-nowrap", className)} title={title ?? (typeof children === "string" ? children : undefined)}>
      <span
        ref={inner}
        className={cn("inline-block", shift > 0 && "one-line-slide")}
        // About 25 px a second, plus the pauses at each end.
        style={shift > 0 ? ({ "--shift": `-${shift}px`, animationDuration: `${(4 + shift / 25).toFixed(1)}s` } as React.CSSProperties) : undefined}
      >
        {children}
      </span>
    </span>
  );
}
