import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { scopeBrandClient } from "./brand-client";
import { deploymentBrandId } from "./deployment-brand";

afterEach(() => vi.unstubAllGlobals());

function backend() {
  const calls: { url: URL; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init });
    return new Response("[]", { headers: { "Content-Type": "application/json" } });
  }));
  const client = scopeBrandClient(createClient("http://127.0.0.1:54321", "synthetic", { accessToken: async () => "operator", auth: { persistSession: false } }), deploymentBrandId);
  return { client, calls };
}

describe("frontera de datos de VVN", () => {
  it("incluye la marca en listados, búsquedas por slug y updates", async () => {
    const { client, calls } = backend();
    await client.from("fraccionamientos").select("*").eq("slug", "compartido");
    await client.from("blog_posts").select("*").eq("slug", "compartido");
    await client.from("venues").update({ views: 1 }).eq("id", "venue");
    expect(calls).toHaveLength(3);
    for (const { url } of calls) expect(url.searchParams.get("brand_id")).toBe(`eq.${deploymentBrandId}`);
  });

  it("sella los inserts/upserts, también en lotes", async () => {
    const { client, calls } = backend();
    await client.from("analytics_events").insert([{ event_type: "app_open" }, { event_type: "search" }]);
    await client.from("venue_ratings").upsert({ stars: 5, venue_id: "venue" });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual([
      { event_type: "app_open", brand_id: deploymentBrandId }, { event_type: "search", brand_id: deploymentBrandId },
    ]);
    expect(JSON.parse(String(calls[1].init?.body)).brand_id).toBe(deploymentBrandId);
  });

  it("rechaza escrituras con marca distinta antes de enviarlas", () => {
    const { client, calls } = backend();
    expect(() => client.from("analytics_events").insert({ brand_id: "otra" })).toThrow("Marca de escritura inválida");
    expect(calls).toHaveLength(0);
  });

  it("rechaza tablas sin un contrato por marca, incluidos dispositivos legacy", () => {
    const { client, calls } = backend();
    expect(() => client.from("device_tokens")).toThrow("Tabla fuera del contrato");
    expect(() => client.from("brand_operators")).toThrow("Tabla fuera del contrato");
    expect(calls).toHaveLength(0);
  });
});
