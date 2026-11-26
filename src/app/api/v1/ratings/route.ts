import { consumeRateLimit, getRequestClientIp } from "@/lib/rate-limit";
import { readRating, submitRating, visitorKeyFrom } from "@/server/stats/rating";
import { isUuidParam } from "@/server/api/dto";
import {
  CACHE_PRIVATE,
  apiError,
  apiInvalid,
  apiNotFound,
  apiOk,
  apiRateLimited,
  apiServerError,
  withRateLimitHeaders,
} from "@/server/api/respond";
import { readPlatform } from "@/server/api/platform";
import { VISITOR_HEADER } from "@/lib/visitor-id";

/**
 * Calificaciones de negocio (estrellas 1–5), solo Vive Valle Norte.
 *
 * Identidad del visitante por la cabecera `X-Visitor-Id`: un UUID que la app
 * genera en el primer arranque y guarda en Keychain / DataStore cifrado. Sin esa
 * cabecera, cada petición cuenta como un visitante nuevo y lo único que frena es
 * el tope por IP y día.
 *
 * Los tres frenos del diseño original siguen intactos: limitador por IP
 * (`rating-submit`, 5/min), dedupe por visitante y tope de 10 votos NUEVOS por IP
 * y día. Corregir el voto propio no consume cupo.
 */

/**
 * GET /api/v1/ratings?venueId=
 *
 * ⚠️ ÚNICA respuesta personalizada de toda la API: trae el voto de ESTE visitante.
 * Por eso va `private, no-store` y nunca toca el CDN — servirla compartida sería
 * enseñarle a todos el voto de uno. `Vary: X-Visitor-Id` por si hay una caché
 * intermedia que ignore el `private`.
 */
export async function GET(req: Request) {
  try {
    const venueId = new URL(req.url).searchParams.get("venueId");
    if (!isUuidParam(venueId)) return apiInvalid();

    const rating = await readRating(venueId, await visitorKeyFrom(req, { acceptHeader: true }));
    if (!rating) return apiNotFound();

    return apiOk(req, rating, CACHE_PRIVATE, { Vary: VISITOR_HEADER });
  } catch (e) {
    return apiServerError("v1/ratings GET", e);
  }
}

/** POST /api/v1/ratings  { venueId, stars: 1-5, platform? } */
export async function POST(req: Request) {
  try {
    const ip = getRequestClientIp(req);
    const rl = await consumeRateLimit("rating-submit", ip);
    if (!rl.ok) {
      return apiRateLimited(
        rl.headers,
        "rate_limited",
        "Demasiadas calificaciones. Intenta de nuevo en breve.",
      );
    }

    const body = await req.json().catch(() => null);
    const b = (body ?? {}) as Record<string, unknown>;
    const stars = Number(b.stars);
    if (!isUuidParam(b.venueId)) return apiInvalid();
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return apiError("invalid_stars", 400, "Las estrellas van de 1 a 5.");
    }

    const result = await submitRating({
      venueId: b.venueId,
      stars,
      visitorKey: await visitorKeyFrom(req, { acceptHeader: true }),
      ip,
      platform: readPlatform(req, b),
    });

    if (!result.ok) {
      if (result.reason === "not_found") return apiNotFound();
      if (result.reason === "not_rateable") {
        return apiError(
          "not_rateable",
          400,
          "Este negocio no se puede calificar: las calificaciones son solo de Vive Valle Norte.",
        );
      }
      if (result.reason === "daily_limit") {
        return apiRateLimited(
          rl.headers,
          "daily_limit",
          "Alcanzaste el máximo de calificaciones por hoy.",
        );
      }
      return apiServerError("v1/ratings POST", new Error("submitRating falló"));
    }

    return withRateLimitHeaders(
      apiOk(req, { sum: result.sum, count: result.count, mine: result.mine }, CACHE_PRIVATE),
      rl.headers,
    );
  } catch (e) {
    return apiServerError("v1/ratings POST", e);
  }
}
