import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/format";

interface BadgeProps {
  tone?: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md";
  title?: string;
}

/** Badge con ícono + texto: el color nunca es la única señal. */
export function Badge({ tone = "text-fg-muted border-line/20 bg-surface-3/60", icon: Icon, children, className, size = "sm", title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border font-semibold",
        size === "sm" ? "h-5 gap-1 px-1.5 text-2xs uppercase tracking-wide" : "h-6 gap-1.5 px-2 text-xs",
        tone,
        className,
      )}
    >
      {Icon && <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden strokeWidth={2.25} />}
      <span className="badge-label">{children}</span>
    </span>
  );
}
