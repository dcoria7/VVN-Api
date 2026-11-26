import { throwIfDatabaseError } from "@/server/data/database-error";
import { supabase } from "@/lib/supabase";
import { Venue, MenuItem, Service, VenueWithDistance } from "@/types";
import { isDailyUpdateFresh, dailyUpdateCutoffISO } from "@/lib/daily-update-fresh";
import { parseOpeningHours } from "@/lib/venue-hours";
import { isVenuePro } from "@/lib/venue-pro";

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function rowToVenue(row: Record<string, unknown>): Venue {
  return {
    brand_id: row.brand_id as string,
    id: row.id as string,
    name: row.name as string,
    type: row.type as Venue["type"],
    description: row.description as string,
    status: row.status as Venue["status"],
    status_updated_at: row.status_updated_at as string,
    opening_hours: parseOpeningHours(row.opening_hours),
    status_override: (row.status_override as Venue["status"] | null) ?? null,
    status_override_until: (row.status_override_until as string | null) ?? null,
    is_active: row.is_active as boolean,
    tags: (row.tags as string[]) ?? [],
    category: (row.category as string | null) ?? null,
    owner_id: row.owner_id as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    contact: {
      phone: (row.phone as string | null) ?? null,
      bot_phone: (row.bot_phone as string | null) ?? null,
      instagram: row.instagram as string | null,
      cta: (row.contact_cta as Venue["contact"]["cta"]) === "website" ? "website" : "whatsapp",
      website_url: (row.website_url as string | null) ?? null,
    },
    location: {
      lat: row.lat as number,
      lng: row.lng as number,
      reference: row.location_reference as string,
      address: row.address as string | null,
      is_ambulatory: row.is_ambulatory as boolean,
      is_closed_door: Boolean(row.is_closed_door),
    },
    media: {
      logo_url: row.logo_url as string | null,
      cover_url: row.cover_url as string | null,
    },
    daily_update:
      (row.daily_text || row.daily_image_url) &&
      isDailyUpdateFresh(row.daily_updated_at as string | null)
        ? {
            text: row.daily_text as string | null,
            image_url: row.daily_image_url as string | null,
            updated_at: row.daily_updated_at as string,
          }
        : null,
    stats: {
      views: row.views as number,
      whatsapp_taps: row.whatsapp_taps as number,
      website_taps: Number(row.website_taps) || 0,
      rating_sum: Number(row.rating_sum) || 0,
      rating_count: Number(row.rating_count) || 0,
    },
    telegram_chat_id: (row.telegram_chat_id as string | null) ?? null,
    whatsapp_wa_id: (row.whatsapp_wa_id as string | null) ?? null,
    catalog_pdf_url: (row.catalog_pdf_url as string | null)?.trim() || null,
    catalog_updated_on: row.catalog_updated_on
      ? String(row.catalog_updated_on).slice(0, 10)
      : null,
    fraccionamiento_id: (row.fraccionamiento_id as string | null) ?? null,
    plaza_id: (row.plaza_id as string | null) ?? null,
    local_number: (row.local_number as string | null) ?? null,
    floor: (row.floor as string | null) ?? null,
    location_note: (row.location_note as string | null) ?? null,
    is_premium: Boolean(row.is_premium),
    is_featured: Boolean(row.is_featured),
    paid_until: (row.paid_until as string | null) ?? null,
    is_deprioritized: Boolean(row.is_deprioritized),
  };
}

/**
 * Política central de capado de ficha (Vive Valle Norte): el complemento de
 * `isVenuePro`.
 *
 * Antes tenía su propia regla (`plaza_id != null && !is_premium`), que NO coincidía
 * con la que `VenueDetail` aplicaba de verdad en producción. Esa divergencia es la
 * que había que cerrar al abrir la API móvil, porque `is_pro` tenía que describir
 * lo que el visitante ve y no una variante. Ahora delega: una sola regla,
 * un solo lugar donde cambiarla (src/lib/venue-pro.ts).
 * Ver [[vista-fraccionamiento-plazas]].
 */
export function isFichaLocked(venue: Venue): boolean {
  return !isVenuePro(venue);
}

