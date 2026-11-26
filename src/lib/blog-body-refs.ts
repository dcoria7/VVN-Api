// Tokens del cuerpo de un post del blog VVN. Vive aquí, suelto de `BlogBody`,
// porque lo necesitan dos superficies: el render de la web y la API móvil
// (/api/v1/blog/[slug], que precarga las cards de negocio del post). Importar
// `BlogBody` desde un route handler arrastraría los componentes de React al
// bundle de la función sin ninguna ganancia.

/** Línea `@venue:slug | descripción` → card del negocio. */
export const VENUE_TOKEN_RE = /^@venue:([a-z0-9-]+)\s*(?:\|\s*(.*\S))?\s*$/i;

/** Slugs de venue referenciados en el body (para precargar las cards en el server). */
export function extractVenueSlugs(body: string): string[] {
  const slugs: string[] = [];
  for (const line of body.split("\n")) {
    const m = line.match(VENUE_TOKEN_RE);
    if (m) slugs.push(m[1].toLowerCase());
  }
  return [...new Set(slugs)];
}
