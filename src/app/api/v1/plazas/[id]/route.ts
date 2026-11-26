import { getPlazaById } from "@/services/fraccionamientos";
import { getVenuesByPlaza } from "@/services/venues";
import { getVenueIdsWithLivePromotions } from "@/services/venue-promotions-server";
import { isUuidParam, toApiVenues } from "@/server/api/dto";
import {
  CACHE_READ,
  apiInvalid,
  apiNotFound,
  apiOk,
  apiServerError,
} from "@/server/api/respond";

/**
 * GET /api/v1/plazas/{id}
 *
 * La plaza (con `amenities`, `zona`, portada, descripción y las coordenadas de su
 * pin) más sus locales en el mismo orden que la web: despriorizados al final,
 * destacados arriba, abiertos antes que cerrados, luego por nombre.
 *
 * El pin es uno por plaza: los locales heredan sus coordenadas y se ubican adentro
 * con `floor` / `local_number`.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/plazas/[id]">) {
  try {
    const { id } = await ctx.params;
    if (!isUuidParam(id)) return apiInvalid();

    const plaza = await getPlazaById(id);
    if (!plaza) return apiNotFound(true);

    const venues = await getVenuesByPlaza(id);
    const promoVenueIds = await getVenueIdsWithLivePromotions(venues.map((v) => v.id));

    return apiOk(
      req,
      { plaza, venues: toApiVenues(venues, promoVenueIds), counts: { venues: venues.length } },
      CACHE_READ,
    );
  } catch (e) {
    return apiServerError("v1/plazas/[id]", e);
  }
}
