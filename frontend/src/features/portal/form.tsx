import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "../../lib/format";

/** Clases de campo del portal (táctil: 44 px de alto). */
export const inputCls = (err?: boolean, className?: string) =>
  cn(
    "h-11 w-full rounded-lg border bg-surface-1 px-3.5 text-md text-fg placeholder:text-fg-subtle/80 transition-colors duration-150",
    "focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15",
    err ? "border-danger/70 focus:border-danger focus:ring-danger/15" : "border-line/20 hover:border-line/35",
    className,
  );

interface FieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ id, label, error, hint, optional, children, className }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 flex items-baseline gap-2 text-base font-medium text-fg">
        {label}
        {optional && <span className="text-xs font-normal text-fg-subtle">(opcional)</span>}
      </label>
      {children}
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  );
}

export function FieldMessage({ id, error, hint }: { id: string; error?: string; hint?: ReactNode }) {
  if (error)
    return (
      <p id={`${id}-err`} className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-danger">
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {error}
      </p>
    );
  if (hint)
    return (
      <p id={`${id}-hint`} className="mt-1.5 text-sm text-fg-subtle">
        {hint}
      </p>
    );
  return null;
}

/** Atributos ARIA de un control según su estado de validación. */
export const describe = (id: string, error?: string, hint?: boolean) => ({
  id,
  "aria-invalid": error ? true : undefined,
  "aria-describedby": error ? `${id}-err` : hint ? `${id}-hint` : undefined,
});
