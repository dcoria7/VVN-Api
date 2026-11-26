import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrandTokenProvider } from "./brand-operator";
import { deploymentBrandId, parseBrandId } from "./deployment-brand";

const config = { url: "http://127.0.0.1:54321", publicKey: "test-publishable", brandId: deploymentBrandId, email: "operator@example.invalid", password: "synthetic-password" };

function backend(brand: Record<string, unknown> | null = { id: deploymentBrandId, slug: "vive-valle-norte", is_active: true }) {
  let logins = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname === "/auth/v1/token") {
      logins++;
      return Response.json({ access_token: `operator-token-${logins}`, refresh_token: "synthetic", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "synthetic-user" } });
    }
    expect(url.pathname).toBe("/rest/v1/brands");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer operator-token-${logins}`);
    expect(url.searchParams.get("id")).toBe(`eq.${deploymentBrandId}`);
    expect(url.searchParams.get("slug")).toBe("eq.vive-valle-norte");
    return brand ? Response.json(brand) : Response.json({ code: "PGRST116", message: "denied" }, { status: 406 });
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, logins: () => logins };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("configuración y operador de VVN", () => {
  it.each([undefined, "", "not-a-uuid", "----------------"])("rechaza identidad inválida: %s", (id) => {
    expect(() => parseBrandId(id)).toThrow("VVN_BRAND_ID");
  });

  it("normaliza el UUID de configuración", () => {
    expect(parseBrandId(` ${deploymentBrandId.toUpperCase()} `)).toBe(deploymentBrandId);
  });

  it("deduplica logins concurrentes y reusa el token vigente", async () => {
    const mock = backend();
    const token = createBrandTokenProvider(config);
    expect(await Promise.all([token(), token(), token()])).toEqual(Array(3).fill("operator-token-1"));
    expect(await token()).toBe("operator-token-1");
    expect(mock.logins()).toBe(1);
  });

  it("renueva y verifica otra vez el operador antes de que expire", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const mock = backend();
    const token = createBrandTokenProvider(config);
    await token();
    vi.setSystemTime(Date.now() + 3550_000);
    expect(await token()).toBe("operator-token-2");
    expect(mock.logins()).toBe(2);
  });

  it.each([
    null,
    { id: "22222222-2222-4222-8222-222222222222", slug: "vive-valle-norte", is_active: true },
    { id: deploymentBrandId, slug: "clicklocal", is_active: true },
    { id: deploymentBrandId, slug: "vive-valle-norte", is_active: false },
  ])("cierra el acceso si la identidad o autorización no coinciden", async (brand) => {
    const mock = backend(brand);
    const token = createBrandTokenProvider(config);
    await expect(token()).rejects.toThrow("operador no tiene acceso");
    await expect(token()).rejects.toThrow("operador no tiene acceso");
    expect(mock.logins()).toBe(2); // Un fallo no debe cachear autorización.
  });

  it("no publica errores de login que puedan contener datos sensibles", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "invalid_grant", error_description: "PRIVATE-DETAIL" }, { status: 400 })));
    await expect(createBrandTokenProvider(config)()).rejects.toThrow("No se pudo autenticar el operador de VVN.");
  });
});
