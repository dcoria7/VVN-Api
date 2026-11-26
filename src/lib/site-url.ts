export function getSiteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "http://localhost:3000";

  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

/**
 * URL canónica del vertical Vive Valle Norte (su propio dominio). Se usa para
 * canónicas, OG y sitemap de las páginas VVN, que viven en vivevallenorte.com
 * aunque compartan deployment con ClickLocal. Ver `src/proxy.ts` para el ruteo
 * por dominio (vivevallenorte.com/* → /vvn/* por rewrite interno).
 */
export function getVvnSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_VVN_SITE_URL || "https://vivevallenorte.com";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

/** Hostname (sin protocolo) del dominio de Vive Valle Norte, p. ej. "vivevallenorte.com". */
export function getVvnHost(): string {
  try {
    return new URL(getVvnSiteUrl()).host;
  } catch {
    return "vivevallenorte.com";
  }
}

/** Hostname (sin protocolo) del dominio de ClickLocal general derivado de NEXT_PUBLIC_SITE_URL. */
export function getClickLocalHost(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}
