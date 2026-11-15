import { IncidentQueue } from "./IncidentQueue";
import { NetworkMap } from "./NetworkMap";
import { useNoc } from "./noc-context";
import { Card, CardHeader } from "../../components/ui";
import { Map as MapIcon } from "lucide-react";
import { useAntennas, useIncidents } from "../../lib/queries";

export function IncidentsPage() {
  const incidents = useIncidents();
  const antennas = useAntennas();
  const { openIncident } = useNoc();
  return (
    <div className="mx-auto grid max-w-[1600px] gap-4 p-6 2xl:grid-cols-[1fr,420px]">
      <IncidentQueue
        incidents={incidents.data}
        loading={incidents.isLoading}
        error={incidents.error}
        onRetry={() => void incidents.refetch()}
        retrying={incidents.isFetching}
        className="min-h-[560px]"
        maxHeight="calc(100vh - 260px)"
      />
      <Card className="hidden flex-col 2xl:flex" aria-labelledby="inc-map">
        <CardHeader id="inc-map" icon={<MapIcon />} title="Ubicación" subtitle="Áreas de incidentes activos" />
        <div className="flex-1 p-3">
          <NetworkMap className="h-full min-h-[480px]" antennas={antennas.data} incidents={incidents.data} loading={antennas.isLoading} onOpenIncident={openIncident} />
        </div>
      </Card>
    </div>
  );
}
