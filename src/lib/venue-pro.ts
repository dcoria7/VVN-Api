import type { Venue } from "@/types";

/**
 * Regla CANÓNICA de ficha Pro (desbloqueada). Un solo lugar, dos superficies:
 * la web (`VenueDetail`) y la API móvil (`/api/v1/*`, campo `is_pro`).
 *
 * - ClickLocal general (`fraccionamiento_id` null): siempre Pro. Ahí no hay capado;
 *   el modelo es geo y gratuito.
 * - Vive Valle Norte: Pro solo si el negocio pagó (`is_premium`).
 *
 * Decisión 2026-10-19: antes había DOS reglas divergentes. `VenueDetail` usaba
 * `!isVvn || is_premium` (lo que el visitante ve de verdad) y `isFichaLocked` de
 * `services/venues.ts` usaba `plaza_id != null && !is_premium` (dejaba la ficha
 * completa a los sueltos del coto tipo Oxxo). Se eligió la primera porque es la
 * que está en producción: la API debe describir lo que la web muestra, no una
 * variante. `isFichaLocked` ahora delega aquí, así que ya no pueden divergir.
 *
 * Cambiar el capado = cambiar SOLO esta función.
 */
export type VenueProFlags = Pick<Venue, "fraccionamiento_id" | "is_premium">;

export function isVenuePro(venue: VenueProFlags): boolean {
  return !venue.fraccionamiento_id || venue.is_premium;
}
