import { cloneElement, useId, type ReactElement } from "react";
import { cn } from "../../lib/format";

interface TooltipProps {
  content: string;
  children: ReactElement<{ "aria-describedby"?: string }>;
  side?: "top" | "bottom" | "right";
  className?: string;
}

/** Tooltip accesible: aparece con hover y con foco de teclado; enlazado por aria-describedby. */
export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const id = useId();
  const pos =
    side === "top"
      ? "bottom-full left-1/2 mb-2 -translate-x-1/2"
      : side === "bottom"
        ? "top-full left-1/2 mt-2 -translate-x-1/2"
        : "left-full top-1/2 ml-2 -translate-y-1/2";
  return (
    <span className={cn("group/tt relative inline-flex", className)}>
      {cloneElement(children, { "aria-describedby": id })}
      <span
        role="tooltip"
        id={id}
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded border border-line/15 bg-surface-3 px-2 py-1 text-xs text-fg opacity-0 shadow-pop transition-opacity duration-150",
          "group-focus-within/tt:opacity-100 group-hover/tt:opacity-100",
          pos,
        )}
      >
        {content}
      </span>
    </span>
  );
}
