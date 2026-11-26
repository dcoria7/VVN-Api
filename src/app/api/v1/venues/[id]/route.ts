import { unstable_cache } from "next/cache";
import { deploymentScope } from "@/lib/deployment-brand";
import { getVenueDetailData } from "@/services/venue-detail-server";
import { isUuidParam, isVvnVenue, toApiVenue } from "@/server/api/dto";
import {
  CACHE_READ,
  apiInvalid,
  apiNotFound,
  apiOk,
  apiServerError,
} from "@/server/api/respond";

// Caché de datos además del CDN: la caché del CDN es por región, así que un fallo
// de caché en cada región volvería a consultar Supabase. El tag "venues" es local
// a este despliegue; las invalidaciones de la web no se comparten automáticamente.
//
// Null representa ausencia real. No persistir ese resultado en la caché de datos
// de 300 s; el 404 ya tiene su TTL HTTP corto. Los fallos de consultas se propagan
// como 500 sin caché. No hace falta repetir una lectura que ya comprobó ausencia.
const EMPTY = "v1-venue-empty";

const loadVenueDetailCached = unstable_cache(
  async (venueId: string) => {
    const data = await getVenueDetailData(venueId);
    if (!data) throw new Error(EMPTY);
    return data;
  },
  ["v1-venue-detail", "read-errors-v1", deploymentScope],
  { tags: ["venues"], revalidate: 300 },
);

async function loadVenueDetail(venueId: string) {
  try {
    return await loadVenueDetailCached(venueId);
  } catch (e) {
    if (e instanceof Error && e.message === EMPTY) return null;
    throw e;
  }
}

/**
 * GET /api/v1/venues/{id}
 *
 * La ficha completa: negocio + menú + servicios + promociones vigentes + galería
 * (máx. 10) + la tarjeta de su plaza, más `is_pro`.
 *
 * Solo acepta UUID. El slug de una URL web se traduce con
 * `GET /api/v1/venues/resolve?path=`.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/venues/[id]">) {
  try {
    const { id } = await ctx.params;
    if (!isUuidParam(id)) return apiInvalid();

    const data = await loadVenueDetail(id);
    // 404 también cuando el negocio existe pero es de ClickLocal general: esta API
    // es solo de Vive Valle Norte (la pared).
    if (!data || !isVvnVenue(data.venue)) return apiNotFound(true);

    const promoVenueIds =
      data.promotions.length > 0 ? new Set([data.venue.id]) : new Set<string>();

    return apiOk(
      req,
      {
        venue: toApiVenue(data.venue, promoVenueIds),
        menu_items: data.menuItems,
        services: data.services,
        promotions: data.promotions,
        photos: data.photos,
        plaza_card: data.vvnPlaza,
      },
      CACHE_READ,
    );
  } catch (e) {
    return apiServerError("v1/venues/[id]", e);
  }
}
