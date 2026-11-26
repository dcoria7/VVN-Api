import { throwIfDatabaseError } from "@/server/data/database-error";
import { supabase } from "@/lib/supabase";
import type { Promotion } from "@/types";

// Lectura pública de promociones/cupones de un negocio. La escritura vive en el
// admin (service role). Ver [[vista-fraccionamiento-plazas]] y la ficha de venue.

export function rowToPromotion(row: Record<string, unknown>): Promotion {
  return {
    id: row.id as string,
    venue_id: row.venue_id as string,
    kind: (row.kind as Promotion["kind"]) === "coupon" ? "coupon" : "promo",
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    discount_label: (row.discount_label as string | null) ?? null,
    code: (row.code as string | null) ?? null,
    image_url: (row.image_url as string | null) ?? null,
    terms: (row.terms as string | null) ?? null,
    starts_at: (row.starts_at as string | null) ?? null,
    ends_at: (row.ends_at as string | null) ?? null,
    is_active: Boolean(row.is_active),
    views: Number(row.views) || 0,
    taps: Number(row.taps) || 0,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** ¿La promo se muestra ahora? (activa + dentro de la ventana de vigencia). */
export function isPromotionLive(p: Promotion, nowIso: string = new Date().toISOString()): boolean {
  if (!p.is_active) return false;
  if (p.starts_at && p.starts_at > nowIso) return false;
  if (p.ends_at && p.ends_at <= nowIso) return false;
  return true;
}

/** IDs de venues que tienen al menos una promo/cupón vigente (RLS filtra activos+vigentes). */
export async function getVenueIdsWithActivePromotions(): Promise<Set<string>> {
  const { data, error } = await supabase.from("promotions").select("venue_id");
  throwIfDatabaseError(error, "getVenueIdsWithActivePromotions");
  return new Set((data ?? []).map((r) => r.venue_id as string));
}

/**
 * Registra las vistas de TODAS las promos visibles en una sola petición
 * (fire-and-forget).
 *
 * Antes era una llamada por promo dentro de un forEach, así que una ficha con el
 * tope de 12 promos activas del bot disparaba 12 invocaciones de función por cada
 * visita — cada una pagando su propio arranque, su rate-limit y su cliente de
 * Supabase. Además quemaba 12 de los 30 req/min del limitador `stats` en una sola
 * carga, así que ver dos o tres fichas con promos podía acabar en 429.
 */
export function incrementPromotionViews(ids: string[]): void {
  if (ids.length === 0) return;
  fetch("/api/promotions/stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, kind: "view" }),
  }).catch(() => {/* silencioso */});
}

/** Registra un tap de código de cupón desde el cliente (fire-and-forget). */
export function incrementPromotionTaps(id: string): void {
  fetch("/api/promotions/stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, kind: "tap" }),
  }).catch(() => {/* silencioso */});
}

/** Promos vigentes de un negocio (cupones al final para que las ofertas destaquen). */
export async function getActivePromotionsByVenue(venueId: string): Promise<Promotion[]> {
  const { data, error } = await supabase
    .from("promotions")
    .select("*")
    .eq("venue_id", venueId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  throwIfDatabaseError(error, "getActivePromotionsByVenue");
  const now = new Date().toISOString();
  return (data ?? []).map(rowToPromotion).filter((p) => isPromotionLive(p, now));
}
