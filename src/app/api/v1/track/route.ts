import { consumeRateLimit, getRequestClientIp } from "@/lib/rate-limit";
import { recordTrackEvent } from "@/server/stats/track";
import {
  CACHE_PRIVATE,
  apiError,
  apiOk,
  apiRateLimited,
  apiServerError,
  withRateLimitHeaders,
} from "@/server/api/respond";
import { readPlatform } from "@/server/api/platform";

/**
 * POST /api/v1/track  { event, entityType?, entityId?, fraccionamientoId?, meta?, platform? }
 *
 * Misma validación que `/api/track` de la web (`src/server/stats/track.ts`):
 * whitelist estricta, `meta` acotado a 8 claves y rechazo explícito de los eventos
 * con contraparte en columna (`venue_view`, `promo_view`, `rating_submit`…), que
 * solo escribe el servidor dentro del dual-write. Emitirlos desde la app los
 * contaría dos veces.
 */
export async function POST(req: Request) {
  try {
    const rl = await consumeRateLimit("stats", getRequestClientIp(req));
    if (!rl.ok) return apiRateLimited(rl.headers);

    const body = await req.json().catch(() => null);
    const result = await recordTrackEvent(body, { platform: readPlatform(req, body ?? {}) });

    if (!result.ok) {
      if (result.reason === "server_error") {
        return apiServerError("v1/track", new Error("recordTrackEvent falló"));
      }
      return apiError(result.reason, 400);
    }

    return withRateLimitHeaders(apiOk(req, { recorded: true }, CACHE_PRIVATE), rl.headers);
  } catch (e) {
    return apiServerError("v1/track", e);
  }
}
