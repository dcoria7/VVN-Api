import "server-only";
import { brandEntityExists } from "@/server/data/brand-entities";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { logAnalyticsEvent } from "@/lib/track-server";
import type { TrackEvent } from "@/lib/track";
import { throwIfDatabaseError } from "@/server/data/database-error";
import { WRITE_NOT_FOUND, WRITE_OK, type WriteResult } from "./types";

// Cuerpo compartido de /api/venues/stats (web) y /api/v1/stats/venue (apps).
//
// Está extraído aquí a propósito: el doble conteo de `rating_submit` de octubre
// (ver bitácora 2026-10-12) nació de tener la misma lógica de métrica en dos
// lados. Una implementación, dos superficies.

export type VenueStatKind = "view" | "whatsapp" | "website";

export const VENUE_STAT_KINDS: readonly VenueStatKind[] = ["view", "whatsapp", "website"];

export function isVenueStatKind(v: unknown): v is VenueStatKind {
  return typeof v === "string" && (VENUE_STAT_KINDS as readonly string[]).includes(v);
}

const EVENT_FOR: Record<VenueStatKind, TrackEvent> = {
  view: "venue_view",
  whatsapp: "venue_whatsapp",
  website: "venue_website",
};

const RPC_FOR: Record<VenueStatKind, string> = {
  view: "increment_venue_views",
  whatsapp: "increment_whatsapp_taps",
  website: "increment_website_taps",
};

/**
 * Incrementa views / whatsapp_taps / website_taps sin exponer la service role.
 * Dual-write: el contador de la tabla más el evento en `analytics_events`.
 * Si falla el RPC, se propaga el error. No simular éxito con un incremento no atómico.
 */
export async function recordVenueStat(
  venueId: string,
  kind: VenueStatKind,
  opts: { platform?: string | null } = {},
): Promise<WriteResult> {
  if (!await brandEntityExists("venue", venueId)) return WRITE_NOT_FOUND;
  const supabase = createSupabaseAdmin();

  const { error: rpcErr } = await supabase.rpc(RPC_FOR[kind], { venue_id: venueId });
  throwIfDatabaseError(rpcErr, `recordVenueStat.${RPC_FOR[kind]}`);

  await logAnalyticsEvent(supabase, EVENT_FOR[kind], {
    entityType: "venue",
    entityId: venueId,
    meta: opts.platform ? { platform: opts.platform } : null,
  });

  return WRITE_OK;
}