export async function getActiveVenues(): Promise<Venue[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("is_active", true)
    // Pared Vive Valle Norte: los venues de fraccionamiento NO aparecen en
    // ClickLocal general. La vista de coto usará su propia query filtrando por
    // fraccionamiento_id. Ver [[vista-fraccionamiento-plazas]].
    .is("fraccionamiento_id", null)
    .order("status", { ascending: false }) // open first
    .order("views", { ascending: false })  // most-visited first
    .order("name") // stable tiebreaker
    // Tope de seguridad: el feed se descarga al navegador y se filtra por
    // distancia en cliente. 200 es holgado para el catálogo actual (sin efecto
    // hoy); evita que una futura explosión de venues baje una lista gigante.
    // Cuando se acerque a este número, migrar a prefiltro geográfico en DB.
    .limit(200);

  throwIfDatabaseError(error, "getActiveVenues");
  return (data ?? []).map(rowToVenue);
}

export async function getVenuesSortedByDistance(
  userLat: number,
  userLon: number,
  radiusKm = 20
): Promise<VenueWithDistance[]> {
  const venues = await getActiveVenues();
  return venues
    .map((v) => ({
      ...v,
      distance_km: haversineKm(userLat, userLon, v.location.lat, v.location.lng),
    }))
    .filter((v) => v.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km);
}

// ── Vive Valle Norte: queries del vertical (cruzan la pared a propósito) ─────
// Estas NO usan la pared `fraccionamiento_id IS NULL`; filtran por coto/plaza.

/** Todos los venues activos de un fraccionamiento (sueltos + locales de plaza). */
export async function getVenuesByFraccionamiento(fraccionamientoId: string): Promise<Venue[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("is_active", true)
    .eq("fraccionamiento_id", fraccionamientoId)
    .order("is_deprioritized", { ascending: true }) // despriorizados (Oxxo 24h) al final
    .order("is_featured", { ascending: false }) // destacados primero
    .order("status", { ascending: false }) // abiertos primero
    .order("name")
    .limit(200); // tope de seguridad, igual que el feed VVN y getActiveVenues
  throwIfDatabaseError(error, "getVenuesByFraccionamiento");
  return (data ?? []).map(rowToVenue);
}

/** Venues de toda la zona VVN (cualquier fraccionamiento) con post del día,
 *  ordenados por más reciente. Alimenta la pantalla /vvn/actualizaciones. */
export async function getVvnFeedVenues(): Promise<Venue[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("is_active", true)
    .not("fraccionamiento_id", "is", null)
    .or("daily_text.not.is.null,daily_image_url.not.is.null")
    // Solo actualizaciones vigentes (< 24h). Ver [[daily-update-fresh]].
    .gte("daily_updated_at", dailyUpdateCutoffISO())
    .order("daily_updated_at", { ascending: false })
    .limit(200); // tope de seguridad para el feed de actualizaciones VVN
  throwIfDatabaseError(error, "getVvnFeedVenues");
  return (data ?? []).map(rowToVenue);
}

/** Locales sueltos del coto (pertenecen al fraccionamiento pero a ninguna plaza). */
export async function getSueltosByFraccionamiento(fraccionamientoId: string): Promise<Venue[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("is_active", true)
    .eq("fraccionamiento_id", fraccionamientoId)
    .is("plaza_id", null)
    .order("is_deprioritized", { ascending: true }) // despriorizados (Oxxo 24h) al final
    .order("is_featured", { ascending: false })
    .order("status", { ascending: false })
    .order("name");
  throwIfDatabaseError(error, "getSueltosByFraccionamiento");
  return (data ?? []).map(rowToVenue);
}

/** Locales de una plaza. */
export async function getVenuesByPlaza(plazaId: string): Promise<Venue[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("is_active", true)
    .eq("plaza_id", plazaId)
    .order("is_deprioritized", { ascending: true }) // despriorizados (Oxxo 24h) al final
    .order("is_featured", { ascending: false })
    .order("status", { ascending: false })
    .order("name");
  throwIfDatabaseError(error, "getVenuesByPlaza");
  return (data ?? []).map(rowToVenue);
}

export async function getVenueById(venueId: string): Promise<Venue | null> {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("id", venueId)
    .single();

  throwIfDatabaseError(error, "getVenueById");
  if (!data) return null;
  return rowToVenue(data);
}

export function rowToMenuItem(row: Record<string, unknown>): MenuItem {
  return {
    id: row.id as string,
    venue_id: row.venue_id as string,
    name: row.name as string,
    description: row.description as string | null,
    price: row.price as number | null,
    image_url: row.image_url as string | null,
    category: row.category as string,
    is_available: row.is_available as boolean,
    order: row.order as number,
    created_at: row.created_at as string,
  };
}

