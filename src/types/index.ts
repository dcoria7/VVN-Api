export type VenueType = "food" | "service" | "both" | "product";
export type VenueStatus = "open" | "closed";

/** Horario de un día: cerrado, o rango abre→cierra en "HH:mm" (24h, hora de
 *  Guadalajara). Si `close` <= `open` se interpreta que cruza la medianoche
 *  (ej. abre 18:00, cierra 02:00 del día siguiente). */
export interface DayHours {
  intervals?: {open:string;close:string}[];
  closed: boolean;
  open: string;
  close: string;
}

/** Horario semanal. Arreglo de 7 posiciones, índice 0=Lunes … 6=Domingo. */
export type OpeningHours = DayHours[];

export interface VenueLocation {
  lat: number;
  lng: number;
  reference: string;
  address: string | null;
  is_ambulatory: boolean;
  /** No publicar dirección ni mapa en la ficha (negocio a puerta cerrada). */
  is_closed_door: boolean;
}

export type VenueContactCta = "whatsapp" | "website";

export interface VenueContact {
  phone: string | null;
  bot_phone: string | null;
  instagram: string | null;
  /** Botón fijo inferior en la ficha pública */
  cta: VenueContactCta;
  /** URL cuando `cta === "website"` */
  website_url: string | null;
}

export interface VenueMedia {
  logo_url: string | null;
  cover_url: string | null;
}

export interface DailyUpdate {
  text: string | null;
  image_url: string | null;
  updated_at: string;
}

export interface VenueStats {
  views: number;
  whatsapp_taps: number;
  /** Toques al enlace/botón de página web (CTA web) */
  website_taps: number;
  /** Suma de estrellas recibidas (solo VVN). Mantenida por trigger desde venue_ratings. */
  rating_sum: number;
  /** Número de votos de calificación recibidos (solo VVN). */
  rating_count: number;
}

export interface Venue {
  /** Identidad interna; no se publica en el DTO móvil. */
  brand_id: string;
  id: string;
  name: string;
  type: VenueType;
  description: string;
  status: VenueStatus;
  status_updated_at: string;
  /** Horario de atención por día (hora de Guadalajara). NULL = sin horario:
   *  el estado se controla a mano (bot abierto/cerrado). Con horario, el estado
   *  abierto/cerrado se calcula automáticamente. Ver src/lib/venue-hours.ts. */
  opening_hours: OpeningHours | null;
  /** Override manual temporal del estado (bot) cuando hay horario. Vigente
   *  mientras `status_override_until` esté en el futuro. */
  status_override: VenueStatus | null;
  status_override_until: string | null;
  is_active: boolean;
  contact: VenueContact;
  location: VenueLocation;
  media: VenueMedia;
  daily_update: DailyUpdate | null;
  stats: VenueStats;
  tags: string[];
  /** Giro/categoría curada (cafetería, gimnasio…). NULL = sin clasificar. Lista en src/lib/venue-category.ts. */
  category: string | null;
  owner_id: string;
  telegram_chat_id: string | null;
  /** wa_id de Meta (solo dígitos, ej. 5215512345678) — bot de actualización de ficha */
  whatsapp_wa_id: string | null;
  /** Enlace al PDF del catálogo (p. ej. Google Drive). */
  catalog_pdf_url: string | null;
  /** Fecha de actualización del catálogo (YYYY-MM-DD), solo informativa en la ficha. */
  catalog_updated_on: string | null;

  // ── Vive Valle Norte (directorio por fraccionamiento/plaza) ──
  // NULL en todos los venues de ClickLocal general (geo). Ver [[vista-fraccionamiento-plazas]].
  /** Coto/fraccionamiento al que pertenece. NULL = ClickLocal general. */
  fraccionamiento_id: string | null;
  /** Plaza comercial. NULL = suelto del coto (Oxxo/farmacia) o ClickLocal general. */
  plaza_id: string | null;
  /** Número de local dentro de la plaza (solo display). */
  local_number: string | null;
  /** Piso/planta dentro de la plaza (solo display). */
  floor: string | null;
  /** Nota de ubicación dentro de la plaza (ej. "frente al food court"). */
  location_note: string | null;
  /** Ficha desbloqueada (quita el capado de local de plaza). */
  is_premium: boolean;
  /** Destacado (★) dentro de la plaza/giro. */
  is_featured: boolean;
  /** Vigencia de premium/destacado (facturación manual). */
  paid_until: string | null;
  /** Despriorizado en listados VVN: se ordena al final (cadenas 24h como Oxxo). */
  is_deprioritized: boolean;

  created_at: string;
  updated_at: string;
}

export interface VenuePhoto {
  id: string;
  venue_id: string;
  url: string;
  order: number;
  created_at: string;
}

