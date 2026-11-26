import { cache } from "react";
import { deploymentScope } from "@/lib/deployment-brand";
import { unstable_cache } from "next/cache";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { throwIfDatabaseError } from "@/server/data/database-error";
import { isUuid, normalizeVenueNameSlug, parseVenueShortId } from "@/lib/venue-path";

// Resolución de enlaces web para la API móvil, limitada por marca y estado activo.
const EMPTY = "v1-resolve-absent";

export type VenueSeoRow = {
  id: string;
  name: string;
  description: string | null;
  location_reference: string;
  address: string | null;
  logo_url: string | null;
  cover_url: string | null;
  updated_at: string | null;
  is_active: boolean;
  contact_cta: string | null;
  website_url: string | null;
  fraccionamiento_id: string | null;
};

// Columnas compartidas por las tres consultas; el cliente ya limita por marca.
// fraccionamiento_id conserva la restricción del catálogo de la API móvil.
const VENUE_SEO_COLUMNS =
  "id, name, description, location_reference, address, logo_url, cover_url, updated_at, is_active, contact_cta, website_url, fraccionamiento_id";

async function getVenueSeoDataById(id: string) {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("venues")
    .select(VENUE_SEO_COLUMNS)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  throwIfDatabaseError(error, "resolveVenueByPath.id");
  if (!data) return null;
  return data as VenueSeoRow;
}

/**
 * Resuelve el venue a partir del segmento de la URL.
 *
 * OJO con el camino caliente: `buildVenuePath` genera `/venue/<slug-del-nombre>`
 * (sin short-id), así que en la práctica `isUuid` casi siempre es false y
 * `parseVenueShortId` casi siempre null — es decir, la ruta normal es el fallback
 * de abajo, que lee los venues activos de la marca y hace el match en JS.
 * `unstable_cache` evita repetir lecturas correctas entre requests. Los errores
 * y las ausencias no se guardan en esa caché.
 * El scan sigue siendo O(n filas); si el catálogo crece, lo que toca es una columna
 * `slug` indexada en `venues`.
 */
async function resolveVenueByPathRaw(pathId: string): Promise<VenueSeoRow | null> {
  const directId = isUuid(pathId) ? pathId : null;
  if (directId) return getVenueSeoDataById(directId);

  const supabase = createSupabaseAdmin();
  const shortId = parseVenueShortId(pathId);

  if (shortId) {
    const { data: byShort, error: shortErr } = await supabase
      .from("venues")
      .select(VENUE_SEO_COLUMNS)
      .eq("is_active", true)
      // id es UUID: ILIKE sobre él falla en Postgres. El rango preserva el prefijo.
      .gte("id", `${shortId}-0000-0000-0000-000000000000`)
      .lte("id", `${shortId}-ffff-ffff-ffff-ffffffffffff`)
      .order("id")
      .limit(1)
      .maybeSingle();
    throwIfDatabaseError(shortErr, "resolveVenueByPath.shortId");
    if (byShort) return byShort as VenueSeoRow;
  }

  const { data: rows, error } = await supabase
    .from("venues")
    .select(VENUE_SEO_COLUMNS)
    .eq("is_active", true);
  throwIfDatabaseError(error, "resolveVenueByPath.slug");

  const target = pathId.trim().toLowerCase();
  return (
    ((rows ?? []) as VenueSeoRow[]).find((v) => normalizeVenueNameSlug(v.name) === target) ?? null
  );
}

const resolveVenueByPathCached = unstable_cache(
  async (pathId: string) => {
    const row = await resolveVenueByPathRaw(pathId);
    if (!row) throw new Error(EMPTY);
    return row;
  },
  ["venue-resolve-path", "read-errors-v1", deploymentScope],
  { tags: ["venues"], revalidate: 300 },
);

// No guardar ausencias cinco minutos: el 404 HTTP ya tiene su política corta.
export const resolveVenueByPath = cache(async (pathId: string): Promise<VenueSeoRow | null> => {
  try {
    return await resolveVenueByPathCached(pathId);
  } catch (error) {
    if (error instanceof Error && error.message === EMPTY) return null;
    throw error;
  }
});
