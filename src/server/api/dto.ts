import "server-only";
import { deploymentBrandId } from "@/lib/deployment-brand";
import { isVenuePro } from "@/lib/venue-pro";
import type { Venue } from "@/types";

// ─────────────────────────────────────────────────────────────────────────────
// Forma de los datos de /api/v1/*.
//
// Los JSON ESPEJEAN los tipos de `src/types/index.ts` (objetos anidados:
// `contact.phone`, `location.lat`, `daily_update.text`), no las filas planas de
// Postgres, para que el cliente móvil deserialice sin capa de traducción.
//
// Lo único que se agrega son dos campos que el servidor calcula porque el cliente
// no puede hacerlo barato o porque cambiarlos no debe exigir publicar una app:
// `is_pro` (regla de capado, ver src/lib/venue-pro.ts) y `has_promo`.
//
// Lo que a propósito NO se calcula aquí: el estado abierto/cerrado. Con 300 s de
// caché llegaría viejo y contradiría al reloj del teléfono, así que viajan los
// datos crudos (`status`, `opening_hours`, `status_override`,
// `status_override_until`) y la app recalcula. Ver src/lib/venue-hours.ts.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Forma pública de un negocio: LISTA BLANCA explícita de campos.
 *
 * Es una lista blanca y no un `Omit` a propósito. Cuatro columnas de `Venue` no
 * deben salir nunca por una API pública:
 *
 *  - `contact.bot_phone`, `telegram_chat_id`, `whatsapp_wa_id`: son los
 *    identificadores con los que el DUEÑO edita su ficha por el bot — su teléfono
 *    personal y su chat id. No son datos de negocio y no los pinta ninguna
 *    pantalla; publicarlos en un JSON paginable sería regalar un directorio
 *    enumerable de teléfonos de dueños.
 *  - `owner_id` y `paid_until`: estado interno (identidad del dueño, vigencia de
 *    facturación). Lo que la app necesita para decidir qué pinta es `is_pro`.
 *
 * Con lista blanca, una columna nueva en `venues` entra al JSON solo si alguien la
 * agrega aquí a mano. Con `Omit` entraría sola, y una columna interna futura se
 * publicaría sin que nadie lo note — el modo de fallo caro.
 *
 * (La web ya manda esos campos en el payload RSC de la ficha, porque `VenueDetail`
 * recibe el venue completo aunque no los renderice. Eso es deuda aparte; lo que no
 * se hace aquí es abrirles una segunda puerta, esta vez legible por máquina.)
 */
export type ApiVenue = {
  id: string;
  name: string;
  type: Venue["type"];
  description: string;
  category: string | null;
  tags: string[];
  is_active: boolean;

  // Estado: CRUDO a propósito. La app recalcula abierto/cerrado con el reloj del
  // teléfono; ver el comentario de cabecera de este archivo.
  status: Venue["status"];
  status_updated_at: string;
  opening_hours: Venue["opening_hours"];
  status_override: Venue["status"] | null;
  status_override_until: string | null;

  contact: Omit<Venue["contact"], "bot_phone">;
  location: Venue["location"];
  media: Venue["media"];
  daily_update: Venue["daily_update"];
  stats: Venue["stats"];

  catalog_pdf_url: string | null;
  catalog_updated_on: string | null;

  // Vive Valle Norte
  fraccionamiento_id: string | null;
  plaza_id: string | null;
  local_number: string | null;
  floor: string | null;
  location_note: string | null;
  is_premium: boolean;
  is_featured: boolean;
  is_deprioritized: boolean;

  created_at: string;
  updated_at: string;

  /** Ficha desbloqueada. Regla canónica en src/lib/venue-pro.ts. */
  is_pro: boolean;
  /** Tiene al menos una oferta/cupón vigente (badge "Oferta"). */
  has_promo: boolean;
};

/**
 * LA PARED, aplicada en el servidor y en un solo lugar.
 *
 * Esta API es exclusivamente de Vive Valle Norte: un negocio de ClickLocal general
 * (`fraccionamiento_id` null) nunca debe salir por aquí. También se comprueba el
 * UUID de marca: otros directorios pueden tener fraccionamientos propios.
 * Esto es el cinturón de seguridad: si alguien cablea un
 * endpoint nuevo a una query sin filtro, el venue se cae aquí y no en producción.
 */
