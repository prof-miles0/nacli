import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export { fmt } from "@shared/format";

export const SERIES = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `var(--series-${i})`);
