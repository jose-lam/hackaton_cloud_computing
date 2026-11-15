import { createContext, useContext } from "react";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  duration?: number;
}

export interface ToastApi {
  toast: (t: ToastInput) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}
