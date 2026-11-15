// Hooks de datos con TanStack Query. El polling se pausa solo cuando la pestaña está oculta
// (refetchIntervalInBackground: false es el comportamiento por defecto).
import { useMemo } from "react";
import { QueryClient, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, updateIncidentStatus } from "./api";
import { CONFIG } from "./config";
import { buildHourlyTrend, trendZones } from "./trend";
import { useNow } from "./hooks";
import type { Incident, Ticket, TicketCreateRequest, TicketQuery, TicketStatus, TrendPoint } from "../types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 0, // los reintentos los maneja el cliente HTTP
      staleTime: 4_000,
      refetchOnWindowFocus: true,
    },
  },
});

export const keys = {
  incidents: ["incidents"] as const,
  antennas: ["antennas"] as const,
  analytics: ["analytics"] as const,
  tickets: (q: TicketQuery) => ["tickets", q] as const,
};

const live = { refetchInterval: CONFIG.POLL_MS, refetchIntervalInBackground: false } as const;

export const useIncidents = () => useQuery({ queryKey: keys.incidents, queryFn: ({ signal }) => api.getIncidents(signal), ...live });
export const useAntennas = () => useQuery({ queryKey: keys.antennas, queryFn: ({ signal }) => api.getAntennas(signal), ...live });
export const useAnalytics = () => useQuery({ queryKey: keys.analytics, queryFn: ({ signal }) => api.getAnalytics(signal), ...live });

export function useTickets(query: TicketQuery | null, opts: { live?: boolean } = {}) {
  return useQuery({
    queryKey: keys.tickets(query ?? {}),
    queryFn: ({ signal }) => api.getTickets(query ?? {}, signal),
    enabled: Boolean(query && (query.ticket_id || query.user_id || query.geohash)),
    ...(opts.live ? live : {}),
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TicketCreateRequest) => api.createTicket(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.incidents });
      void qc.invalidateQueries({ queryKey: keys.analytics });
    },
  });
}

export function useUpdateIncidentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ incident, status, note }: { incident: Incident; status: TicketStatus; note: string }) => updateIncidentStatus(incident, status, note),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.incidents });
      void qc.invalidateQueries({ queryKey: keys.antennas });
      void qc.invalidateQueries({ queryKey: keys.analytics });
      void qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}

/** Tickets de las zonas con incidentes recientes (GET /tickets?geohash=), con la misma caché que el drawer. */
export function useZoneTickets(incidents: Incident[] | undefined): { tickets: Ticket[]; loading: boolean } {
  const zones = useMemo(() => trendZones(incidents ?? []), [incidents]);
  return useQueries({
    queries: zones.map((geohash) => ({
      queryKey: keys.tickets({ geohash }),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.getTickets({ geohash }, signal),
      ...live,
    })),
    combine: (results) => ({
      tickets: results.flatMap((r) => r.data ?? []),
      loading: results.some((r) => r.isLoading),
    }),
  });
}

/** Tendencia horaria (últimas 12 h) calculada en el cliente con incidentes + tickets. */
export function useHourlyTrend(): { trend: TrendPoint[]; loading: boolean } {
  const incidents = useIncidents();
  const zone = useZoneTickets(incidents.data);
  const now = useNow(60_000);
  const trend = useMemo(() => (incidents.data ? buildHourlyTrend(incidents.data, zone.tickets, now) : []), [incidents.data, zone.tickets, now]);
  return { trend, loading: incidents.isLoading || zone.loading };
}
