import { createContext, useContext } from "react";

export interface NocContextValue {
  /** Incidentes recién llegados (para el destello de la fila) */
  flashIds: ReadonlySet<string>;
  openIncident: (id: string) => void;
  openPalette: () => void;
}

export const NocContext = createContext<NocContextValue>({
  flashIds: new Set(),
  openIncident: () => undefined,
  openPalette: () => undefined,
});

export const useNoc = () => useContext(NocContext);
