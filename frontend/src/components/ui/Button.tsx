import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent/90 active:bg-accent-strong font-semibold shadow-[0_0_0_1px_rgb(var(--accent)/0.5)]",
  secondary: "bg-surface-3 text-fg border border-line/15 hover:bg-surface-3/70 hover:border-line/25",
  ghost: "text-fg-muted hover:text-fg hover:bg-surface-3/60",
  danger: "bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25",
  success: "bg-ok text-[#032312] hover:bg-ok/90 font-semibold",
};
const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-9 px-4 text-base gap-2",
  lg: "h-11 px-5 text-md gap-2 rounded-lg",
  icon: "h-8 w-8 justify-center",
};

const BASE = "inline-flex select-none items-center rounded-md transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50";

/** Clases de botón para usar en enlaces (<Link>) con el mismo aspecto. */
export function buttonClasses(variant: Variant = "secondary", size: Size = "md", className?: string): string {
  return cn(BASE, "justify-center", VARIANTS[variant], SIZES[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        BASE,
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});
