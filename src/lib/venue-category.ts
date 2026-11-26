// Giros/categorías curadas de negocio (Vive Valle Norte).
// Fuente única de la lista: reusada por el admin (selector) y el filtro del home
// del coto. Se busca englobar (pocos filtros, amplios) — ajusta esta lista aquí
// sin tocar la DB (no hay CHECK; el server action valida contra VENUE_CATEGORY_VALUES).
// NULL/sin categoría = el negocio solo aparece bajo "Todos".

export interface VenueCategoryOption {
  value: string;
  label: string;
}

export const VENUE_CATEGORIES: VenueCategoryOption[] = [
  { value: "cafeteria", label: "Cafetería" },
  { value: "restaurante", label: "Restaurante" },
  { value: "tienda", label: "Tienda / Abarrotes" },
  { value: "super", label: "Súper y tiendas de conveniencia" },
  { value: "carniceria", label: "Carnicería" },
  { value: "panaderia", label: "Panadería / Pastelería" },
  { value: "belleza", label: "Belleza" },
  { value: "salud", label: "Salud" },
  { value: "hogar", label: "Hogar" },
  { value: "gimnasio", label: "Gimnasio / Deporte" },
  { value: "servicios", label: "Servicios" },
  { value: "mascotas", label: "Mascotas" },
  { value: "otro", label: "Otro" },
];

export const VENUE_CATEGORY_VALUES = new Set(VENUE_CATEGORIES.map((c) => c.value));

/** Etiqueta legible de un giro; null/desconocido → null. */
export function venueCategoryLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return VENUE_CATEGORIES.find((c) => c.value === value)?.label ?? null;
}

/** Normaliza la entrada del form: valor válido o null. */
export function normalizeVenueCategory(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return v && VENUE_CATEGORY_VALUES.has(v) ? v : null;
}
