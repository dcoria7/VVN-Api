import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { UUID_RE } from "@/server/api/dto";
import { throwIfDatabaseError } from "@/server/data/database-error";
import { isDiscoverLive } from "@/services/discover";

export function discoverTrackingKey(event: string): "placement_id" | "campaign_id" | null {
  if (event === "featured_impression" || event === "featured_open") return "placement_id";
  if (event === "sponsored_impression" || event === "sponsored_click") return "campaign_id";
  return null;
}

/** No aceptar métricas inventadas ni atribuir a otra marca/campaña. */
export async function validDiscoverTracking(event: string, entityType: string | null, entityId: string | null, meta: unknown): Promise<boolean> {
  const key = discoverTrackingKey(event);
  if (!key) return true;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  const id = (meta as Record<string, unknown>)[key];
  if (typeof id !== "string" || !UUID_RE.test(id)) return false;
  if (key === "placement_id" ? entityType !== "venue" || !entityId : entityType !== null || entityId !== null) return false;
  const table = key === "placement_id" ? "vvn_featured_venues" : "vvn_sponsored_campaigns";
  const { data, error } = await createSupabaseAdmin().from(table).select("*").eq("id", id).maybeSingle();
  throwIfDatabaseError(error, "validDiscoverTracking");
  if (!data || !isDiscoverLive(data, new Date().toISOString())) return false;
  return key !== "placement_id" || data.venue_id === entityId;
}
