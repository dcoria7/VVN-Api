import "server-only";
import { deploymentScope } from "@/lib/deployment-brand";
import { unstable_cache } from "next/cache";
import {
  getFraccionamientoBySlug,
  getParques,
  getPlazas,
} from "@/services/fraccionamientos";
import { getVenuesByFraccionamiento } from "@/services/venues";
import { getActiveVvnAnnouncements } from "@/services/vvn-announcements";
import { getVenueIdsWithLivePromotions } from "@/services/venue-promotions-server";
import { toApiVenues, type ApiVenue } from "@/server/api/dto";
import type { Fraccionamiento, Parque, Plaza, VvnAnnouncement } from "@/types";

// Payload del home de la app (pestaña Explorar) en UNA sola llamada.
//
// Compone servicios de datos sin importar componentes de la web de origen.
// La caché pertenece a este despliegue: invalidar el admin de la web no invalida
// automáticamente la API independiente.

export type FraccPayload = {
  fraccionamiento: Fraccionamiento;
  plazas: Plaza[];
  parques: Parque[];
  venues: ApiVenue[];
  announcements: VvnAnnouncement[];
  counts: { venues: number; plazas: number; parques: number };
};

// No persistir ausencias en la caché de datos de 300 s. Los errores de consulta
// se propagan y las ausencias reales usan únicamente la caché HTTP corta del 404.
const EMPTY = "vvn-api-empty";

async function loadRaw(slug: string): Promise<FraccPayload | null> {
  const f = await getFraccionamientoBySlug(slug);
  if (!f) return null;

  const [plazas, parques, venues, announcements] = await Promise.all([
    getPlazas(f.id),
    getParques(f.id),
    getVenuesByFraccionamiento(f.id),
    getActiveVvnAnnouncements(),
  ]);

  const promoVenueIds = await getVenueIdsWithLivePromotions(venues.map((v) => v.id));

  return {
    fraccionamiento: f,
    plazas,
    parques,
    venues: toApiVenues(venues, promoVenueIds),
    announcements,
    counts: { venues: venues.length, plazas: plazas.length, parques: parques.length },
  };
}

const loadCached = unstable_cache(
  async (slug: string) => {
    const data = await loadRaw(slug);
    if (!data) throw new Error(EMPTY);
    return data;
  },
  ["v1-fracc-payload", "read-errors-v1", deploymentScope],
  { tags: ["vvn"], revalidate: 300 },
);

/** Null solo si el slug de verdad no existe (el caller responde 404). */
export async function loadFraccPayload(slug: string): Promise<FraccPayload | null> {
  try {
    return await loadCached(slug);
  } catch (e) {
    if (e instanceof Error && e.message === EMPTY) return null;
    throw e;
  }
}
