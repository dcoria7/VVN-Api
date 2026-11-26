import "server-only";
import { cookies } from "next/headers";
import { createHash, randomUUID } from "crypto";

/**
 * Identidad anónima de visitante. Hoy solo la usan las calificaciones de venue
 * (`/api/venues/rating`) para que un mismo navegador no vote dos veces el mismo
 * negocio. No identifica a nadie: es un UUID aleatorio en cookie httpOnly, sin
 * relación con ninguna cuenta.
 *
 * Nada de esto se guarda en claro en la base: la tabla `venue_ratings` solo
 * guarda hashes con salt (ver `hashKey`).
 */
export const VISITOR_COOKIE = "clicklocal_vid";

/**
 * Cabecera equivalente a la cookie, para clientes sin cookies (las apps nativas).
 * La app genera un UUID en el primer arranque y lo guarda en Keychain / DataStore
 * cifrado; lo manda en cada escritura que necesite identidad.
 *
 * Es falsificable — pero borrar una cookie también lo es, así que no cambia el
 * modelo de amenaza. Los tres frenos superpuestos siguen intactos: limitador por
 * IP, dedupe por visitante y tope de votos nuevos por IP y día. Igual que la
 * cookie, el valor NUNCA se guarda en claro: viaja hasheado con salt (`hashKey`).
 */
export const VISITOR_HEADER = "x-visitor-id";

/**
 * Forma de UUID, no "16-64 caracteres de hex y guiones".
 *
 * La regex vieja (`/^[0-9a-f-]{16,64}$/i`) aceptaba `"----------------"` como
 * identidad válida, y al no normalizar el caso un mismo id en mayúsculas y en
 * minúsculas hasheaba distinto — dos identidades para la misma instalación. El
 * valor se normaliza a minúsculas antes de hashear.
 */
const VISITOR_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 año

/** Valida el valor de `X-Visitor-Id`. Devuelve null si no tiene la forma esperada. */
export function parseVisitorIdHeader(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v && VISITOR_ID_RE.test(v) ? v : null;
}

/**
 * Devuelve el id de visitante.
 *
 * Con `headerValue` válido (las apps nativas mandan `X-Visitor-Id`) se usa ese y
 * no se toca la cookie. Si no, se lee la cookie y se crea si no existía: solo se
 * puede escribir donde Next lo permite (Route Handler o Server Action); en un
 * render de página la escritura se ignora en silencio.
 *
 * Un cliente sin cookie y sin cabecera recibe un id nuevo en cada petición, así
 * que para él no hay dedupe por visitante — solo lo frena el tope por IP y día.
 */
export async function getOrCreateVisitorId(headerValue?: string | null): Promise<string> {
  const fromHeader = parseVisitorIdHeader(headerValue);
  if (fromHeader) return fromHeader;

  const c = await cookies();
  const existing = c.get(VISITOR_COOKIE)?.value?.trim().toLowerCase();
  if (existing && VISITOR_ID_RE.test(existing)) return existing;

  const fresh = randomUUID();
  try {
    c.set(VISITOR_COOKIE, fresh, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    });
  } catch {
    // Contexto de solo lectura: el id sirve para esta petición y la cookie se
    // emitirá en el siguiente POST.
  }
  return fresh;
}

function salt(): string {
  // RATING_SALT es el salt dedicado; si falta, se reusa ADMIN_SECRET para no
  // romper dev. Cambiarlo invalida el dedupe (los votos viejos quedan, pero un
  // visitante podría volver a votar).
  return process.env.RATING_SALT?.trim() || process.env.ADMIN_SECRET?.trim() || "clicklocal-dev-salt";
}

/** Hash estable con salt. Las partes se unen con "|" para evitar colisiones. */
export function hashKey(parts: string[]): string {
  return createHash("sha256").update(`${salt()}|${parts.join("|")}`).digest("hex");
}

/** Clave del día en hora de Guadalajara (ventana del freno por IP). */
export function localDayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
