import { getParqueById } from "@/services/fraccionamientos";
import { isUuidParam } from "@/server/api/dto";
import {
  CACHE_READ,
  apiInvalid,
  apiNotFound,
  apiOk,
  apiServerError,
} from "@/server/api/respond";

/**
 * GET /api/v1/parques/{id}
 *
 * Los parques son vitrina de zona: entidad aparte de los negocios, sin dueño, sin
 * plan Pro y sin capado. Trae descripción, amenidades, galería y coordenadas.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/parques/[id]">) {
  try {
    const { id } = await ctx.params;
    if (!isUuidParam(id)) return apiInvalid();

    const parque = await getParqueById(id);
    if (!parque) return apiNotFound(true);

    return apiOk(req, { parque }, CACHE_READ);
  } catch (e) {
    return apiServerError("v1/parques/[id]", e);
  }
}
