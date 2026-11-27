import "server-only";
import { discoverTrackingKey, validDiscoverTracking } from "./discover-tracking";
import { brandEntityExists, isBrandEntityType } from "@/server/data/brand-entities";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import {
  SERVER_ONLY_TRACK_EVENTS,
  TRACK_EVENTS,
  isTrackPlatform,
  type TrackEvent,
  type TrackPlatform,
} from "@/lib/track";
import { UUID_RE } from "@/server/api/dto";

// Cuerpo compartido de /api/track (web) y /api/v1/track (apps).
//
// Toda la validación vive aquí para que las dos superficies acepten y rechacen
// exactamente lo mismo. Los tests de guardas (src/app/api/track/route.test.ts)
// ejercitan esta lógica a través de la ruta web.

const EVENT_SET = new Set<string>(TRACK_EVENTS);
const SERVER_ONLY_SET = new Set<string>(SERVER_ONLY_TRACK_EVENTS);

/** Cotas de `meta`: objeto plano y chico. 8 claves de 40 chars, valores de 120. */
const MAX_META_KEYS = 8;
const MAX_META_KEY_LEN = 40;
const MAX_META_VALUE_LEN = 120;

export type TrackResult =
  | { ok: true }
  | { ok: false; reason: "invalid_body" | "invalid_event" | "invalid" | "server_error" };

/**
 * `analytics_events.fraccionamiento_id` tiene FK a `fraccionamientos`. Validar que
 * sea un UUID bien formado no basta: un UUID inventado pasa la regex y revienta en
 * el INSERT. Sin esto, un cliente puede provocar un 500 (y un evento de Sentry) con
 * cada petición. 23503 = foreign_key_violation.
 */
const FK_VIOLATION = "23503";

function sanitizeMeta(raw: unknown, platform: TrackPlatform | null): Record<string, unknown> | null {
  let meta: Record<string, unknown> | null = null;

  // `platform` entra DENTRO del presupuesto de 8 claves, no encima: el tope es
  // del tamaño de la fila, y dejarlo fuera lo convertiría en 9 en silencio.
  const clientBudget = MAX_META_KEYS - (platform ? 1 : 0);

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    meta = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, clientBudget)) {
      meta[k.slice(0, MAX_META_KEY_LEN)] =
        typeof v === "string" ? v.slice(0, MAX_META_VALUE_LEN) : v;
    }
  }

  // La plataforma la fija el servidor a partir del campo de nivel superior, no de
  // lo que venga dentro de `meta`: así un cliente no puede hacerse pasar por otro.
  if (platform) {
    meta = { ...(meta ?? {}), platform };
  }
  return meta;
}

/**
 * Registra un evento de interacción en `analytics_events`.
 *
 * Rechaza lo que no esté en la whitelist y, explícitamente, los eventos que solo
 * escribe el servidor (ver `SERVER_ONLY_TRACK_EVENTS`): admitirlos aquí haría que
 * cada vista o tap contara dos veces.
 */
export async function recordTrackEvent(
  body: unknown,
  opts: { platform?: TrackPlatform | null } = {},
): Promise<TrackResult> {
  // Body malformado = error del cliente, no del servidor.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "invalid_body" };
  }
  const b = body as Record<string, unknown>;

  const event = typeof b.event === "string" ? b.event : null;
  if (!event || !EVENT_SET.has(event) || SERVER_ONLY_SET.has(event)) {
    return { ok: false, reason: "invalid_event" };
  }

  const entityId =
    typeof b.entityId === "string" && UUID_RE.test(b.entityId) ? b.entityId : null;
  const fraccId =
    typeof b.fraccionamientoId === "string" && UUID_RE.test(b.fraccionamientoId)
      ? b.fraccionamientoId
      : null;
  const entityType = typeof b.entityType === "string" ? b.entityType.slice(0, 40) : null;

  if (b.entityId != null && (!entityId || !isBrandEntityType(entityType))) return { ok: false, reason: "invalid" };
  if (b.fraccionamientoId != null && !fraccId) return { ok: false, reason: "invalid" };
  if (entityId && isBrandEntityType(entityType) && !await brandEntityExists(entityType, entityId)) {
    return { ok: false, reason: "invalid" };
  }
  if (fraccId && !await brandEntityExists("fraccionamiento", fraccId)) return { ok: false, reason: "invalid" };

  if (!await validDiscoverTracking(event, entityType, entityId, b.meta)) return { ok: false, reason: "invalid" };

  const platform =
    opts.platform ?? (isTrackPlatform(b.platform) ? (b.platform as TrackPlatform) : null);

  const attributionKey = discoverTrackingKey(event);
  // La clave validada debe sobrevivir al presupuesto de meta, aunque el cliente
  // haya enviado primero campos adicionales.
  const rawMeta = attributionKey ? { [attributionKey]: (b.meta as Record<string, unknown>)[attributionKey], ...(b.meta as Record<string, unknown>) } : b.meta;
  const { error } = await createSupabaseAdmin()
    .from("analytics_events")
    .insert({
      event_type: event as TrackEvent,
      entity_type: entityType,
      entity_id: entityId,
      fraccionamiento_id: fraccId,
      meta: sanitizeMeta(rawMeta, platform),
    });

  if (error) {
    if ([FK_VIOLATION, "23514", "42501", "22023"].includes(error.code)) {
      // Referencia inexistente: culpa del cliente. 400, sin ruido en Sentry.
      console.warn("[track] fraccionamiento_id inexistente");
      return { ok: false, reason: "invalid" };
    }
    console.error("[track]", error.message);
    return { ok: false, reason: "server_error" };
  }
  return { ok: true };
}