export function isVvnVenue(venue: Venue): boolean {
  return venue.brand_id === deploymentBrandId && venue.fraccionamiento_id != null;
}

export function toApiVenue(venue: Venue, promoVenueIds?: ReadonlySet<string>): ApiVenue {
  return {
    id: venue.id,
    name: venue.name,
    type: venue.type,
    description: venue.description,
    category: venue.category,
    tags: venue.tags,
    is_active: venue.is_active,

    status: venue.status,
    status_updated_at: venue.status_updated_at,
    opening_hours: venue.opening_hours,
    status_override: venue.status_override,
    status_override_until: venue.status_override_until,

    contact: {
      phone: venue.contact.phone,
      instagram: venue.contact.instagram,
      cta: venue.contact.cta,
      website_url: venue.contact.website_url,
    },
    location: venue.location,
    media: venue.media,
    daily_update: venue.daily_update,
    stats: venue.stats,

    catalog_pdf_url: venue.catalog_pdf_url,
    catalog_updated_on: venue.catalog_updated_on,

    fraccionamiento_id: venue.fraccionamiento_id,
    plaza_id: venue.plaza_id,
    local_number: venue.local_number,
    floor: venue.floor,
    location_note: venue.location_note,
    is_premium: venue.is_premium,
    is_featured: venue.is_featured,
    is_deprioritized: venue.is_deprioritized,

    created_at: venue.created_at,
    updated_at: venue.updated_at,

    is_pro: isVenuePro(venue),
    has_promo: promoVenueIds ? promoVenueIds.has(venue.id) : false,
  };
}

/** Proyecta una lista aplicando la pared. Lo que no es VVN se descarta en silencio. */
export function toApiVenues(
  venues: Venue[],
  promoVenueIds?: ReadonlySet<string>,
): ApiVenue[] {
  return venues.filter(isVvnVenue).map((v) => toApiVenue(v, promoVenueIds));
}

// ── Paginación ──────────────────────────────────────────────────────────────
// `?limit=` (default 50, máx 100) y `?cursor=` opaco.
//
// El cursor es un desplazamiento dentro de la lista YA ordenada por el servicio
// correspondiente, no una clave de keyset. Es deliberado: las listas paginadas
// (feed del día, blog, cupones) vienen de servicios existentes que ya traen el
// conjunto ordenado y acotado (tope duro de 200 en el feed), y agrupar cupones por
// negocio se hace en memoria de todas formas. Reusar esos servicios en vez de
// escribir queries nuevas mantiene una sola definición de "qué se muestra", y con
// 5 min de CDN encima cada página se sirve sin invocar la función.
//
// Consecuencia honesta: si la lista cambia entre dos páginas, un elemento puede
// repetirse o saltarse. Para contenido que se consume de arriba hacia abajo y
// cambia pocas veces al día, es aceptable.

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export function parseCursor(raw: string | null): number {
  if (!raw) return 0;
  try {
    const n = Number(Buffer.from(raw, "base64url").toString("utf8"));
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

export type Page<T> = {
  items: T[];
  /** Cursor de la página siguiente, o null si esta es la última. */
  next_cursor: string | null;
  /** Total disponible en la lista completa (ya acotada por el servicio). */
  total: number;
};

export function paginate<T>(all: T[], limit: number, offset: number): Page<T> {
  const items = all.slice(offset, offset + limit);
  const end = offset + items.length;
  return {
    items,
    next_cursor: end < all.length ? encodeCursor(end) : null,
    total: all.length,
  };
}

// ── Validación de parámetros ────────────────────────────────────────────────

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidParam(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Slug de URL: minúsculas, dígitos y guiones. Freno de entrada antes de tocar la DB. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

/**
 * ¿Tiene forma de slug? Acepta mayúsculas (las normaliza `normalizeSlugParam`),
 * porque un cliente que mande `CAPITAL-NORTE` merece la misma respuesta que uno
 * que mande `capital-norte`, no un 400.
 */
export function isSlugParam(value: unknown): value is string {
  return typeof value === "string" && SLUG_RE.test(value.toLowerCase());
}

/** El slug listo para consultar: minúsculas y sin espacios alrededor. */
export function normalizeSlugParam(value: string): string {
  return value.trim().toLowerCase();
}
