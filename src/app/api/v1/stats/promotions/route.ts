import { consumeRateLimit, getRequestClientIp } from "@/lib/rate-limit";
import {
  MAX_PROMOS_PER_REQUEST,
  isPromotionStatKind,
  recordPromotionStats,
} from "@/server/stats/promotion-stats";
import { UUID_RE } from "@/server/api/dto";
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
 * POST /api/v1/stats/promotions  { ids: string[] | id: string, kind: "view"|"tap", platform? }
 *
 * Lote de vistas (la pestaña Cupones manda de una vez todas las promos visibles)
 * o un tap suelto al copiar un código.
 *
 * El tope del lote es `MAX_PROMOS_PER_REQUEST` (100) y la respuesta DICE cuántos
 * se registraron, para que el cliente note el truncamiento en vez de perder
 * métricas en silencio. Si tienes más, manda varios lotes.
 */
export async function POST(req: Request) {
  try {
    const rl = await consumeRateLimit("stats", getRequestClientIp(req));
    if (!rl.ok) return apiRateLimited(rl.headers);

    const body = await req.json().catch(() => null);
    const b = (body ?? {}) as Record<string, unknown>;

    const raw: unknown[] = Array.isArray(b.ids) ? b.ids : [b.id];

    // Cota ANTES de validar: el límite de body de Vercel deja pasar ~100 k strings,
    // y correr la regex de UUID sobre todos para después quedarnos con 100 es
    // trabajo regalado que un cliente puede provocar 30 veces por minuto.
    if (raw.length > MAX_PROMOS_PER_REQUEST * 2) {
      return apiInvalid(`Máximo ${MAX_PROMOS_PER_REQUEST} ids por petición.`);
    }

    const ids = [
      ...new Set(raw.filter((v): v is string => typeof v === "string" && UUID_RE.test(v))),
    ];
    if (ids.length === 0 || !isPromotionStatKind(b.kind)) return apiInvalid();

    const result = await recordPromotionStats(ids, b.kind, {
      platform: readPlatform(req, b),
      source: "api/v1",
    });
    if (!result.ok) {
      if (result.reason === "not_found") return apiNotFound();
      return apiServerError("v1/stats/promotions", new Error("recordPromotionStats falló"));
    }

    return withRateLimitHeaders(
      apiOk(
        req,
        {
          recorded: Math.min(ids.length, MAX_PROMOS_PER_REQUEST),
          // `received` es el crudo que mandó el cliente y `rejected` lo que se cayó
          // por no ser UUID o por estar repetido. Antes `received` era el conteo YA
          // deduplicado, así que mandar 50 ids con 10 basura se veía como
          // "recorded 40, received 40" y el cliente nunca se enteraba — el mismo
          // silencio que este endpoint dice haber eliminado.
          received: raw.length,
          rejected: raw.length - ids.length,
          max_per_request: MAX_PROMOS_PER_REQUEST,
        },
        CACHE_PRIVATE,
      ),
      rl.headers,
    );
  } catch (e) {
    return apiServerError("v1/stats/promotions", e);
  }
}
