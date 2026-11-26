import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { throwIfDatabaseError } from "@/server/data/database-error";
import { rowToPromotion, isPromotionLive } from "@/services/promotions";

/**
 * Server-only: de un conjunto de venue IDs, cuáles tienen al menos una
 * promoción/cupón vigente. Reusado por las vistas de fraccionamiento y plaza
 * para pintar el badge "Oferta". Las promos son exclusivas de venues VVN, así
 * que quien llama ya pasa solo IDs de fraccionamiento.
 */
export async function getVenueIdsWithLivePromotions(venueIds: string[]): Promise<Set<string>> {
  if (venueIds.length === 0) return new Set();
  const { data, error } = await createSupabaseAdmin()
    .from("promotions")
    .select("*")
    .in("venue_id", venueIds)
    .eq("is_active", true);
  throwIfDatabaseError(error, "getVenueIdsWithLivePromotions");
  const now = new Date().toISOString();
  const ids = new Set<string>();
  (data ?? [])
    .map(rowToPromotion)
    .filter((p) => isPromotionLive(p, now))
    .forEach((p) => ids.add(p.venue_id));
  return ids;
}
