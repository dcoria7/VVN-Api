import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { deploymentBrandId } from "@/lib/deployment-brand";
import { throwIfDatabaseError } from "@/server/data/database-error";
import { isVvnVenue, toApiVenue } from "@/server/api/dto";
import { rowToVenue } from "@/services/venues";
import { getVenueIdsWithLivePromotions } from "@/services/venue-promotions-server";
import { buildVenuePath } from "@/lib/venue-path";

type Row = Record<string, unknown>;
export type DiscoverSchedule = { starts_at: string; ends_at: string | null };

/** Fin exclusivo. También se revalida al mapear y al registrar métricas. */
export function isDiscoverLive(row: Row, now: string): boolean {
  const start = Date.parse(String(row.starts_at));
  const end = row.ends_at == null ? Infinity : Date.parse(String(row.ends_at));
  const time = Date.parse(now);
  return row.brand_id === deploymentBrandId && row.is_active === true && start <= time && time < end;
}

export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export async function getFeaturedVenues(fraccId: string | null, now: string) {
  let query = createSupabaseAdmin().from("vvn_featured_venues")
    .select("*, venue:venues!inner(*)")
    .eq("is_active", true).lte("starts_at", now).or(`ends_at.is.null,ends_at.gt.${now}`)
    .eq("venue.brand_id", deploymentBrandId).eq("venue.is_active", true)
    .order("position").order("created_at").order("id").limit(200);
  if (fraccId) query = query.eq("venue.fraccionamiento_id", fraccId);
  else query = query.not("venue.fraccionamiento_id", "is", null);
  const { data, error } = await query;
  throwIfDatabaseError(error, "getFeaturedVenues");
  const selected = (data ?? []).flatMap(raw => {
    const row = raw as unknown as Row;
    if (!isDiscoverLive(row, now) || !row.venue || typeof row.venue !== "object" || Array.isArray(row.venue)) return [];
    const venue = rowToVenue(row.venue as Row);
    if (!venue.is_active || !isVvnVenue(venue) || (fraccId && venue.fraccionamiento_id !== fraccId)) return [];
    return [{ row, venue }];
  });
  const promos = await getVenueIdsWithLivePromotions(selected.map(({ venue }) => venue.id));
  return selected.map(({ row, venue }) => ({
    placement_id: String(row.id), starts_at: String(row.starts_at), ends_at: row.ends_at as string | null,
    venue: toApiVenue(venue, promos),
  }));
}

export async function getSponsoredCampaigns(fraccId: string | null, now: string) {
  let query = createSupabaseAdmin().from("vvn_sponsored_campaigns").select("*")
    .eq("is_active", true).lte("starts_at", now)
    .or(fraccId ? `and(or(ends_at.is.null,ends_at.gt.${now}),or(fraccionamiento_id.is.null,fraccionamiento_id.eq.${fraccId}))` : `ends_at.is.null,ends_at.gt.${now}`)
    .order("position").order("created_at").order("id").limit(200);
  const { data, error } = await query;
  throwIfDatabaseError(error, "getSponsoredCampaigns");
  const rows = (data ?? []).filter(row => isDiscoverLive(row, now) &&
    (!fraccId || row.fraccionamiento_id == null || row.fraccionamiento_id === fraccId));
  const ids = [...new Set(rows.filter(row => row.target_type === "venue").map(row => String(row.venue_id)))];
  const venues = new Map<string, { id: string; name: string }>();
  if (ids.length) {
    const result = await createSupabaseAdmin().from("venues").select("id,name,brand_id,fraccionamiento_id,is_active")
      .in("id", ids).eq("is_active", true).not("fraccionamiento_id", "is", null);
    throwIfDatabaseError(result.error, "getSponsoredCampaigns.venues");
    for (const venue of result.data ?? []) {
      if (venue.brand_id === deploymentBrandId && venue.is_active && venue.fraccionamiento_id) venues.set(venue.id, venue);
    }
  }
  return rows.flatMap(row => {
    const image = safeHttpsUrl(row.image_url);
    if (!image) return [];
    const venue = venues.get(String(row.venue_id));
    const url = safeHttpsUrl(row.target_url);
    if (row.target_type === "venue" ? !venue : row.target_type !== "url" || !url) return [];
    const target = row.target_type === "venue"
      ? { type: "venue" as const, venue_id: venue!.id, web_path: buildVenuePath(venue!.id, venue!.name) }
      : { type: "url" as const, url: url! };
    return [{
      id: String(row.id), title: String(row.title), image_url: image, kind: String(row.kind),
      cta_label: String(row.cta_label), label: "Patrocinado" as const, target,
      starts_at: String(row.starts_at), ends_at: row.ends_at as string | null,
    }];
  });
}

/** Nunca servir stale más allá de la vigencia de una card. */
export function discoverCacheControl(items: DiscoverSchedule[], now: string): string {
  const deadline = Math.min(...items.flatMap(item => item.ends_at ? [Date.parse(item.ends_at)] : []));
  const ttl = Math.max(0, Math.min(60, Math.floor((deadline - Date.parse(now)) / 1000)));
  return `public, s-maxage=${ttl}, stale-while-revalidate=0`;
}
