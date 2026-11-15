import { HashRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "./components/ui";
import { EmptyState } from "./components/ui";
import { queryClient } from "./lib/queries";
import { NocLayout } from "./features/noc/NocLayout";
import { OverviewPage } from "./features/noc/OverviewPage";
import { IncidentsPage } from "./features/noc/IncidentsPage";
import { AntennasPage } from "./features/noc/AntennasPage";
import { AnalyticsPage } from "./features/noc/AnalyticsPage";
import { PortalLayout } from "./features/portal/PortalLayout";
import { HomePage } from "./features/portal/HomePage";
import { TrackingPage } from "./features/portal/TrackingPage";

// HashRouter: S3/CloudFront sirve index.html sin reglas de rewrite.
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/" element={<PortalLayout />}>
              <Route index element={<HomePage />} />
              <Route path="seguimiento" element={<TrackingPage />} />
            </Route>
            <Route path="/portal" element={<Navigate to="/" replace />} />
            <Route path="/noc" element={<NocLayout />}>
              <Route index element={<OverviewPage />} />
              <Route path="incidentes" element={<IncidentsPage />} />
              <Route path="antenas" element={<AntennasPage />} />
              <Route path="analitica" element={<AnalyticsPage />} />
            </Route>
            <Route
              path="*"
              element={
                <EmptyState
                  className="h-full"
                  title="Página no encontrada"
                  description="La dirección no existe."
                  action={
                    <Link to="/" className="text-sm font-semibold text-accent hover:underline">
                      Ir al inicio
                    </Link>
                  }
                />
              }
            />
          </Routes>
        </HashRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
