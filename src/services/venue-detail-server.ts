import "server-only";
import { throwIfDatabaseError } from "@/server/data/database-error";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { rowToVenue, rowToMenuItem, rowToService } from "@/services/venues";
import { rowToPromotion, isPromotionLive } from "@/services/promotions";
import type { Venue, MenuItem, Service, Promotion, VenuePhoto } from "@/types";

/** Card "Ubicado en" (plaza) para venues de Vive Valle Norte. */
export interface VvnPlazaCard {
  name: string;
  coverUrl: string | null;
  href: string;
}

export interface VenueDetailData {
  venue: Venue;
  menuItems: MenuItem[];
  services: Service[];
  /** Plaza a la que pertenece (solo venues de VVN con plaza). */
  vvnPlaza: VvnPlazaCard | null;
  /** Promociones/cupones vigentes del negocio. */
  promotions: Promotion[];
  /** Galería de fotos (Pro, máx. 10). */
  photos: VenuePhoto[];
}

/**
 * Lee la ficha completa con el operador limitado por RLS. Null significa ausencia
 * real; un fallo de cualquier sección se propaga, evitando cachear datos parciales.
 */
export async function getVenueDetailData(venueId: string): Promise<VenueDetailData | null> {
  const supabase = createSupabaseAdmin();

  const { data: venueRow, error: venueError } = await supabase
    .from("venues")
    .select("*")
    .eq("id", venueId)
    .eq("is_active", true)
    .maybeSingle();

  throwIfDatabaseError(venueError, "getVenueDetailData.venue");
  if (!venueRow) return null;

  const venue = rowToVenue(venueRow);
  const showMenu = venue.type === "food" || venue.type === "both" || venue.type === "product";
  const showServices = venue.type === "service" || venue.type === "both";

  const [menuRes, servicesRes] = await Promise.all([
    showMenu
      ? supabase
          .from("menu_items")
          .select("*")
          .eq("venue_id", venueId)
          .eq("is_available", true)
          .order("order")
      : Promise.resolve({ data: [], error: null }),
    showServices
      ? supabase
          .from("services")
          .select("*")
          .eq("venue_id", venueId)
          .eq("is_available", true)
          .order("order")
      : Promise.resolve({ data: [], error: null }),
  ]);

  throwIfDatabaseError(menuRes.error, "getVenueDetailData.menu");
  throwIfDatabaseError(servicesRes.error, "getVenueDetailData.services");
  const menuItems = (menuRes.data ?? []).map(rowToMenuItem);
  const services = (servicesRes.data ?? []).map(rowToService);

  // Promociones/cupones vigentes (precargadas para SSR). Exclusivas de
  // negocios de fraccionamiento (VVN); en ClickLocal general no se muestran.
  let promotions: Promotion[] = [];
  if (venueRow.fraccionamiento_id) {
    const { data: promoRows, error: promoError } = await supabase
      .from("promotions")
      .select("*")
      .eq("venue_id", venueId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    throwIfDatabaseError(promoError, "getVenueDetailData.promotions");
    const nowIso = new Date().toISOString();
    promotions = (promoRows ?? [])
      .map(rowToPromotion)
      .filter((p) => isPromotionLive(p, nowIso));
  }

  // Galería de fotos (Pro, máx. 10, ordenadas).
  const { data: photoRows, error: photoError } = await supabase
    .from("venue_photos")
    .select("*")
    .eq("venue_id", venueId)
    .order("order")
    .limit(10);
  throwIfDatabaseError(photoError, "getVenueDetailData.photos");
  const photos: VenuePhoto[] = (photoRows ?? []).map((r) => ({
    id: r.id as string,
    venue_id: r.venue_id as string,
    url: r.url as string,
    order: r.order as number,
    created_at: r.created_at as string,
  }));

  // Plaza a la que pertenece (para la card "Ubicado en" de VVN).
  let vvnPlaza: VvnPlazaCard | null = null;
  if (venue.plaza_id) {
    const { data: plazaRow, error: plazaError } = await supabase
      .from("plazas")
      .select("name, slug, cover_url, fraccionamiento_id")
      .eq("id", venue.plaza_id)
      .maybeSingle();
    throwIfDatabaseError(plazaError, "getVenueDetailData.plaza");
    if (plazaRow) {
      const { data: fraccRow, error: fraccError } = await supabase
        .from("fraccionamientos")
        .select("slug")
        .eq("id", plazaRow.fraccionamiento_id as string)
        .maybeSingle();
      throwIfDatabaseError(fraccError, "getVenueDetailData.fraccionamiento");
      if (fraccRow?.slug) {
        vvnPlaza = {
          name: plazaRow.name as string,
          coverUrl: (plazaRow.cover_url as string | null) ?? null,
          href: `/${fraccRow.slug as string}/${plazaRow.slug as string}`,
        };
      }
    }
  }

  return { venue, menuItems, services, vvnPlaza, promotions, photos };
}
