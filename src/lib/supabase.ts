import "server-only";
import { createSupabaseAdmin } from "./supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

/** La API no tiene cliente de navegador: también las lecturas pasan por RLS de VVN. */
// Lazy: supabase-js inicia el callback accessToken al construir Realtime incluso
// sin canales. Importar un mapper o compilar Next no debe autenticar al operador.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const client = createSupabaseAdmin();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
