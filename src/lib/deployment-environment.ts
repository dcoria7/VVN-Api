import "server-only";

export type DeploymentEnvironment = "staging" | "production";
export function parseDeploymentEnvironment(value: string | undefined): DeploymentEnvironment {
  if (value !== "staging" && value !== "production") {
    throw new Error("VVN_ENVIRONMENT debe ser staging o production.");
  }
  return value;
}
export const deploymentEnvironment = parseDeploymentEnvironment(process.env.VVN_ENVIRONMENT);

/** Evitar que una configuración incompleta conecte pruebas con datos reales. */
export function validateSupabaseEnvironment(environment: DeploymentEnvironment, rawUrl: string, expectedRef: string | undefined): void {
  const url = new URL(rawUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error("La URL de Supabase debe contener únicamente el origen.");
  }
  if (local && environment === "staging" && url.protocol === "http:") return;
  if (!expectedRef || !/^[a-z]{20}$/.test(expectedRef) || url.origin !== `https://${expectedRef}.supabase.co`) {
    throw new Error("La URL de Supabase no coincide con VVN_EXPECTED_SUPABASE_PROJECT_REF.");
  }
  const stagingRef = "msfrkqfvdhyjnktwuhzd";
  if ((environment === "staging") !== (expectedRef === stagingRef)) {
    throw new Error("El proyecto Supabase no corresponde al ambiente configurado.");
  }
}