export function rowToService(row: Record<string, unknown>): Service {
  return {
    id: row.id as string,
    venue_id: row.venue_id as string,
    name: row.name as string,
    description: row.description as string | null,
    price: row.price as number | null,
    duration: row.duration as number | null,
    image_url: row.image_url as string | null,
    is_available: row.is_available as boolean,
    order: row.order as number,
    created_at: row.created_at as string,
  };
}

export async function getMenuItems(venueId: string): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from("menu_items")
    .select("*")
    .eq("venue_id", venueId)
    .eq("is_available", true)
    .order("order");

  throwIfDatabaseError(error, "getMenuItems");
  return (data ?? []).map(rowToMenuItem);
}

export async function getServices(venueId: string): Promise<Service[]> {
  const { data, error } = await supabase
    .from("services")
    .select("*")
    .eq("venue_id", venueId)
    .eq("is_available", true)
    .order("order");

  throwIfDatabaseError(error, "getServices");
  return (data ?? []).map(rowToService);
}

async function postVenueStat(venueId: string, kind: "view" | "whatsapp" | "website"): Promise<void> {
  try {
    const res = await fetch("/api/venues/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ venueId, kind }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      console.warn(`[venue stat ${kind}]`, res.status, j?.error ?? res.statusText);
    }
  } catch (e) {
    console.warn(`[venue stat ${kind}]`, e);
  }
}

export async function incrementVenueViews(venueId: string): Promise<void> {
  await postVenueStat(venueId, "view");
}

export async function incrementWhatsappTaps(venueId: string): Promise<void> {
  await postVenueStat(venueId, "whatsapp");
}

export async function incrementWebsiteTaps(venueId: string): Promise<void> {
  await postVenueStat(venueId, "website");
}

export async function getVenuesByOwner(ownerId: string): Promise<Venue[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("owner_id", ownerId);

  throwIfDatabaseError(error, "getVenuesByOwner");
  return (data ?? []).map(rowToVenue);
}

/** Altas de venues: usar solo la Server Action en `src/app/admin/venues/new/actions.ts` (Supabase service role). */

export async function updateVenue(venueId: string, updates: Partial<Venue>): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.name) payload.name = updates.name;
  if (updates.type) payload.type = updates.type;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.status) { payload.status = updates.status; payload.status_updated_at = new Date().toISOString(); }
  if (updates.is_active !== undefined) payload.is_active = updates.is_active;
  if (updates.tags) payload.tags = updates.tags;
  if (updates.contact) {
    if (updates.contact.phone !== undefined) payload.phone = updates.contact.phone;
    if (updates.contact.bot_phone !== undefined) payload.bot_phone = updates.contact.bot_phone;
    if (updates.contact.instagram !== undefined) payload.instagram = updates.contact.instagram;
    if (updates.contact.cta !== undefined) payload.contact_cta = updates.contact.cta;
    if (updates.contact.website_url !== undefined) payload.website_url = updates.contact.website_url;
  }
  if (updates.location) {
    payload.lat = updates.location.lat;
    payload.lng = updates.location.lng;
    payload.location_reference = updates.location.reference;
    payload.address = updates.location.address;
    payload.is_ambulatory = updates.location.is_ambulatory;
    if (updates.location.is_closed_door !== undefined) {
      payload.is_closed_door = updates.location.is_closed_door;
    }
  }
  if (updates.media) {
    payload.logo_url = updates.media.logo_url;
    payload.cover_url = updates.media.cover_url;
  }
  if (updates.daily_update !== undefined) {
    payload.daily_text = updates.daily_update?.text ?? null;
    payload.daily_image_url = updates.daily_update?.image_url ?? null;
    payload.daily_updated_at = updates.daily_update?.updated_at ?? null;
  }
  if (updates.catalog_pdf_url !== undefined) {
    payload.catalog_pdf_url = updates.catalog_pdf_url?.trim() || null;
  }
  if (updates.catalog_updated_on !== undefined) {
    payload.catalog_updated_on = updates.catalog_updated_on || null;
  }

  const { error } = await supabase.from("venues").update(payload).eq("id", venueId);
  throwIfDatabaseError(error, "updateVenue");
}

export async function getFeedVenues(): Promise<Venue[]> {
  const venues = await getActiveVenues();
  return venues
    .filter((v) => v.daily_update?.text || v.daily_update?.image_url)
    .sort((a, b) => {
      const aTs = a.daily_update?.updated_at ? new Date(a.daily_update.updated_at).getTime() : 0;
      const bTs = b.daily_update?.updated_at ? new Date(b.daily_update.updated_at).getTime() : 0;
      return bTs - aTs;
    });
}
