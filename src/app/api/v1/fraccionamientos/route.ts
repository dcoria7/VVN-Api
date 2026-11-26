import { getFraccionamientos } from "@/services/fraccionamientos";
import { CACHE_READ, apiOk, apiServerError } from "@/server/api/respond";

/**
 * GET /api/v1/fraccionamientos
 *
 * Lista completa para el onboarding y el selector de la app. Son unos pocos
 * registros que cambian casi nunca: sin paginación, con el tope natural de la
 * tabla.
 */
export async function GET(req: Request) {
  try {
    const fraccionamientos = await getFraccionamientos();
    return apiOk(req, { fraccionamientos }, CACHE_READ);
  } catch (e) {
    return apiServerError("v1/fraccionamientos", e);
  }
}
