import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrackEvent } from "@/lib/track";
import { DatabaseOperationError } from "@/server/data/database-error";
import { reportError } from "@/lib/report-error";

type LogOpts = {
  entityType?: string | null;
  entityId?: string | null;
  fraccionamientoId?: string | null;
  meta?: Record<string, unknown> | null;
};

/**
 * Inserta un evento en analytics_events (best-effort). Se usa desde las stats
 * routes existentes para "dual-write": además de incrementar el contador de la
 * tabla, se registra el evento para el dashboard unificado. Nunca lanza.
 */
export async function logAnalyticsEvent(
  supabase: SupabaseClient,
  event: TrackEvent,
  opts: LogOpts = {}
): Promise<void> {
  await logAnalyticsEvents(supabase, event, [opts]);
}

/**
 * Variante en lote: un solo INSERT para varias entidades del mismo evento (p. ej.
 * todas las promos visibles de una ficha). Igual de best-effort que la de arriba.
 *
 * Existe para que la forma de la fila viva en UN solo lugar. La ruta de promos
 * hacía su propio `insert` inline para poder mandar el lote, y mantener dos copias
 * de esa forma es exactamente lo que produjo el doble conteo de `rating_submit`
 * (ver bitácora 2026-10-12): si alguien agrega una columna aquí, el otro camino se
 * queda atrás en silencio.
 */
export async function logAnalyticsEvents(
  supabase: SupabaseClient,
  event: TrackEvent,
  rows: LogOpts[]
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const { error } = await supabase.from("analytics_events").insert(
      rows.map((opts) => ({
        event_type: event,
        entity_type: opts.entityType ?? null,
        entity_id: opts.entityId ?? null,
        fraccionamiento_id: opts.fraccionamientoId ?? null,
        meta: opts.meta ?? null,
      }))
    );
    if (error) throw new DatabaseOperationError("logAnalyticsEvents", error);
  } catch (error) {
    // El contador/voto principal ya pudo guardarse. Registrar el fallo sin
    // afirmar al cliente que se perdió la escritura ni inducir su repetición.
    reportError(error, { operation: "logAnalyticsEvents", event });
  }
}
