/** Where a menu opened from a button goes, as fixed-position styles. */
export interface MenuPlace {
  left: number;
  width: number;
  /** One of the two: below the button (top) or above it (bottom). */
  top?: number;
  bottom?: number;
  maxHeight: number;
}

const MARGIN = 8;
const GAP = 4;

/**
 * Places a menu of about `width` × `height` next to the button at `r`, always
 * inside the screen: never wider than it, slid sideways to fit, and opened
 * upwards when there is more room above. `align` is the side it lines up with.
 */
export function placeMenu(r: DOMRect, width: number, height: number, align: "left" | "right" = "left"): MenuPlace {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(width, vw - 2 * MARGIN);
  const x = align === "right" ? r.right - w : r.left;
  const left = Math.max(MARGIN, Math.min(x, vw - w - MARGIN));
  const below = vh - r.bottom - GAP - MARGIN;
  const above = r.top - GAP - MARGIN;
  const down = below >= Math.min(height, 240) || below >= above;
  const maxHeight = Math.max(120, down ? below : above);
  return down ? { left, width: w, top: r.bottom + GAP, maxHeight } : { left, width: w, bottom: vh - r.top + GAP, maxHeight };
}
