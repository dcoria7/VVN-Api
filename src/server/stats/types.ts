import "server-only";

// Resultado común de los helpers de escritura de métricas.
//
// Los helpers NO construyen respuestas HTTP: devuelven este resultado y cada
// superficie lo traduce a su propia envoltura (la web con NextResponse, la API
// móvil con los helpers de src/server/api/respond.ts). Así la lógica vive una vez
// y las dos rutas comparten comportamiento sin compartir formato.
export type WriteResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "server_error" }
  /** La función existe pero su infraestructura no está lista (p. ej. falta una
   *  migración). Es distinto de una falla: no vale un reporte a Sentry, y al
   *  cliente se le responde 503 para que reintente más tarde. */
  | { ok: false; reason: "unavailable" };

export const WRITE_OK: WriteResult = { ok: true };
export const WRITE_NOT_FOUND: WriteResult = { ok: false, reason: "not_found" };
export const WRITE_SERVER_ERROR: WriteResult = { ok: false, reason: "server_error" };
export const WRITE_UNAVAILABLE: WriteResult = { ok: false, reason: "unavailable" };
