import { RefreshCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/format";
import { Button } from "./Button";

/** Ilustración sencilla: radar en reposo. */
function RadarIllustration() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden className="text-fg-subtle">
      <circle cx="36" cy="36" r="30" stroke="currentColor" strokeOpacity=".25" strokeDasharray="3 4" />
      <circle cx="36" cy="36" r="19" stroke="currentColor" strokeOpacity=".35" />
      <circle cx="36" cy="36" r="8" stroke="rgb(var(--accent))" strokeOpacity=".7" />
      <path d="M36 36 L56 20" stroke="rgb(var(--accent))" strokeWidth="2" strokeLinecap="round" />
      <circle cx="36" cy="36" r="2.5" fill="rgb(var(--accent))" />
      <circle cx="50" cy="48" r="2" fill="currentColor" fillOpacity=".5" />
      <circle cx="22" cy="24" r="1.5" fill="currentColor" fillOpacity=".4" />
    </svg>
  );
}

interface StateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({ title, description, action, className, compact }: StateProps) {
  return (
    <div role="status" className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 py-6" : "gap-3 py-12", className)}>
      {!compact && <RadarIllustration />}
      <p className="text-base font-medium text-fg">{title}</p>
      {description && <p className="max-w-sm text-sm text-fg-muted">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = "No se pudieron cargar los datos", description, onRetry, retrying, className, compact }: Omit<StateProps, "title" | "action"> & { title?: string; onRetry?: () => void; retrying?: boolean }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 py-6" : "gap-3 py-12", className)}>
      <span className="grid h-10 w-10 place-items-center rounded-full border border-danger/30 bg-danger/10 text-danger">
        <TriangleAlert className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-base font-medium text-fg">{title}</p>
      {description && <p className="max-w-sm text-sm text-fg-muted">{description}</p>}
      {onRetry && (
        <Button size="sm" onClick={onRetry} loading={retrying} icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}>
          Reintentar
        </Button>
      )}
    </div>
  );
}
