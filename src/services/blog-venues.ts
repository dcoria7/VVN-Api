import "server-only";
import { throwIfDatabaseError } from "@/server/data/database-error";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { rowToVenue } from "@/services/venues";
import { buildVenuePath, normalizeVenueNameSlug } from "@/lib/venue-path";
import { venueCategoryLabel } from "@/lib/venue-category";

// Datos mínimos para pintar una card de venue intercalada en un post del blog
// (ver BlogVenueCard / BlogBody). El autor referencia el venue por su slug de
// nombre (`@venue:marisa`); aquí lo resolvemos contra los venues VVN activos y
// adjuntamos la plaza (nombre + URL limpia) para enlazarla.
export interface BlogVenueCard {
  slug: string;
  name: string;
  href: string;
  imageUrl: string | null;
  categoryLabel: string | null;
  plazaName: string | null;
  plazaHref: string | null;
}

/** Resuelve referencias existentes. Las ausentes se omiten; los fallos se propagan. */
export async function getBlogVenueCards(
  slugs: string[]
): Promise<Record<string, BlogVenueCard>> {
  const want = new Set(slugs.map((s) => s.toLowerCase()));
  if (want.size === 0) return {};

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("is_active", true)
    .not("fraccionamiento_id", "is", null);
  throwIfDatabaseError(error, "getBlogVenueCards.venues");

  const venues = (data ?? [])
    .map(rowToVenue)
    .filter((v) => want.has(normalizeVenueNameSlug(v.name)));
  if (venues.length === 0) return {};

  const plazaIds = [...new Set(venues.map((v) => v.plaza_id).filter(Boolean))] as string[];
  const fraccIds = [
    ...new Set(venues.map((v) => v.fraccionamiento_id).filter(Boolean)),
  ] as string[];

  const [plazaRes, fraccRes] = await Promise.all([
    plazaIds.length
      ? supabase.from("plazas").select("id,name,slug,fraccionamiento_id").in("id", plazaIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
    fraccIds.length
      ? supabase.from("fraccionamientos").select("id,slug").in("id", fraccIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
  ]);
  throwIfDatabaseError(plazaRes.error, "getBlogVenueCards.plazas");
  throwIfDatabaseError(fraccRes.error, "getBlogVenueCards.fraccionamientos");

  const plazaById = new Map(
    (plazaRes.data ?? []).map((p) => [p.id as string, p as Record<string, unknown>])
  );
  const fraccSlugById = new Map(
    (fraccRes.data ?? []).map((f) => [f.id as string, f.slug as string])
  );

  const out: Record<string, BlogVenueCard> = {};
  for (const v of venues) {
    const slug = normalizeVenueNameSlug(v.name);
    const plaza = v.plaza_id ? plazaById.get(v.plaza_id) : null;
    const fraccSlug = v.fraccionamiento_id ? fraccSlugById.get(v.fraccionamiento_id) : null;
    const plazaSlug = plaza?.slug as string | undefined;
    out[slug] = {
      slug,
      name: v.name,
      href: buildVenuePath(v.id, v.name),
      imageUrl: v.media.logo_url ?? v.media.cover_url ?? null,
      categoryLabel: venueCategoryLabel(v.category),
      plazaName: (plaza?.name as string | undefined) ?? null,
      plazaHref: plazaSlug && fraccSlug ? `/${fraccSlug}/${plazaSlug}` : null,
    };
  }
  return out;
}
