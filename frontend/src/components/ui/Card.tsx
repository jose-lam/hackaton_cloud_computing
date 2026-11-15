import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/format";

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("rounded-lg border border-line/10 bg-surface-1 shadow-card", className)} {...rest}>
      {children}
    </section>
  );
}

interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  id?: string;
  className?: string;
}

export function CardHeader({ title, subtitle, icon, actions, id, className }: CardHeaderProps) {
  return (
    <header className={cn("flex min-h-12 items-center gap-3 border-b border-line/8 px-4 py-2.5", className)}>
      {icon && <span className="text-fg-subtle [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      <div className="min-w-0 flex-1">
        <h2 id={id} className="truncate text-sm font-semibold tracking-tight text-fg">
          {title}
        </h2>
        {subtitle && <p className="truncate text-xs text-fg-subtle">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
