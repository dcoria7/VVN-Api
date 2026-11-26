import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { throwIfDatabaseError } from "@/server/data/database-error";
import { rowToPromotion, isPromotionLive } from "@/services/promotions";
import { buildVenuePath } from "@/lib/venue-path";
import type { Promotion } from "@/types";

/** Un negocio con TODAS sus promociones vigentes (ofertas + cupones), agrupadas. */
export interface ZoneVenuePromos {
  venueId: string;
  /** Coto del negocio. Lo usa la API móvil para filtrar por ?fraccionamiento=. */
  fraccionamientoId: string;
  venueName: string;
  venueLogoUrl: string | null;
  /** Enlace a la ficha del negocio (el tap de cualquier card lleva ahí). */
  venueHref: string;
  /** Ofertas primero, luego cupones. Nunca se intercalan con otros negocios. */
  promotions: Promotion[];
}

/**
 * Server-only: todas las promociones vigentes (ofertas + cupones) de venues de
 * fraccionamiento (VVN), AGRUPADAS por negocio. Dentro de cada negocio, las
 * ofertas van antes que los cupones; los grupos se ordenan por promo más reciente.
 */
export async function getZonePromotionsByVenue(): Promise<ZoneVenuePromos[]> {
  const { data, error } = await createSupabaseAdmin()
    .from("promotions")
    .select("*, venue:venues!inner(id, name, logo_url, cover_url, fraccionamiento_id)")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  throwIfDatabaseError(error, "getZonePromotionsByVenue");
  const now = new Date().toISOString();

  const groups = new Map<string, ZoneVenuePromos & { latest: number }>();

  for (const row of data ?? []) {
    const v = row.venue as
      | { id: string; name: string; logo_url: string | null; cover_url: string | null; fraccionamiento_id: string | null }
      | null;
    if (!v?.fraccionamiento_id) continue; // solo venues de coto (VVN)

    const promo = rowToPromotion(row);
    if (!isPromotionLive(promo, now)) continue;

    let g = groups.get(v.id);
    if (!g) {
      g = {
        venueId: v.id,
        fraccionamientoId: v.fraccionamiento_id,
        venueName: v.name,
        venueLogoUrl: v.logo_url ?? v.cover_url,
        venueHref: buildVenuePath(v.id, v.name),
        promotions: [],
        latest: 0,
      };
      groups.set(v.id, g);
    }
    g.promotions.push(promo);
    const ts = new Date(promo.created_at).getTime();
    if (ts > g.latest) g.latest = ts;
  }

  const kindRank = (p: Promotion) => (p.kind === "promo" ? 0 : 1); // ofertas antes que cupones

  return [...groups.values()]
    .sort((a, b) => b.latest - a.latest)
    .map((g) => ({
      venueId: g.venueId,
      fraccionamientoId: g.fraccionamientoId,
      venueName: g.venueName,
      venueLogoUrl: g.venueLogoUrl,
      venueHref: g.venueHref,
      promotions: g.promotions.sort(
        (a, b) => kindRank(a) - kindRank(b) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    }));
}
