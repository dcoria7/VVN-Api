import { consumeRateLimit, getRequestClientIp } from "@/lib/rate-limit";
import { isVenueStatKind, recordVenueStat } from "@/server/stats/venue-stats";
import { isUuidParam } from "@/server/api/dto";
import {
  apiInvalid,
  apiNotFound,
  apiOk,
  apiRateLimited,
  apiServerError,
  withRateLimitHeaders,
  CACHE_PRIVATE,
} from "@/server/api/respond";
import { readPlatform } from "@/server/api/platform";

/**
 * POST /api/v1/stats/venue  { venueId, kind: "view"|"whatsapp"|"website", platform? }
 *
 * Misma implementación que `/api/venues/stats` de la web
 * (`src/server/stats/venue-stats.ts`): dual-write del contador y del evento.
 */
export async function POST(req: Request) {
  try {
    const rl = await consumeRateLimit("stats", getRequestClientIp(req));
    if (!rl.ok) return apiRateLimited(rl.headers);

    const body = await req.json().catch(() => null);
    const b = (body ?? {}) as Record<string, unknown>;
    if (!isUuidParam(b.venueId) || !isVenueStatKind(b.kind)) return apiInvalid();

    const result = await recordVenueStat(b.venueId, b.kind, { platform: readPlatform(req, b) });
    if (!result.ok) {
      return result.reason === "not_found"
        ? apiNotFound()
        : apiServerError("v1/stats/venue", new Error("recordVenueStat falló"));
    }

    return withRateLimitHeaders(apiOk(req, { recorded: true }, CACHE_PRIVATE), rl.headers);
  } catch (e) {
    return apiServerError("v1/stats/venue", e);
  }
}