export interface MenuItem {
  id: string;
  venue_id: string;
  name: string;
  description: string | null;
  price: number | null;
  image_url: string | null;
  category: string;
  is_available: boolean;
  order: number;
  created_at: string;
}

export interface Service {
  id: string;
  venue_id: string;
  name: string;
  description: string | null;
  price: number | null;
  duration: number | null;
  image_url: string | null;
  is_available: boolean;
  order: number;
  created_at: string;
}

export interface Owner {
  id: string;
  display_name: string;
  email: string;
  phone: string;
  venue_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface VenueWithDistance extends Venue {
  distance_km: number;
}

// ── Vive Valle Norte: directorio por fraccionamiento/plaza ──────────────────
// Vive dentro de la misma app/DB que ClickLocal. Ver [[vista-fraccionamiento-plazas]].
export interface Fraccionamiento {
  id: string;
  name: string;
  slug: string;
  /** Encuadre del mapa al elegir el fraccionamiento con el picker. */
  center_lat: number | null;
  center_lng: number | null;
  default_zoom: number | null;
  created_at: string;
}

export interface Plaza {
  id: string;
  fraccionamiento_id: string;
  name: string;
  slug: string;
  zona: string | null;
  /** Pin de la plaza; default de las coords de sus locales. */
  lat: number | null;
  lng: number | null;
  /** Imagen de portada de la plaza. */
  cover_url: string | null;
  /** Descripción/nota de la plaza. */
  description: string | null;
  /** Amenidades de la plaza (estacionamiento, rampa, 2 pisos…). */
  amenities: string[];
  created_at: string;
}

export interface Parque {
  id: string;
  fraccionamiento_id: string;
  name: string;
  slug: string;
  description: string | null;
  lat: number | null;
  lng: number | null;
  cover_url: string | null;
  photos: string[];
  amenities: string[];
  created_at: string;
}

// ── ClickLocal Ocasión (anuncios temporales, curados por admin) ────────────
// Sin categorías de alto riesgo de fraude (p. ej. boletos de eventos) a propósito.
export type OcasionCategory = "moda" | "tecnologia" | "hogar" | "deportes" | "otro";
export type OcasionListingStatus = "active" | "sold";
/** Estado calculado en cliente: `expired` no existe en DB, se deriva de `expires_at`. */
export type OcasionDisplayStatus = OcasionListingStatus | "expired";

export interface OcasionListing {
  id: string;
  title: string;
  description: string;
  price: number | null;
  image_url: string | null;
  category: OcasionCategory;
  status: OcasionListingStatus;
  whatsapp_phone: string;
  is_active: boolean;
  expires_at: string;
  sold_at: string | null;
  /** Vistas de detalle (abrir el overlay del anuncio). */
  views: number;
  /** Taps al botón "Escribir por WhatsApp" del anuncio. */
  whatsapp_taps: number;
  created_at: string;
  updated_at: string;
}

// ── Promociones / cupones por negocio ─────────────────────────────────────
// `promo` = oferta informativa; `coupon` = canjeable (trae code). Vigencia por
// ends_at; al vencer se ocultan sin borrarse. Ver src/services/promotions.ts.
export type PromotionKind = "promo" | "coupon";

export interface Promotion {
  id: string;
  venue_id: string;
  kind: PromotionKind;
  title: string;
  description: string | null;
  /** Badge de descuento (display): "2x1", "20% OFF", "-$50". */
  discount_label: string | null;
  /** Código de canje (solo coupon). NULL en promo. */
  code: string | null;
  image_url: string | null;
  /** Condiciones / letra chica. */
  terms: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  views: number;
  taps: number;
  created_at: string;
  updated_at: string;
}

// ── Publicidad de sitios/apps recomendados (curado por admin) ─────────────
export type BlogCategory = "evento" | "anuncio" | "noticia" | "guia";

/** Post del blog de zona "Vive Valle Norte" (eventos, anuncios, noticias). */
export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  cover_url: string | null;
  category: BlogCategory;
  /** Fecha de publicación editorial (ISO). Solo se muestra si es <= ahora. */
  published_at: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecommendedAd {
  id: string;
  name: string;
  description: string;
  url: string;
  logo_url: string | null;
  is_active: boolean;
  /** Toques al anuncio ("visitar" el enlace). */
  taps: number;
  created_at: string;
  updated_at: string;
}

/** Aviso "de la casa" de Vive Valle Norte (tarjeta estática del feed, no tappable). */
export interface VvnAnnouncement {
  id: string;
  /** Firma del aviso (p. ej. la marca). */
  title: string;
  /** Mensaje del aviso (columna DB `body`). */
  text: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
