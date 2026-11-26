import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

it("no recupera acceso global si faltan credenciales del operador", async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY", "synthetic");
  vi.stubEnv("BRAND_OPERATOR_EMAIL", undefined);
  vi.stubEnv("BRAND_OPERATOR_PASSWORD", undefined);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "global-key-that-must-never-be-used");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { createSupabaseAdmin } = await import("./supabase-admin");
  expect(() => createSupabaseAdmin()).toThrow("Falta la configuración");
  expect(fetcher).not.toHaveBeenCalled();
});

it("exige clave publicable aunque exista una service role", async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined);
  vi.stubEnv("BRAND_OPERATOR_EMAIL", "operator@example.invalid");
  vi.stubEnv("BRAND_OPERATOR_PASSWORD", "synthetic");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "global-key-that-must-never-be-used");
  const { createSupabaseAdmin } = await import("./supabase-admin");
  expect(() => createSupabaseAdmin()).toThrow("Falta la configuración");
});

it("importar mappers/cliente compartido no autentica ni abre red", async () => {
  vi.resetModules();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await import("./supabase");
  await import("@/services/venues");
  expect(fetcher).not.toHaveBeenCalled();
});
