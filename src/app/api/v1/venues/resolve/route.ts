import { resolveVenueByPath } from "@/server/api/resolve-venue";
import { buildVenuePath } from "@/lib/venue-path";
import { isSlugParam, normalizeSlugParam } from "@/server/api/dto";
import { consumeRateLimit, getRequestClientIp } from "@/lib/rate-limit";
import {
  CACHE_READ,
  apiInvalid,
  apiNotFound,
  apiOk,
  apiRateLimited,
  apiServerError,
} from "@/server/api/respond";

/**
 * GET /api/v1/venues/resolve?path={slug}
 *
 * Traduce el segmento de una URL web a un id de negocio, para que un deep link
 * `vivevallenorte.com/venue/panaderia-la-espiga` abra la ficha correcta en la app.
 * Acepta el slug del nombre, el slug con short-id y el UUID.
 *
 * DEUDA CONOCIDA (decisión 2026-10-19, consciente): `resolveVenueByPath` resuelve
 * el camino normal leyendo todos los venues activos y haciendo el match en JS —
 * O(n filas). Se decidió NO agregar la columna `slug` indexada todavía porque
 * tocaría los caminos de escritura del admin y del bot, y porque el costo queda
 * contenido por `unstable_cache` (300 s, tag "venues") más el CDN.
 *
 * ⚠️ Pero esas cachés protegen el tráfico legítimo, NO a un adversario: cada `path`
 * distinto es una URL nueva (el CDN no ayuda), una entrada de caché nueva y un
 * escaneo nuevo de ~130 filas. Medido: 104-200 ms por path inédito. Por eso esta
 * ruta —la única de lectura que amplifica una petición HTTP en un escaneo de
 * tabla— lleva limitador por IP. Las otras lecturas no lo necesitan porque su
 * trabajo pesado queda detrás de `unstable_cache`.
 *
 * El arreglo de raíz sigue siendo la columna `slug` indexada.
 */
export async function GET(req: Request) {
  try {
    const rl = await consumeRateLimit("api-read", getRequestClientIp(req));
    if (!rl.ok) return apiRateLimited(rl.headers);

    // Normalizar a minúsculas ANTES de resolver: `resolveVenueByPath` cachea por
    // string exacto, así que "Panaderia-X" y "panaderia-x" serían dos entradas de
    // caché y dos escaneos de tabla para el mismo negocio.
    const raw = new URL(req.url).searchParams.get("path");
    const path = raw ? normalizeSlugParam(raw) : null;

    // Charset acotado, no solo longitud: así una cadena arbitraria no llega a la
    // DB ni abre una entrada de caché. `isSlugParam` cubre las tres formas que
    // produce la web (slug del nombre, slug-shortid y UUID en minúsculas).
    if (!isSlugParam(path)) return apiInvalid();

    const row = await resolveVenueByPath(path);
    // La pared: un negocio de ClickLocal general no se resuelve por esta API.
    if (!row || !row.fraccionamiento_id) return apiNotFound(true);

    return apiOk(
      req,
      { id: row.id, name: row.name, web_path: buildVenuePath(row.id, row.name) },
      CACHE_READ,
    );
  } catch (e) {
    return apiServerError("v1/venues/resolve", e);
  }
}
