import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AuthGate } from "@/components/auth";
import { Layout } from "@/components/layout";
import type { AppInfo } from "@shared/types";
import { ApiError } from "@/lib/api";
import { useAppInfo } from "@/lib/state";
import { DashboardPage } from "@/pages/dashboard";
import { DevicesPage } from "@/pages/devices";
import { DragoniteAccountsPage } from "@/pages/dragonite-accounts";
import { DragoniteAreasPage } from "@/pages/dragonite-areas";
import { DragoniteModesPage } from "@/pages/dragonite-modes";
import { DragoniteProxiesPage } from "@/pages/dragonite-proxies";
import { DragoniteSchedulerPage } from "@/pages/dragonite-scheduler";
import { DragoniteMetricsPage } from "@/pages/dragonite-metrics";
import { GolbatMetricsPage } from "@/pages/golbat-metrics";
import { GolbatStatsPage } from "@/pages/golbat-stats";
import { InstancesPage } from "@/pages/instances";
import { JobsPage } from "@/pages/jobs";
import { StatusPage } from "@/pages/status";
import { MetricsPage } from "@/pages/metrics";
import { WorkersPage } from "@/pages/workers";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
});

/** A page for a part config.toml may leave out: back to the Dashboard when it is not there. */
function Only({ when, children }: { when: (app: AppInfo) => boolean; children: ReactNode }) {
  const { data: app } = useAppInfo();
  if (!app) return null;
  return when(app) ? children : <Navigate to="/" replace />;
}
const rotom = (a: AppInfo) => a.instances.length > 0;
const golbat = (a: AppInfo) => a.golbat;
const golbatStats = (a: AppInfo) => a.golbatStats;
const dragonite = (a: AppInfo) => a.dragonite.length > 0;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate>
          <BrowserRouter>
            <Layout>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/status" element={<StatusPage />} />
                <Route path="/instances" element={<Only when={rotom}><InstancesPage /></Only>} />
                <Route path="/metrics" element={<Only when={rotom}><MetricsPage /></Only>} />
                <Route path="/devices" element={<Only when={rotom}><DevicesPage /></Only>} />
                <Route path="/workers" element={<Only when={rotom}><WorkersPage /></Only>} />
                <Route path="/jobs" element={<Only when={rotom}><JobsPage /></Only>} />
                <Route path="/dragonite/metrics" element={<Only when={dragonite}><DragoniteMetricsPage /></Only>} />
                <Route path="/dragonite/areas" element={<Only when={dragonite}><DragoniteAreasPage /></Only>} />
                <Route path="/dragonite/modes" element={<Only when={dragonite}><DragoniteModesPage /></Only>} />
                <Route path="/dragonite/proxies" element={<Only when={dragonite}><DragoniteProxiesPage /></Only>} />
                <Route path="/dragonite/scheduler" element={<Only when={dragonite}><DragoniteSchedulerPage /></Only>} />
                <Route path="/dragonite/accounts" element={<Only when={dragonite}><DragoniteAccountsPage /></Only>} />
                <Route path="/golbat/stats" element={<Only when={golbatStats}><GolbatStatsPage /></Only>} />
                <Route path="/golbat/metrics" element={<Only when={golbat}><GolbatMetricsPage /></Only>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </BrowserRouter>
      </AuthGate>
    </QueryClientProvider>
  </StrictMode>,
);
