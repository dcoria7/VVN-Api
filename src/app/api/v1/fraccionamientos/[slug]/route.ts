import { loadFraccPayload } from "@/server/api/fracc-payload";
import { isSlugParam, normalizeSlugParam } from "@/server/api/dto";
import {
  CACHE_READ,
  apiInvalid,
  apiNotFound,
  apiOk,
  apiServerError,
} from "@/server/api/respond";

/**
 * GET /api/v1/fraccionamientos/{slug}
 *
 * El home de la pestaña Explorar completo en una llamada: fraccionamiento, plazas,
 * parques, negocios (con `is_pro` y `has_promo`), avisos de la casa y conteos.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/fraccionamientos/[slug]">) {
  try {
    const { slug } = await ctx.params;
    if (!isSlugParam(slug)) return apiInvalid();

    const data = await loadFraccPayload(normalizeSlugParam(slug));
    if (!data) return apiNotFound(true);

    return apiOk(req, data, CACHE_READ);
  } catch (e) {
    return apiServerError("v1/fraccionamientos/[slug]", e);
  }
}
