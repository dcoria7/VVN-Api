import { getZonePromotionsByVenue } from "@/services/zone-promotions-server";
import { getFraccionamientoBySlug } from "@/services/fraccionamientos";
import { isSlugParam, normalizeSlugParam, parseCursor, parseLimit, paginate } from "@/server/api/dto";
import {
  CACHE_READ,
  apiInvalid,
  apiNotFound,
  apiOk,
  apiServerError,
} from "@/server/api/respond";

/**
 * GET /api/v1/cupones?fraccionamiento=&limit=&cursor=
 *
 * Las ofertas y cupones vigentes de la zona, AGRUPADOS por negocio: dentro de cada
 * grupo las ofertas van antes que los cupones, y los grupos se ordenan por la promo
 * más reciente. Nunca se intercalan promos de negocios distintos.
 *
 * Es la pestaña Cupones de la app y la superficie que paga el negocio Pro, así que
 * devuelve todo lo necesario para pintar la tarjeta completa sin una segunda
 * llamada: la promoción entera (`kind`, `title`, `description`, `discount_label`,
 * `code`, `image_url`, `terms`, `starts_at`, `ends_at`) más la identidad del
 * negocio.
 *
 * La paginación cuenta GRUPOS (negocios), no promociones: partir un negocio entre
 * dos páginas rompería el agrupado, que es justamente lo que da valor a la vista.
 */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const limit = parseLimit(params.get("limit"));
    const offset = parseCursor(params.get("cursor"));
    const fraccSlug = params.get("fraccionamiento")?.trim() || null;

    let fraccId: string | null = null;
    if (fraccSlug) {
      if (!isSlugParam(fraccSlug)) return apiInvalid();
      const f = await getFraccionamientoBySlug(normalizeSlugParam(fraccSlug));
      if (!f) return apiNotFound(true);
      fraccId = f.id;
    }

    // El servicio ya devuelve solo venues de coto (VVN): la pared viene aplicada
    // desde la query, que exige `fraccionamiento_id` no nulo.
    const all = await getZonePromotionsByVenue();
    const filtered = fraccId ? all.filter((g) => g.fraccionamientoId === fraccId) : all;

    const page = paginate(filtered, limit, offset);

    return apiOk(
      req,
      {
        groups: page.items.map((g) => ({
          venue_id: g.venueId,
          venue_name: g.venueName,
          venue_logo_url: g.venueLogoUrl,
          venue_web_path: g.venueHref,
          fraccionamiento_id: g.fraccionamientoId,
          promotions: g.promotions,
        })),
        next_cursor: page.next_cursor,
        total: page.total,
      },
      CACHE_READ,
    );
  } catch (e) {
    return apiServerError("v1/cupones", e);
  }
}
