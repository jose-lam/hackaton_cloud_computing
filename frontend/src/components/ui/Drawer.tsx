import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/format";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Atrapa el foco dentro del contenedor, cierra con Esc y devuelve el foco al cerrar. */
export function useFocusTrap(open: boolean, ref: React.RefObject<HTMLElement>, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>("[data-autofocus]") ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const f = items[0];
      const l = items[items.length - 1];
      if (e.shiftKey && document.activeElement === f) {
        e.preventDefault();
        l?.focus();
      } else if (!e.shiftKey && document.activeElement === l) {
        e.preventDefault();
        f?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open, ref]);
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  width?: string;
}

/** Panel lateral modal (role=dialog, aria-modal) con trampa de foco. */
export function Drawer({ open, onClose, labelledBy, children, width = "max-w-[600px]" }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1200]">
      <div className="absolute inset-0 animate-fade-in bg-black/55 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn("absolute inset-y-0 right-0 flex w-full animate-slide-in-right flex-col border-l border-line/12 bg-surface-1 shadow-pop", width)}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function DrawerCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Cerrar panel"
      className="grid h-8 w-8 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg"
    >
      <X className="h-4 w-4" aria-hidden />
    </button>
  );
}
