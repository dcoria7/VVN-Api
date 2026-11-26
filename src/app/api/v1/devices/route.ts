import { consumeRateLimit, getRequestClientIp } from "@/lib/rate-limit";
import {
  MAX_TOKEN_LEN,
  isDevicePlatform,
  registerDevice,
} from "@/server/stats/devices";
import { parseVisitorIdHeader as parseUuidLike } from "@/lib/visitor-id";
import { isSlugParam } from "@/server/api/dto";
import {
  CACHE_PRIVATE,
  apiError,
  apiInvalid,
  apiOk,
  apiRateLimited,
  apiServerError,
  withRateLimitHeaders,
} from "@/server/api/respond";
import { VISITOR_HEADER, parseVisitorIdHeader, hashKey } from "@/lib/visitor-id";

/**
 * POST /api/v1/devices
 * { token, platform: "ios"|"android", installId?, fraccionamientoSlug?,
 *   topics?: string[], appVersion? }
 *
 * Registro y renovación del token de push.
 *
 * **Manda `installId`**: un UUID que la app genera una vez y conserva mientras esté
 * instalada. Es la clave con la que se deduplica el dispositivo. Sin él, el upsert
 * va por `token` — y como el token lo rota el sistema, cada rotación deja una fila
 * nueva y la anterior sigue suscrita, así que el mismo teléfono acaba recibiendo la
 * notificación dos veces.
 *
 * Un token es un IDENTIFICADOR DE DISPOSITIVO: no se registra en logs ni en
 * Sentry, y tampoco se devuelve en la respuesta. El `visitor_key` que se guarda es
 * el mismo hash con salt de las calificaciones, nunca el id en claro.
 *
 * Limitador propio y generoso (`device-register`, 30/min): la app llama al
 * arrancar y varios dispositivos detrás de un mismo NAT comparten IP.
 *
 * El ENVÍO de las notificaciones es trabajo de admin y queda fuera de esta API.
 */
export async function POST(req: Request) {
  try {
    const rl = await consumeRateLimit("device-register", getRequestClientIp(req));
    if (!rl.ok) return apiRateLimited(rl.headers);

    const body = await req.json().catch(() => null);
    const b = (body ?? {}) as Record<string, unknown>;

    const token = typeof b.token === "string" ? b.token.trim() : "";
    if (!token || token.length > MAX_TOKEN_LEN) return apiInvalid();
    if (!isDevicePlatform(b.platform)) return apiInvalid();

    // Slug opcional: si viene con forma inválida se descarta en vez de rechazar el
    // registro entero — perder el filtro por zona es mejor que perder el token.
    const fraccionamientoSlug = isSlugParam(b.fraccionamientoSlug) ? b.fraccionamientoSlug : null;

    const visitorId = parseVisitorIdHeader(req.headers.get(VISITOR_HEADER));

    const result = await registerDevice({
      token,
      platform: b.platform,
      installId: parseUuidLike(typeof b.installId === "string" ? b.installId : null),
      fraccionamientoSlug,
      topics: Array.isArray(b.topics) ? (b.topics as string[]) : [],
      appVersion: typeof b.appVersion === "string" ? b.appVersion : null,
      visitorKey: visitorId ? hashKey([visitorId]) : null,
    });

    if (!result.ok) {
      // Falta adaptar el contrato por marca de device_tokens: es infraestructura
      // pendiente, no una falla. 503 para que el cliente reintente, y sin reportar
      // a Sentry — si no, cada arranque de app genera un evento.
      if (result.reason === "unavailable") {
        return apiError(
          "unavailable",
          503,
          "El registro de notificaciones todavía no está disponible.",
        );
      }
      return apiServerError("v1/devices", new Error("registerDevice falló"));
    }

    return withRateLimitHeaders(apiOk(req, { registered: true }, CACHE_PRIVATE), rl.headers);
  } catch (e) {
    return apiServerError("v1/devices", e);
  }
}
