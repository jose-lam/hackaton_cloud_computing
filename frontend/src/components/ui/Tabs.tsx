import { useRef, type ReactNode } from "react";
import { cn } from "../../lib/format";

export interface TabItem {
  id: string;
  label: ReactNode;
  badge?: ReactNode;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** id base compartido con los TabPanel (usar useId en el padre) */
  idBase: string;
  className?: string;
}

/** Pestañas accesibles (role=tablist) con navegación por flechas, Inicio y Fin. */
export function Tabs({ items, value, onChange, label, idBase: base, className }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, idx: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const item = items[next];
    if (item) onChange(item.id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={cn("flex gap-1 border-b border-line/10", className)}>
      {items.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${base}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "relative -mb-px inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors duration-150",
              selected ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idBase, id, children, className }: { idBase: string; id: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-tab-${id}`} tabIndex={0} className={cn("animate-fade-in focus-visible:outline-none", className)}>
      {children}
    </div>
  );
}
