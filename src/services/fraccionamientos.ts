import { throwIfDatabaseError } from "@/server/data/database-error";
import { supabase } from "@/lib/supabase";
import { Fraccionamiento, Plaza, Parque } from "@/types";

// Vive Valle Norte: directorio por fraccionamiento/plaza. Lecturas públicas
// (RLS: select para todos). Escritura solo desde server actions con service role.
// Ver [[vista-fraccionamiento-plazas]].

export function rowToFraccionamiento(row: Record<string, unknown>): Fraccionamiento {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    center_lat: (row.center_lat as number | null) ?? null,
    center_lng: (row.center_lng as number | null) ?? null,
    default_zoom: (row.default_zoom as number | null) ?? null,
    created_at: row.created_at as string,
  };
}

export function rowToPlaza(row: Record<string, unknown>): Plaza {
  return {
    id: row.id as string,
    fraccionamiento_id: row.fraccionamiento_id as string,
    name: row.name as string,
    slug: row.slug as string,
    zona: (row.zona as string | null) ?? null,
    lat: (row.lat as number | null) ?? null,
    lng: (row.lng as number | null) ?? null,
    cover_url: (row.cover_url as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    amenities: (row.amenities as string[]) ?? [],
    created_at: row.created_at as string,
  };
}

export async function getPlazaById(plazaId: string): Promise<Plaza | null> {
  const { data, error } = await supabase
    .from("plazas")
    .select("*")
    .eq("id", plazaId)
    .maybeSingle();
  throwIfDatabaseError(error, "getPlazaById");
  if (!data) return null;
  return rowToPlaza(data);
}

export function rowToParque(row: Record<string, unknown>): Parque {
  return {
    id: row.id as string,
    fraccionamiento_id: row.fraccionamiento_id as string,
    name: row.name as string,
    slug: row.slug as string,
    description: (row.description as string | null) ?? null,
    lat: (row.lat as number | null) ?? null,
    lng: (row.lng as number | null) ?? null,
    cover_url: (row.cover_url as string | null) ?? null,
    photos: (row.photos as string[]) ?? [],
    amenities: (row.amenities as string[]) ?? [],
    created_at: row.created_at as string,
  };
}

export async function getFraccionamientos(): Promise<Fraccionamiento[]> {
  const { data, error } = await supabase
    .from("fraccionamientos")
    .select("*")
    .order("name");
  throwIfDatabaseError(error, "getFraccionamientos");
  return (data ?? []).map(rowToFraccionamiento);
}

export async function getFraccionamientoBySlug(
  slug: string
): Promise<Fraccionamiento | null> {
  const { data, error } = await supabase
    .from("fraccionamientos")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  throwIfDatabaseError(error, "getFraccionamientoBySlug");
  if (!data) return null;
  return rowToFraccionamiento(data);
}

/** Plazas de un fraccionamiento (o todas si no se pasa id). */
export async function getPlazas(fraccionamientoId?: string): Promise<Plaza[]> {
  let query = supabase.from("plazas").select("*");
  if (fraccionamientoId) query = query.eq("fraccionamiento_id", fraccionamientoId);
  const { data, error } = await query.order("name");
  throwIfDatabaseError(error, "getPlazas");
  return (data ?? []).map(rowToPlaza);
}

export async function getParques(fraccionamientoId?: string): Promise<Parque[]> {
  let query = supabase.from("parques").select("*");
  if (fraccionamientoId) query = query.eq("fraccionamiento_id", fraccionamientoId);
  const { data, error } = await query.order("name");
  throwIfDatabaseError(error, "getParques");
  return (data ?? []).map(rowToParque);
}

/** Un parque por id (lo usa la API móvil, que direcciona por id y no por slug). */
export async function getParqueById(parqueId: string): Promise<Parque | null> {
  const { data, error } = await supabase
    .from("parques")
    .select("*")
    .eq("id", parqueId)
    .maybeSingle();
  throwIfDatabaseError(error, "getParqueById");
  if (!data) return null;
  return rowToParque(data);
}

export async function getParqueBySlug(
  fraccionamientoId: string,
  slug: string
): Promise<Parque | null> {
  const { data, error } = await supabase
    .from("parques")
    .select("*")
    .eq("fraccionamiento_id", fraccionamientoId)
    .eq("slug", slug)
    .maybeSingle();
  throwIfDatabaseError(error, "getParqueBySlug");
  if (!data) return null;
  return rowToParque(data);
}
