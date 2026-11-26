import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { deploymentBrandId } from "./deployment-brand";
import { createBrandTokenProvider } from "./brand-operator";
import { scopeBrandClient } from "./brand-client";
import { deploymentEnvironment, validateSupabaseEnvironment } from "./deployment-environment";

let client: SupabaseClient | undefined;

/** Nombre heredado: usa un operador autenticado limitado a VVN, nunca service role. */
export function createSupabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.BRAND_OPERATOR_EMAIL;
  const password = process.env.BRAND_OPERATOR_PASSWORD;
  if (!url || !publicKey || !email || !password) {
    throw new Error("Falta la configuración de Supabase o del operador de VVN.");
  }
  // No hay fallback a service role: un error de configuración debe cerrar el acceso.
  validateSupabaseEnvironment(deploymentEnvironment, url, process.env.VVN_EXPECTED_SUPABASE_PROJECT_REF);
  client = scopeBrandClient(createClient(url, publicKey, {
    accessToken: createBrandTokenProvider({ url, publicKey, brandId: deploymentBrandId, email, password }),
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }), deploymentBrandId);
  return client;
}
