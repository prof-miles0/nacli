import type { ScoutJob } from "@shared/types";

/** Done, waiting or failed: the colour of each point and of the legend. */
export const SCOUT_STATE = {
  done: { label: "Fulfilled", color: "#3b82f6" },
  pending: { label: "Pending", color: "#f59e0b" },
  failed: { label: "Failed", color: "#ef4444" },
} as const;
export type ScoutState = keyof typeof SCOUT_STATE;
export const scoutState = (j: ScoutJob): ScoutState => (j.fulfilled === -1 ? "failed" : j.fulfilled > 0 ? "done" : "pending");

