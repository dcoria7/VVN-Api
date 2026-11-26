import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { logAnalyticsEvents } from "@/lib/track-server";
import { throwIfDatabaseError } from "@/server/data/database-error";
import { WRITE_OK, WRITE_NOT_FOUND, type WriteResult } from "./types";

// Cuerpo compartido de /api/promotions/stats (web) y /api/v1/stats/promotions.

export type PromotionStatKind = "view" | "tap";

export function isPromotionStatKind(v: unknown): v is PromotionStatKind {
  return v === "view" || v === "tap";
}

/**
 * Tope de ids por petición.
 *
 * Era 24 y TRUNCABA EN SILENCIO (`valid.slice(0, 24)`): una pantalla con más
 * promos perdía las vistas de la cola sin que nadie se enterara. En la web una
 * ficha rara vez pasa de 12 (el tope del bot), pero la pestaña Cupones de la app
 * muestra la zona entera y lo rebasa con facilidad.
 *
 * Se sube a 100 y, sobre todo, el truncamiento DEJA DE SER SILENCIOSO: la respuesta
 * dice `recorded` / `received` / `rejected`, así que el cliente se entera y puede
 * mandar el resto. Un contrato que se degrada callado no se puede corregir.
 *
 * NO va a Sentry: es una condición que provoca el cliente, y un cliente mal escrito
 * (o malicioso) podría generar un evento por petición. Las condiciones del cliente
 * van a un contador o a un log; Sentry es para fallas del servidor.
 */
export const MAX_PROMOS_PER_REQUEST = 100;

/**
 * Registra vistas o taps de un lote de promociones: un solo INSERT de eventos más
 * un RPC por id en paralelo (son I/O; la espera no se cobra como Active CPU, pero
 * serializarlos sí alargaría la invocación).
 */
export async function recordPromotionStats(
  ids: string[],
  kind: PromotionStatKind,
  opts: { platform?: string | null; source?: string } = {},
): Promise<WriteResult> {
  const kept = ids.slice(0, MAX_PROMOS_PER_REQUEST);

  if (ids.length > kept.length) {
    console.warn(
      `[stats/promotions] lote truncado: ${ids.length} ids recibidos, ${kept.length} registrados`,
      { dropped: ids.length - kept.length, kind, source: opts.source ?? "unknown" },
    );
  }

  const supabase = createSupabaseAdmin();
  // Rechazar el lote completo antes de cualquier escritura si contiene IDs ajenos.
  const { data, error } = await supabase.from("promotions").select("id")
    .in("id", kept).eq("is_active", true);
  throwIfDatabaseError(error, "recordPromotionStats.promotions");
  const allowed = new Set((data ?? []).map((row) => row.id as string));
  if (kept.some((id) => !allowed.has(id))) return WRITE_NOT_FOUND;
  const meta = opts.platform ? { platform: opts.platform } : null;

  const rpcResults = await Promise.all(
    kept.map((id) =>
      supabase.rpc(kind === "view" ? "increment_promotion_views" : "increment_promotion_taps", {
        p_id: id,
      }),
    ),
  );

  // Un lote no es una transacción: emitir eventos solo de RPCs confirmados.
  await logAnalyticsEvents(
    supabase,
    kind === "view" ? "promo_view" : "promo_copy",
    kept.filter((_id, index) => !rpcResults[index].error)
      .map((id) => ({ entityType: "promotion", entityId: id, meta })),
  );

  const failed = rpcResults.find((r) => r.error);
  if (failed?.error) {
    throwIfDatabaseError(failed.error, `recordPromotionStats.${kind}`);
  }
  return WRITE_OK;
}
