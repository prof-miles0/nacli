import { useQuery } from "@tanstack/react-query";
import type { InstanceInfo } from "@shared/types";
import { endpoints } from "./api";
import { SERIES } from "./utils";

export function useAppInfo() {
  return useQuery({
    queryKey: ["app"],
    queryFn: endpoints.app,
    refetchInterval: 5000,
  });
}

/** Configured instances; every page shows all of them. */
export function useInstances(): { all: InstanceInfo[]; visible: InstanceInfo[]; isLoading: boolean } {
  const { data, isLoading } = useAppInfo();
  const all = data?.instances ?? [];
  return { all, visible: all, isLoading };
}

/** Stable color per instance, by its position in config.toml (never by rank). */
export function useInstanceColor() {
  const { data } = useAppInfo();
  return (id: string) => {
    const idx = data?.instances.findIndex((i) => i.id === id) ?? 0;
    return SERIES[Math.max(0, idx) % SERIES.length];
  };
}

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: () => endpoints.status("all"),
    refetchInterval: 5000,
  });
}
