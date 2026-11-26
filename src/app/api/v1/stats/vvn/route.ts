import { consumeRateLimit, getRequestClientIp } from "@/lib/rate-limit";
import { isVvnStatKind, recordVvnStat } from "@/server/stats/vvn-stats";
import { isUuidParam } from "@/server/api/dto";
import {
  CACHE_PRIVATE,
  apiInvalid,
  apiNotFound,
  apiOk,
  apiRateLimited,
  apiServerError,
  withRateLimitHeaders,
} from "@/server/api/respond";
import { readPlatform } from "@/server/api/platform";

/**
 * POST /api/v1/stats/vvn  { id, kind: "plaza"|"parque", platform? }
 *
 * Misma implementación que `/api/vvn/stats` de la web
 * (`src/server/stats/vvn-stats.ts`).
 */
export async function POST(req: Request) {
  try {
    const rl = await consumeRateLimit("stats", getRequestClientIp(req));
    if (!rl.ok) return apiRateLimited(rl.headers);

    const body = await req.json().catch(() => null);
    const b = (body ?? {}) as Record<string, unknown>;
    if (!isUuidParam(b.id) || !isVvnStatKind(b.kind)) return apiInvalid();

    const result = await recordVvnStat(b.id, b.kind, { platform: readPlatform(req, b) });
    if (!result.ok) {
      return result.reason === "not_found"
        ? apiNotFound()
        : apiServerError("v1/stats/vvn", new Error("recordVvnStat falló"));
    }

    return withRateLimitHeaders(apiOk(req, { recorded: true }, CACHE_PRIVATE), rl.headers);
  } catch (e) {
    return apiServerError("v1/stats/vvn", e);
  }
}
