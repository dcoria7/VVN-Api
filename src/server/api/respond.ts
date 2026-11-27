import "server-only";
import { createHash } from "crypto";
import { reportError } from "@/lib/report-error";
import { deploymentEnvironment } from "@/lib/deployment-environment";

// ─────────────────────────────────────────────────────────────────────────────
// Envoltura, caché y errores de la API pública versionada (/api/v1/*).
//
// Reglas que esta capa impone por construcción, para que ninguna ruta las olvide:
//
//  1. CACHÉ DE CDN EN TODA LECTURA. En octubre 2026 Vercel pausó el proyecto por
//     renderizar de más (ver bitácora 2026-10-13). Un hit de CDN no invoca la
//     función, así que el `Cache-Control` no es una optimización posterior: es el
//     diseño. Las lecturas nacen con `s-maxage` y `stale-while-revalidate`.
//  2. NADA PERSONALIZADO EN EL CDN. `CACHE_PRIVATE` es obligatorio en cualquier
//     respuesta que dependa del visitante (hoy solo GET /api/v1/ratings): servir
//     desde CDN algo que depende de `X-Visitor-Id` sería enseñarle a todos el
//     voto de uno.
//  3. ETag + 304. Un pull-to-refresh con red mala es la diferencia entre bajar el
//     payload completo y no bajar nada.
//  4. NUNCA se filtra el mensaje crudo de Postgres: va a Sentry y el cliente
//     recibe un código genérico.
// ─────────────────────────────────────────────────────────────────────────────

export const API_VERSION = "1";

/** Lecturas normales: 5 min en CDN, 10 min más sirviendo stale mientras revalida. */
export const CACHE_READ = "public, s-maxage=300, stale-while-revalidate=600";
/** Lecturas que deben sentirse frescas (config, blog): 1 min. */
export const CACHE_READ_SHORT = "public, s-maxage=60, stale-while-revalidate=300";
/** Respuestas que dependen del visitante. NUNCA tocan el CDN. */
export const CACHE_PRIVATE = "private, no-store";
/**
 * 404 de una LECTURA: 10 s en el CDN y 10 s de stale-while-revalidate.
 *
 * Los errores no se cachean por defecto (un 400 es culpa del cliente y un 500 es
 * transitorio), pero un 404 de lectura es una respuesta estable y es justo la que
 * un escáner repite con ids inventados. Sin caché, cada id nuevo es una invocación
 * y —en `/venues/resolve`— un escaneo de la tabla.
 *
 * Esta política solo aplica a ausencia real: los fallos de Supabase se propagan
 * como 500 con private,no-store. La ventana corta permite que contenido recién
 * creado o activado aparezca pronto, conservando protección frente a escaneos.
 */
export const CACHE_READ_404 = "public, s-maxage=10, stale-while-revalidate=10";

export type ApiErrorCode =
  | "unauthorized" | "pro_required" | "already_linked" | "device_linked" | "invitation_unavailable" | "conflict" | "photo_limit"
  | "invalid"
  | "invalid_body"
  | "invalid_event"
  | "invalid_stars"
  | "not_found"
  | "not_rateable"
  | "rate_limited"
  | "daily_limit"
  | "unavailable"
  | "server_error";

function baseHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "X-Api-Version": API_VERSION,
    "X-Vvn-Environment": deploymentEnvironment,
  };
}

function etagOf(body: string): string {
  return `"${createHash("sha1").update(body).digest("base64url")}"`;
}

/**
 * ¿`If-None-Match` coincide con este ETag?
 *
 * No basta con comparar por igualdad: la cabecera puede traer una LISTA separada
 * por comas, cada entrada puede venir con el prefijo de validador débil (`W/`) —
 * que un proxy puede agregar por su cuenta— y `*` significa "cualquiera". Con la
 * comparación estricta, un cliente que mande dos ETags o un proxy que debilite el
 * suyo perdía el 304 y volvía a bajar el payload completo, que es la mitad de la
 * razón de existir del ETag.
 */
function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  const trimmed = header.trim();
  if (trimmed === "*") return true;
  return trimmed
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .includes(etag);
}

/**
 * Respuesta de éxito `{ ok: true, data }`.
 *
 * Con `cacheControl` público emite ETag y responde 304 si el cliente ya tiene esa
 * versión. El 304 repite las cabeceras de caché (si no, el cliente pierde la
 * política de frescura al revalidar).
 */
export function apiOk<T>(
  req: Request,
  data: T,
  cacheControl: string = CACHE_READ,
  extraHeaders: Record<string, string> = {},
): Response {
  const body = JSON.stringify({ ok: true, data });
  const headers: Record<string, string> = {
    ...baseHeaders(),
    "Cache-Control": cacheControl,
    ...extraHeaders,
  };

  // Sin ETag en lo privado: no hay nada que revalidar y el hash del cuerpo podría
  // filtrar que dos visitantes distintos recibieron la misma respuesta.
  // Se comprueba por contenido y no por identidad con la constante: así una
  // política privada nueva (o un `no-store` escrito a mano) tampoco emite ETag.
  if (cacheControl.includes("no-store")) {
    return new Response(body, { status: 200, headers });
  }

  const etag = etagOf(body);
  headers.ETag = etag;
  if (matchesEtag(req.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers });
}

/** Respuesta de error `{ ok: false, error, message? }`. Nunca se cachea. */
export function apiError(
  error: ApiErrorCode,
  status: number,
  message?: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(message ? { ok: false, error, message } : { ok: false, error }), {
    status,
    // `extraHeaders` va al final a propósito: así una ruta de lectura puede
    // sustituir el `no-store` por `CACHE_READ_404`.
    headers: { ...baseHeaders(), "Cache-Control": "private, no-store", ...extraHeaders },
  });
}

export const apiInvalid = (message?: string) => apiError("invalid", 400, message);

/**
 * 404. En una ruta de LECTURA pasa `cacheable: true` para que el CDN absorba la
 * repetición de ids inexistentes (ver `CACHE_READ_404`).
 */
export const apiNotFound = (cacheable = false) =>
  apiError("not_found", 404, undefined, cacheable ? { "Cache-Control": CACHE_READ_404 } : {});

/**
 * 500 con el detalle en Sentry y un código genérico para el cliente. Toda ruta de
 * v1 cierra su `catch` con esto: es el único lugar donde se decide qué sale.
 */
export function apiServerError(route: string, err: unknown): Response {
  reportError(err, { route });
  return apiError("server_error", 500, "Algo falló de nuestro lado. Intenta de nuevo.");
}

/** 429 con las cabeceras del limitador (X-RateLimit-* y Retry-After). */
export function apiRateLimited(
  headers: Record<string, string>,
  code: Extract<ApiErrorCode, "rate_limited" | "daily_limit"> = "rate_limited",
  message = "Demasiadas peticiones. Intenta de nuevo en breve.",
): Response {
  return apiError(code, 429, message, headers);
}

/** Agrega las cabeceras del limitador a una respuesta ya construida. */
export function withRateLimitHeaders(res: Response, headers: Record<string, string>): Response {
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}
