import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { logAnalyticsEvent } from "@/lib/track-server";
import { DatabaseOperationError, throwIfDatabaseError } from "@/server/data/database-error";
import { reportError } from "@/lib/report-error";
import { VISITOR_HEADER, getOrCreateVisitorId, hashKey, localDayKey } from "@/lib/visitor-id";

// Cuerpo compartido de /api/venues/rating (web) y /api/v1/ratings (apps).
//
// Calificaciones: solo Vive Valle Norte, anónimas, un voto por visitante por
// negocio (corregible por upsert). Tres frenos superpuestos, ninguno se relaja
// para las apps: limitador por IP (rating-submit, 5/min, lo aplica la ruta),
// dedupe por visitante y tope de votos NUEVOS por IP y día.

/** Tope de votos por IP y día: freno de inflado, no de uso normal. */
export const MAX_VOTES_PER_IP_PER_DAY = 10;

export type RatingRead = { sum: number; count: number; mine: number | null };

export type RatingSubmit =
  | { ok: true; sum: number | null; count: number | null; mine: number }
  | { ok: false; reason: "not_found" | "not_rateable" | "daily_limit" | "server_error" };

/**
 * Clave de visitante (hash con salt).
 *
 * `acceptHeader` decide si se mira `X-Visitor-Id`. Solo la API móvil lo activa: un
 * navegador siempre manda su cookie httpOnly, así que aceptar la cabecera en la
 * superficie web no agregaría nada y sí abriría una lectura — un `GET` con el
 * `X-Visitor-Id` de otra persona devolvería SU voto (`mine`). No es adivinable,
 * pero no hace falta correr el riesgo donde no aporta.
 */
export async function visitorKeyFrom(
  req: Request,
  { acceptHeader = false }: { acceptHeader?: boolean } = {},
): Promise<string> {
  const header = acceptHeader ? req.headers.get(VISITOR_HEADER) : null;
  return hashKey([await getOrCreateVisitorId(header)]);
}

/**
 * Estado de calificación de un negocio PARA ESTE VISITANTE.
 *
 * Depende del visitante, así que la respuesta NUNCA puede cachearse en el CDN
 * (`private, no-store`): servirla compartida sería enseñarle a todos el voto de
 * uno. Existe porque las páginas son ISR: el HTML trae un promedio que puede ser
 * viejo y nunca trae el voto propio.
 */
export async function readRating(venueId: string, visitorKey: string): Promise<RatingRead | null> {
  const supabase = createSupabaseAdmin();
  const { data: venue, error: venueError } = await supabase.from("venues")
    .select("rating_sum, rating_count").eq("id", venueId).eq("is_active", true)
    .not("fraccionamiento_id", "is", null).maybeSingle();
  throwIfDatabaseError(venueError, "readRating.venue");
  if (!venue) return null;
  const { data: mine, error: mineError } = await supabase
      .from("venue_ratings")
      .select("stars")
      .eq("venue_id", venueId)
      .eq("visitor_key", visitorKey)
      .maybeSingle();
  throwIfDatabaseError(mineError, "readRating.visitor");

  return {
    sum: Number(venue?.rating_sum) || 0,
    count: Number(venue?.rating_count) || 0,
    mine: mine ? Number(mine.stars) || null : null,
  };
}

/**
 * Registra (o corrige) la calificación del visitante.
 *
 * El upsert sobre (venue_id, visitor_key) permite cambiar de opinión sin inflar el
 * conteo, y por eso corregir un voto propio no consume cupo del tope por IP.
 *
 * El evento `rating_submit` se escribe AQUÍ, en el servidor, y solo cuando la
 * escritura ya tuvo éxito. No se emite nunca desde el cliente: esa duplicidad fue
 * el doble conteo de octubre (ver bitácora 2026-10-12).
 */
export async function submitRating(args: {
  venueId: string;
  stars: number;
  visitorKey: string;
  ip: string;
  platform?: string | null;
}): Promise<RatingSubmit> {
  const { venueId, stars, visitorKey, ip } = args;
  const supabase = createSupabaseAdmin();

  // Pared "solo VVN": las calificaciones no existen en ClickLocal general.
  const { data: venue, error: venueErr } = await supabase
    .from("venues")
    .select("id, is_active, fraccionamiento_id")
    .eq("id", venueId)
    .maybeSingle();
  throwIfDatabaseError(venueErr, "submitRating.venue");
  if (!venue || !venue.is_active) return { ok: false, reason: "not_found" };
  if (!venue.fraccionamiento_id) return { ok: false, reason: "not_rateable" };

  const ipDayKey = hashKey([ip, localDayKey()]);

  const { data: existing, error: existingError } = await supabase
    .from("venue_ratings")
    .select("id")
    .eq("venue_id", venueId)
    .eq("visitor_key", visitorKey)
    .maybeSingle();
  throwIfDatabaseError(existingError, "submitRating.existing");

  if (!existing) {
    const { count: todayCount, error: countError } = await supabase
      .from("venue_ratings")
      .select("id", { count: "exact", head: true })
      .eq("ip_day_key", ipDayKey);
    throwIfDatabaseError(countError, "submitRating.dailyCount");
    if (todayCount === null) throw new DatabaseOperationError("submitRating.dailyCount", new Error("No llegó el conteo exacto."));
    if (todayCount >= MAX_VOTES_PER_IP_PER_DAY) {
      return { ok: false, reason: "daily_limit" };
    }
  }

  const { error: upErr } = await supabase.from("venue_ratings").upsert(
    {
      venue_id: venueId,
      stars,
      visitor_key: visitorKey,
      ip_day_key: ipDayKey,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "venue_id,visitor_key" },
  );
  throwIfDatabaseError(upErr, "submitRating.upsert");

  await logAnalyticsEvent(supabase, "rating_submit", {
    entityType: "venue",
    entityId: venueId,
    fraccionamientoId: venue.fraccionamiento_id as string,
    meta: args.platform ? { stars, platform: args.platform } : { stars },
  });

  // El trigger ya actualizó los contadores: se releen para que la UI no adivine
  // el promedio nuevo. Si esa lectura falla, el voto YA está guardado: se responde
  // ok sin contadores y el cliente conserva los que tenía, en vez de decirle al
  // usuario que se perdió.
  const { data: updated, error: readErr } = await supabase
    .from("venues")
    .select("rating_sum, rating_count")
    .eq("id", venueId)
    .maybeSingle();
  const readable = !readErr && updated != null;
  if (!readable) {
    reportError(new DatabaseOperationError("submitRating.savedVoteCounters", readErr ?? new Error("No llegó el negocio actualizado.")), { vote_saved: true });
  }

  return {
    ok: true,
    sum: readable ? Number(updated.rating_sum) || 0 : null,
    count: readable ? Number(updated.rating_count) || 0 : null,
    mine: stars,
  };
}
