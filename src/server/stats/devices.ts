import "server-only";
import { WRITE_UNAVAILABLE, type WriteResult } from "./types";

// Contrato de registro conservado mientras se adapta el esquema por marca.
// Un token de dispositivo no se registra en logs, Sentry ni en la respuesta.

export type DevicePlatform = "ios" | "android";

export function isDevicePlatform(v: unknown): v is DevicePlatform {
  return v === "ios" || v === "android";
}

/** Cotas de entrada: un token de FCM/APNs ronda los 150-200 caracteres. */
export const MAX_TOKEN_LEN = 512;
export const MAX_TOPICS = 20;
export const MAX_TOPIC_LEN = 40;
export const MAX_APP_VERSION_LEN = 32;

export type DeviceInput = {
  token: string;
  platform: DevicePlatform;
  /**
   * Identificador ESTABLE de la instalación, que no cambia cuando el sistema rota
   * el token de push. Es lo que permite deduplicar un dispositivo de verdad: sin
   * él, al rotar el token el upsert inserta una fila NUEVA y la vieja se queda
   * suscrita, así que el mismo teléfono recibe la notificación dos veces hasta que
   * alguien purgue. La app lo genera una vez y lo guarda junto al id de visitante.
   */
  installId?: string | null;
  fraccionamientoSlug?: string | null;
  topics?: string[];
  appVersion?: string | null;
  visitorKey?: string | null;
};

/** Sin efectos hasta disponer de tabla, índices y RLS compatibles con la marca. */
export async function registerDevice(_input: DeviceInput): Promise<WriteResult> {
  // El esquema compartido directory_brands no incluye device_tokens. La tabla
  // legacy solo permite service role, carece de brand_id y de políticas para el
  // operador. Bloqueado hasta provisionar el contrato de push en el proyecto
  // central; nunca recuperar acceso global como fallback.
  return WRITE_UNAVAILABLE;
}
