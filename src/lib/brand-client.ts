import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const TABLES = new Set([
  "venues", "fraccionamientos", "plazas", "parques", "menu_items", "services",
  "promotions", "venue_photos", "venue_ratings", "blog_posts", "vvn_announcements", "analytics_events",
]);

/** Filtro explícito adicional a RLS; las tablas desconocidas se rechazan. */
export function scopeBrandClient(client: SupabaseClient, brandId: string): SupabaseClient {
  const from = client.from.bind(client);
  client.from = ((relation: string) => {
    if (!TABLES.has(relation)) throw new Error("Tabla fuera del contrato de datos de VVN.");
    const builder = from(relation);
    return new Proxy(builder, {
      get(target, property, receiver) {
        if (property === "select" || property === "update" || property === "delete") {
          return (...args: unknown[]) => Reflect.apply(target[property], target, args).eq("brand_id", brandId);
        }
        if (property === "insert" || property === "upsert") {
          return (values: Record<string, unknown> | Record<string, unknown>[], ...args: unknown[]) => {
            const stamp = (row: Record<string, unknown>) => {
              if (row.brand_id !== undefined && row.brand_id !== brandId) throw new Error("Marca de escritura inválida.");
              return { ...row, brand_id: brandId };
            };
            return Reflect.apply(target[property], target, [Array.isArray(values) ? values.map(stamp) : stamp(values), ...args]);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
  }) as typeof client.from;
  return client;
}
