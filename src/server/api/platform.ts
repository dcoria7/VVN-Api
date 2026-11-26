import "server-only";
import { isTrackPlatform, type TrackPlatform } from "@/lib/track";

/**
 * Plataforma de origen de una escritura: cabecera `X-Platform` o campo
 * `platform` del body, en ese orden. Se queda en `meta.platform` para poder
 * separar web de app en el dashboard de analytics.
 *
 * No se infiere del User-Agent: es un dato declarado por el cliente y sirve para
 * segmentar métricas, no para autorizar nada. Un valor fuera de
 * `ios | android | web` se descarta en vez de guardarse.
 */
export function readPlatform(req: Request, body?: Record<string, unknown>): TrackPlatform | null {
  const fromHeader = req.headers.get("x-platform");
  if (isTrackPlatform(fromHeader)) return fromHeader;
  if (body && isTrackPlatform(body.platform)) return body.platform;
  return null;
}
