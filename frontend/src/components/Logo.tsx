import { cn } from "../lib/format";

/** Logo original: torre de antena con ondas de radar y barrido. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn("h-8 w-8", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="rgb(var(--surface-3))" />
      <rect x=".5" y=".5" width="31" height="31" rx="7.5" stroke="rgb(var(--accent))" strokeOpacity=".35" />
      {/* ondas */}
      <path d="M9.2 11.4a9 9 0 0 1 13.6 0" stroke="rgb(var(--accent))" strokeOpacity=".45" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M11.8 13.8a5.2 5.2 0 0 1 8.4 0" stroke="rgb(var(--accent))" strokeOpacity=".8" strokeWidth="1.6" strokeLinecap="round" />
      {/* torre */}
      <path d="M16 16.2 L12.4 25.5 M16 16.2 L19.6 25.5 M13.5 22.6 H18.5" stroke="rgb(var(--fg))" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="1.9" fill="rgb(var(--accent))" />
    </svg>
  );
}

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      {!collapsed && (
        <span className="leading-tight">
          <span className="block text-sm font-semibold tracking-tight text-fg">
            Sentinel <span className="text-accent">AI</span>
          </span>
          <span className="block text-2xs uppercase tracking-[0.14em] text-fg-subtle">Red TeleCorp</span>
        </span>
      )}
    </span>
  );
}
