import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** true si el usuario pidió reducir el movimiento. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** Estado de conexión del navegador. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** Visibilidad de la pestaña (para mostrar "pausado"). */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    (cb) => {
      document.addEventListener("visibilitychange", cb);
      return () => document.removeEventListener("visibilitychange", cb);
    },
    () => document.visibilityState === "visible",
    () => true,
  );
}

/** Reloj que se actualiza cada `ms` para recalcular antigüedades relativas. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** Animación de conteo entre el valor anterior y el nuevo. */
export function useCountUp(target: number | null, duration = 700): number | null {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState<number | null>(target);
  const fromRef = useRef<number>(0);
  const valueRef = useRef<number | null>(target);

  useEffect(() => {
    if (target === null) {
      valueRef.current = null;
      setValue(null);
      return;
    }
    if (reduced) {
      valueRef.current = target;
      setValue(target);
      return;
    }
    fromRef.current = valueRef.current ?? 0;
    const from = fromRef.current;
    let start: number | null = null;
    let raf = 0;
    const step = (t: number) => {
      start ??= t;
      const p = Math.min(1, Math.max(0, (t - start) / duration));
      const eased = 1 - (1 - p) ** 3;
      const v = from + (target - from) * eased;
      valueRef.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // Respaldo: si el navegador no entrega frames (pestaña en segundo plano), fija el valor final
    const done = window.setTimeout(() => {
      cancelAnimationFrame(raf);
      valueRef.current = target;
      setValue(target);
    }, duration + 150);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(done);
    };
  }, [target, duration, reduced]);

  return value;
}

/** localStorage tolerante a fallos (modo privado, almacenamiento bloqueado). */
export function useLocalStorage<T>(key: string, initial: T | (() => T)): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      /* sin almacenamiento */
    }
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  const set = (v: T) => {
    setValue(v);
    try {
      window.localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* sin almacenamiento */
    }
  };
  return [value, set];
}

const APP_NAME = "Red TeleCorp Sentinel AI";

/** Título dinámico de la pestaña: "Página · Red TeleCorp Sentinel AI". */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);
}

/** Aplica el tema claro al documento mientras el componente esté montado. */
export function useLightTheme(): void {
  useEffect(() => {
    const root = document.documentElement;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prev = meta?.content;
    root.classList.add("theme-light");
    root.classList.remove("dark");
    if (meta) meta.content = "#ffffff";
    return () => {
      root.classList.remove("theme-light");
      root.classList.add("dark");
      if (meta && prev) meta.content = prev;
    };
  }, []);
}
