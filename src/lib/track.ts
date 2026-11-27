// Tracking de interacciones (client-safe). El registro va por /api/track (service
// role), fire-and-forget. La lista de eventos también la usa el API route para
// validar. NO importar "server-only" aquí: lo usan Client Components.

export const TRACK_EVENTS = [
  // CTAs nuevos (se registran desde el cliente vía /api/track)
  "directions", // CTA "Cómo llegar" en el mapa de la ficha
  "promo_share", // compartir oferta / cupón
  "promo_copy", // copiar código de cupón
  "instagram_tap", // tap a Instagram
  "photos_open", // abrir una foto de la galería
  "catalog_open", // abrir catálogo PDF
  "claim_business", // "Reclama este negocio"
  "plaza_rent", // "¿Quieres rentar en esta plaza?"
  "report_info", // "¿Información incorrecta? Repórtala"
  "segment_select", // segmented control de fraccionamiento
  "search", // buscador por palabras
  "search_no_results", // búsqueda sin resultados (demanda no atendida, meta.q)
  "menu_option", // opción del menú de secciones (VVN)
  "load_more", // botón "Cargar más" del grid de fraccionamiento (meta.group: open|closed)
  "rating_submit", // calificación de un negocio con estrellas (meta.stars: 1-5), solo VVN
  // Eventos exclusivos de las apps nativas (iOS/Android). Llegan por
  // /api/v1/track con meta.platform. No tienen contraparte en la web.
  "featured_impression", // card editorial visible (meta.placement_id)
  "featured_open", // apertura desde destacados, adicional a venue_view
  "sponsored_impression", // campaña visible (meta.campaign_id)
  "sponsored_click", // tap al destino de la campaña
  "app_open", // arranque de la app
  "push_received", // notificación recibida con la app en primer plano
  "push_open", // la notificación se abrió
  "coupon_save", // el usuario guardó un cupón en la app
  "tab_select", // cambio de pestaña (meta.tab)
  "notif_optin", // el usuario concedió permiso de notificaciones
  // Interacciones que ya se contaban por columna: además se loguean como evento
  // (dual-write server-side en las stats routes existentes) para unificar todo.
  "venue_view",
  "venue_whatsapp",
  "venue_website",
  "plaza_view",
  "parque_view",
  "promo_view",
  "ocasion_view",
  "ocasion_whatsapp",
  "ad_tap",
] as const;

export type TrackEvent = (typeof TRACK_EVENTS)[number];

/**
 * Eventos que SOLO escribe el servidor, dentro del dual-write de las stats routes.
 *
 * Cada uno tiene una contraparte en columna (`venues.views`, `promotions.taps`…)
 * que se incrementa en la misma operación que registra el evento. Si además se
 * pudieran emitir por `/track`, cada interacción contaría DOS veces — que es
 * exactamente lo que pasó con `rating_submit` en octubre (bitácora 2026-10-12).
 *
 * Las rutas de track (web y móvil) los rechazan con `invalid_event`.
 */
export const SERVER_ONLY_TRACK_EVENTS = [
  "venue_view",
  "venue_whatsapp",
  "venue_website",
  "plaza_view",
  "parque_view",
  "promo_view",
  "promo_copy",
  "rating_submit",
  "ocasion_view",
  "ocasion_whatsapp",
  "ad_tap",
] as const satisfies readonly TrackEvent[];

export type ServerOnlyTrackEvent = (typeof SERVER_ONLY_TRACK_EVENTS)[number];

/** Plataforma de origen del evento (va en `meta.platform`). */
export type TrackPlatform = "ios" | "android" | "web";

export const TRACK_PLATFORMS: readonly TrackPlatform[] = ["ios", "android", "web"];

export function isTrackPlatform(v: unknown): v is TrackPlatform {
  return typeof v === "string" && (TRACK_PLATFORMS as readonly string[]).includes(v);
}

export type TrackOptions = {
  entityType?: string;
  entityId?: string;
  fraccionamientoId?: string;
  meta?: Record<string, unknown>;
};

/** Registra un evento de interacción (best-effort, no bloquea la UI). */
export function trackEvent(event: TrackEvent, opts: TrackOptions = {}): void {
  try {
    void fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, ...opts }),
      keepalive: true,
    }).catch(() => {
      /* métrica best-effort: ignorar errores */
    });
  } catch {
    /* ignore */
  }
}
