// Datos comerciales del Plan Pro. Viven aquí y no en la página porque los
// consumen dos superficies: /planes (web) y GET /api/v1/config (apps nativas,
// que deben poder cambiar el precio sin publicar una versión nueva).

export const PLAN_PRO_PRICE_MXN = 200;
/** Precio tachado (ancla de lanzamiento). */
export const PLAN_PRO_LIST_PRICE_MXN = 250;
export const PLAN_PRO_PRICE_NOTE = "Por lanzamiento";
export const PLAN_PRO_TAGLINE =
  "Ficha completa para destacar tu negocio. Cancela cuando lo decidas.";

export const PLAN_PRO_FEATURES = [
  "Logo y foto de portada",
  "Botón de contacto (WhatsApp o sitio web)",
  'Agregar post a sección "Actualizaciones del día" con foto y texto que aparece en el home',
  "Menú, productos y servicios",
  "Etiquetas personalizadas",
  "Instagram y sitio web",
  "Catálogo en PDF",
  "Galería de fotos (hasta 10)",
  "Promociones y cupones",
  "Métricas de visitas y analítica de tu negocio",
] as const;

export const PLAN_FREE_FEATURES = (brandName: string) => [
  "Ficha básica con nombre y categoría",
  "Estado abierto / cerrado",
  `Visible en el directorio ${brandName}`,
];

/** Correo público de contacto (mismo en ClickLocal y VVN). */
export const CONTACT_EMAIL = "contacto.clicklocal@gmail.com";
