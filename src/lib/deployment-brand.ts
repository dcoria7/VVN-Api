import "server-only";
import { deploymentEnvironment } from "./deployment-environment";

/** Identidad de datos del despliegue. Nunca se toma de una petición HTTP. */
export const VVN_BRAND_SLUG = "vive-valle-norte";

export function parseBrandId(value: string | undefined): string {
  const id = value?.trim().toLowerCase();
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new Error("VVN_BRAND_ID debe ser el UUID de Vive Valle Norte en el entorno elegido.");
  }
  return id;
}

export const deploymentBrandId = parseBrandId(process.env.VVN_BRAND_ID);
export const deploymentScope = `${deploymentEnvironment}:${deploymentBrandId}`;
