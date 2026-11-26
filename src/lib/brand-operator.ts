import "server-only";
import { createClient } from "@supabase/supabase-js";
import { VVN_BRAND_SLUG } from "./deployment-brand";

type OperatorConfig = { url: string; publicKey: string; brandId: string; email: string; password: string };

/** El JWT identifica al operador; brand_operators/RLS resuelven sus permisos en DB. */
export function createBrandTokenProvider(config: OperatorConfig): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;
  const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

  return async () => {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    if (pending) return pending;
    pending = (async () => {
      const login = createClient(config.url, config.publicKey, { auth });
      const { data, error } = await login.auth.signInWithPassword({ email: config.email, password: config.password });
      if (error || !data.session) throw new Error("No se pudo autenticar el operador de VVN.");

      const token = data.session.access_token;
      // Consulta autenticada: la política brands_operator_read solo deja ver la
      // marca asignada al operador. No confiar en user_metadata ni en el perfil visual.
      const verify = createClient(config.url, config.publicKey, { auth, accessToken: async () => token });
      const result = await verify.from("brands").select("id,slug,is_active")
        .eq("id", config.brandId).eq("slug", VVN_BRAND_SLUG).eq("is_active", true).single();
      if (result.error || result.data?.id !== config.brandId || result.data.slug !== VVN_BRAND_SLUG || !result.data.is_active) {
        throw new Error("El operador no tiene acceso a la marca activa Vive Valle Norte.");
      }
      cached = { token, expiresAt: (data.session.expires_at ?? 0) * 1000 };
      return token;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}
