import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { throwIfDatabaseError } from "./database-error";

const ENTITY_TABLES = {
  venue: "venues", promotion: "promotions", plaza: "plazas",
  parque: "parques", fraccionamiento: "fraccionamientos",
} as const;
export type BrandEntityType = keyof typeof ENTITY_TABLES;

export function isBrandEntityType(value: unknown): value is BrandEntityType {
  return typeof value === "string" && Object.hasOwn(ENTITY_TABLES, value);
}

/** Se comprueba ANTES de escribir eventos o llamar RPCs que podrían no afectar filas. */
export async function brandEntityExists(type: BrandEntityType, id: string): Promise<boolean> {
  let query = createSupabaseAdmin().from(ENTITY_TABLES[type]).select("id").eq("id", id);
  if (type === "venue" || type === "promotion") query = query.eq("is_active", true);
  if (type === "venue") query = query.not("fraccionamiento_id", "is", null);
  const { data, error } = await query.maybeSingle();
  throwIfDatabaseError(error, `brandEntityExists.${type}`);
  return data !== null;
}
