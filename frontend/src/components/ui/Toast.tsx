import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleCheck, Info, OctagonAlert, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/format";
import { ToastContext, type ToastInput, type ToastTone } from "./toast-context";

interface ToastItem extends ToastInput {
  id: number;
}

const TONES: Record<ToastTone, { icon: LucideIcon; cls: string }> = {
  success: { icon: CircleCheck, cls: "text-ok" },
  error: { icon: OctagonAlert, cls: "text-danger" },
  warning: { icon: TriangleAlert, cls: "text-warn" },
  info: { icon: Info, cls: "text-accent" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = ++seq.current;
      setItems((list) => [...list.slice(-3), { ...input, id }]);
      timers.current.set(id, window.setTimeout(() => dismiss(id), input.duration ?? (input.action ? 8000 : 5000)));
    },
    [dismiss],
  );

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" aria-relevant="additions" className="pointer-events-none fixed bottom-4 right-4 z-[1500] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((t) => {
          const tone = TONES[t.tone ?? "info"];
          const Icon = tone.icon;
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex animate-slide-up gap-3 rounded-lg border border-line/15 bg-surface-2 p-3 shadow-pop"
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone.cls)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">{t.title}</p>
                {t.description && <p className="mt-0.5 break-words text-sm text-fg-muted">{t.description}</p>}
                {t.action && (
                  <button
                    type="button"
                    onClick={() => {
                      t.action?.onClick();
                      dismiss(t.id);
                    }}
                    className="mt-2 text-sm font-semibold text-accent hover:underline"
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Cerrar notificación" className="grid h-6 w-6 shrink-0 place-items-center rounded text-fg-subtle hover:bg-surface-3 hover:text-fg">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
