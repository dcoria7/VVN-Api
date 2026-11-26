import { getVvnFeedVenues } from "@/services/venues";
import { getActiveVvnAnnouncements } from "@/services/vvn-announcements";
import { parseCursor, parseLimit, paginate, toApiVenues } from "@/server/api/dto";
import { CACHE_READ, apiOk, apiServerError } from "@/server/api/respond";

/**
 * GET /api/v1/feed?limit=&cursor=
 *
 * Las actualizaciones del día de TODA la zona: negocios VVN con texto o foto del
 * día de menos de 24 h, más recientes primero, más los avisos de la casa.
 *
 * Los avisos van completos y sin paginar: son dos o tres y encabezan el feed. La
 * paginación aplica solo a los negocios.
 *
 * `daily_update` ya viene en null cuando la actualización caducó (lo decide
 * `rowToVenue`), así que la frescura no hay que recalcularla en el cliente; lo que
 * sí recalcula el cliente es el estado abierto/cerrado.
 */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const limit = parseLimit(params.get("limit"));
    const offset = parseCursor(params.get("cursor"));

    const [venues, announcements] = await Promise.all([
      getVvnFeedVenues(),
      getActiveVvnAnnouncements(),
    ]);

    const page = paginate(toApiVenues(venues), limit, offset);

    return apiOk(
      req,
      {
        // Los avisos solo en la primera página (sin cursor): en las siguientes
        // serían ruido repetido.
        announcements: offset === 0 ? announcements : [],
        venues: page.items,
        next_cursor: page.next_cursor,
        total: page.total,
      },
      CACHE_READ,
    );
  } catch (e) {
    return apiServerError("v1/feed", e);
  }
}
