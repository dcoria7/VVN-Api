import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { throwIfDatabaseError } from "@/server/data/database-error";
import { getFeaturedVenues, getSponsoredCampaigns, discoverCacheControl } from "@/services/discover";
import { getFraccionamientoBySlug } from "@/services/fraccionamientos";
import { isSlugParam, normalizeSlugParam, paginate, parseCursor, parseLimit } from "@/server/api/dto";
import { apiInvalid, apiNotFound, apiOk, apiServerError } from "@/server/api/respond";

/** Dos swimlanes independientes, curados desde el admin; GET no genera impresiones. */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const limit = Math.min(20, parseLimit(params.get("limit") ?? "6"));
    const featuredOffset = parseCursor(params.get("featured_cursor"));
    const sponsoredOffset = parseCursor(params.get("sponsored_cursor"));
    const slug = params.get("fraccionamiento")?.trim() || null;
    let fraccId: string | null = null;
    if (slug) {
      if (!isSlugParam(slug)) return apiInvalid();
      const fracc = await getFraccionamientoBySlug(normalizeSlugParam(slug));
      if (!fracc) return apiNotFound(true);
      fraccId = fracc.id;
    }
    const now = new Date().toISOString();
    const [featured, sponsored] = await Promise.all([
      getFeaturedVenues(fraccId, now), getSponsoredCampaigns(fraccId, now),
    ]);
    const featuredPage = paginate(featured, limit, featuredOffset);
    const sponsoredPage = paginate(sponsored, limit, sponsoredOffset);
    // Plazas públicas para reutilizar la card de Explorar sin depender de su caché.
    const plazaIds = [...new Set(featuredPage.items.flatMap(item => item.venue.plaza_id ? [item.venue.plaza_id] : []))];
    let plazas: { id: string; name: string }[] = [];
    if (plazaIds.length) {
      const result = await createSupabaseAdmin().from("plazas").select("id,name").in("id", plazaIds);
      throwIfDatabaseError(result.error, "discover.plazas");
      plazas = (result.data ?? []).map(({ id, name }) => ({ id, name }));
    }
    return apiOk(req, {
      featured_venues: { visible: featuredPage.items.length > 0, ...featuredPage },
      sponsored: { visible: sponsoredPage.items.length > 0, ...sponsoredPage }, plazas,
    },
      discoverCacheControl([...featuredPage.items, ...sponsoredPage.items], now));
  } catch (error) {
    return apiServerError("v1/descubre", error);
  }
}
