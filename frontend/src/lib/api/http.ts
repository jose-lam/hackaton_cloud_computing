import { CONFIG } from "../config";

export class ApiError extends Error {
  readonly status: number;
  readonly retriable: boolean;
  /** Mensaje que envió el servidor en { error } (si lo hubo). */
  readonly detail: string | undefined;
  constructor(message: string, status = 0, retriable = status === 0 || status >= 500 || status === 429, detail?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retriable = retriable;
    this.detail = detail;
  }
}

const STATUS_MESSAGES: Record<number, string> = {
  400: "Los datos enviados no son válidos.",
  401: "No autorizado.",
  403: "Acceso denegado o recurso no disponible.",
  404: "No se encontró el recurso solicitado.",
  409: "El recurso cambió mientras lo editabas. Vuelve a intentarlo.",
  429: "Demasiadas solicitudes. Espera unos segundos.",
  500: "Error interno del servidor.",
  502: "El servidor no respondió correctamente.",
  503: "Servicio no disponible temporalmente.",
  504: "El servidor tardó demasiado en responder.",
};

export const isAbortError = (e: unknown): boolean => e instanceof DOMException && e.name === "AbortError";

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Cancelado", "AbortError"));
    });
  });

/**
 * Reintentos controlados con backoff exponencial y jitter.
 * Solo reintenta errores transitorios (red, timeout, 5xx, 429).
 */
export async function withRetry<T>(fn: () => Promise<T>, { retries = 2, baseMs = 400, signal }: { retries?: number; baseMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw err;
      const retriable = err instanceof ApiError ? err.retriable : false;
      if (!retriable || attempt >= retries) throw err;
      await sleep(baseMs * 2 ** attempt + Math.random() * 150, signal);
      attempt += 1;
    }
  }
}

export interface RequestOptions {
  query?: Record<string, string | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

/** Firma común del cliente HTTP real y del mock (mismas rutas, mismos cuerpos del contrato). */
export type Requester = <T>(method: string, path: string, options?: RequestOptions) => Promise<T>;

/** fetch con timeout de 8 s, cancelación externa y errores en español. */
export async function request<T>(method: string, path: string, { query, body, signal }: RequestOptions = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v && v.trim()) qs.set(k, v.trim());
  const url = `${CONFIG.API_BASE_URL}${path}${qs.size ? `?${qs.toString()}` : ""}`;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CONFIG.REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (timedOut) throw new ApiError("La solicitud superó el tiempo límite (8 s).", 0);
    if (isAbortError(err)) throw err;
    throw new ApiError("No se pudo conectar con el servidor.", 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }

  const text = await res.text().catch(() => "");
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const serverMsg = [obj.message, obj.error, obj.detail].find((m): m is string => typeof m === "string" && m.length < 200);
    throw new ApiError(serverMsg ?? STATUS_MESSAGES[res.status] ?? `Error ${res.status}`, res.status, undefined, serverMsg);
  }
  return data as T;
}
