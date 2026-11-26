import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseOperationError } from "./database-error";
import { deploymentBrandId } from "@/lib/deployment-brand";
import { getFraccionamientoBySlug, getFraccionamientos, getParqueById, getParqueBySlug, getPlazaById } from "@/services/fraccionamientos";
import { getBlogPostBySlug } from "@/services/blog";
import { getVenueById } from "@/services/venues";
import { getVenueDetailData } from "@/services/venue-detail-server";
import { getActivePromotionsByVenue, getVenueIdsWithActivePromotions } from "@/services/promotions";
import { getVenueIdsWithLivePromotions } from "@/services/venue-promotions-server";
import { getZonePromotionsByVenue } from "@/services/zone-promotions-server";
import { getActiveVvnAnnouncements } from "@/services/vvn-announcements";
import { getBlogVenueCards } from "@/services/blog-venues";
import { resolveVenueByPath } from "@/server/api/resolve-venue";
import { loadFraccPayload } from "@/server/api/fracc-payload";
import { recordVenueStat } from "@/server/stats/venue-stats";
import { recordVvnStat } from "@/server/stats/vvn-stats";
import { recordPromotionStats } from "@/server/stats/promotion-stats";
import { submitRating } from "@/server/stats/rating";
import { GET as venueGET } from "@/app/api/v1/venues/[id]/route";
import { GET as configGET } from "@/app/api/v1/config/route";
import { reportError } from "@/lib/report-error";

vi.mock("@/lib/supabase", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabase: createClient("http://127.0.0.1:54321", "synthetic", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => globalThis.fetch(input, init) },
  }) };
});
vi.mock("@/lib/supabase-admin", async () => {
  const { supabase } = await import("@/lib/supabase");
  return { createSupabaseAdmin: () => supabase };
});
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn() }));

const id = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
type Context = { table: string; method: string; url: URL; body?: Record<string, unknown> };
let tables: Record<string, Record<string, unknown>[]>;
let failure: (context: Context) => boolean;
let missingCount: boolean;
let saved: boolean;
let writes: string[];
let calls: Context[];

beforeEach(() => {
  vi.clearAllMocks(); saved = false; missingCount = false; writes = []; calls = []; failure = () => false;
  const now = new Date().toISOString();
  tables = {
    venues: [{ id: id(4), brand_id: deploymentBrandId, name: "Negocio unitario", type: "both", is_active: true, fraccionamiento_id: id(1), plaza_id: id(2), rating_sum: 0, rating_count: 0 }],
    fraccionamientos: [{ id: id(1), slug: "zona-unitaria", name: "Zona" }],
    plazas: [{ id: id(2), name: "Plaza", slug: "plaza", fraccionamiento_id: id(1) }],
    parques: [{ id: id(3), slug: "parque", fraccionamiento_id: id(1) }],
    blog_posts: [{ id: id(6), slug: "nota", is_active: true, published_at: "2020-01-01T00:00:00Z" }],
    promotions: [{ id: id(7), venue_id: id(4), is_active: true, kind: "coupon", title: "Cupón", created_at: now }],
    menu_items: [], services: [], venue_photos: [], vvn_announcements: [], venue_ratings: [],
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    expect(url.origin).toBe("http://127.0.0.1:54321");
    const context: Context = { table: url.pathname.slice("/rest/v1/".length), method: init?.method ?? "GET", url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(context);
    if (failure(context)) return Response.json({ code: "XX000", message: "PRIVATE_DATABASE_DETAIL" }, { status: 500 });
    if (context.method === "POST") {
      writes.push(context.table);
      if (context.table === "venue_ratings") saved = true;
      return new Response(null, { status: 201 });
    }
    let rows = [...(tables[context.table] ?? [])];
    for (const [key, value] of url.searchParams) {
      if (value.startsWith("eq.")) rows = rows.filter(row => String(row[key]) === value.slice(3));
      if (value.startsWith("in.(")) rows = rows.filter(row => value.slice(4, -1).split(",").includes(String(row[key])));
      if (value === "not.is.null") rows = rows.filter(row => row[key] != null);
      if (value.startsWith("gte.")) rows = rows.filter(row => String(row[key]) >= value.slice(4));
      if (value.startsWith("lte.")) rows = rows.filter(row => String(row[key]) <= value.slice(4));
    }
    if (url.searchParams.get("select")?.includes("venue:venues!inner")) rows = rows.map(row => ({ ...row, venue: tables.venues.find(v => v.id === row.venue_id) }));
    if (context.method === "HEAD") return new Response(null, { headers: missingCount ? {} : { "Content-Range": "0-0/0" } });
    return Response.json(rows);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("ausencia real y errores de lectura", () => {
  const cases: [string, string, () => Promise<unknown>][] = [
    ["fraccionamiento", "fraccionamientos", () => getFraccionamientoBySlug("zona-unitaria")],
    ["plaza", "plazas", () => getPlazaById(id(2))],
    ["parque por id", "parques", () => getParqueById(id(3))],
    ["parque por slug", "parques", () => getParqueBySlug(id(1), "parque")],
    ["blog", "blog_posts", () => getBlogPostBySlug("nota")],
    ["negocio", "venues", () => getVenueById(id(4))],
    ["promos", "promotions", () => getActivePromotionsByVenue(id(4))],
    ["badges públicos", "promotions", () => getVenueIdsWithActivePromotions()],
    ["badges servidor", "promotions", () => getVenueIdsWithLivePromotions([id(4)])],
    ["cupones", "promotions", () => getZonePromotionsByVenue()],
    ["avisos", "vvn_announcements", () => getActiveVvnAnnouncements()],
    ["cards negocios", "venues", () => getBlogVenueCards(["negocio-unitario"])],
    ["cards plazas", "plazas", () => getBlogVenueCards(["negocio-unitario"])],
    ["cards zonas", "fraccionamientos", () => getBlogVenueCards(["negocio-unitario"])],
    ["resolve UUID", "venues", () => resolveVenueByPath(id(4))],
    ["resolve slug", "venues", () => resolveVenueByPath("negocio-unitario")],
    ["resolve short id", "venues", () => resolveVenueByPath("negocio-00000004")],
    ["payload zona", "fraccionamientos", () => loadFraccPayload("zona-unitaria")],
  ];
  it.each(cases)("propaga el fallo de %s", async (_name, table, load) => {
    failure = context => context.table === table;
    await expect(load()).rejects.toBeInstanceOf(DatabaseOperationError);
  });
  it.each(["venues", "menu_items", "services", "promotions", "venue_photos", "plazas", "fraccionamientos"])("la ficha no oculta el fallo en %s", async table => {
    failure = context => context.table === table;
    await expect(getVenueDetailData(id(4))).rejects.toBeInstanceOf(DatabaseOperationError);
  });
  it("devuelve null/[] cuando la consulta correcta no encuentra datos", async () => {
    tables.venues = []; tables.fraccionamientos = []; tables.promotions = [];
    expect(await getVenueDetailData(id(4))).toBeNull();
    expect(await loadFraccPayload("no-existe")).toBeNull();
    expect(await resolveVenueByPath("no-existe")).toBeNull();
    expect(await getFraccionamientos()).toEqual([]);
    expect(await getActivePromotionsByVenue(id(4))).toEqual([]);
  });
  it("conserva secciones vacías válidas en una ficha existente", async () => {
    const result = await getVenueDetailData(id(4));
    expect(result).toMatchObject({ menuItems: [], services: [], photos: [] });
    expect(result?.promotions).toHaveLength(1);
  });
});

describe("respuestas HTTP y recuperación", () => {
  const request = () => new Request(`http://local/api/v1/venues/${id(4)}`);
  const context = () => ({ params: Promise.resolve({ id: id(4) }) });
  it("responde 500 privado sin detalle interno y vuelve a responder 200 tras recuperarse", async () => {
    failure = context => context.table === "menu_items";
    const failed = await venueGET(request(), context());
    expect(failed.status).toBe(500);
    expect(failed.headers.get("cache-control")).toBe("private, no-store");
    const body = await failed.text();
    expect(body).not.toContain("PRIVATE_DATABASE_DETAIL");
    expect(JSON.parse(body).error).toBe("server_error");
    failure = () => false;
    expect((await venueGET(request(), context())).status).toBe(200);
  });
  it("un 404 real no repite la lectura del negocio", async () => {
    tables.venues = [];
    const response = await venueGET(request(), context());
    expect(response.status).toBe(404);
    expect(calls.filter(c => c.table === "venues")).toHaveLength(1);
  });
  it("config mantiene el interruptor de emergencia, señala degradación y no cachea el fallback", async () => {
    vi.stubEnv("MOBILE_KILL_SWITCH", "1");
    failure = context => context.table === "fraccionamientos";
    const failed = await configGET(new Request("http://local/api/v1/config"));
    expect(failed.status).toBe(200);
    expect(failed.headers.get("x-data-degraded")).toBe("1");
    expect(failed.headers.get("cache-control")).toBe("private, no-store");
    expect(await failed.json()).toMatchObject({ data: { default_fraccionamiento_slug: null, kill_switch: { enabled: true } } });
    expect(reportError).toHaveBeenCalled();
    failure = () => false;
    const recovered = await configGET(new Request("http://local/api/v1/config"));
    expect(recovered.headers.get("x-data-degraded")).toBeNull();
    expect(recovered.headers.get("cache-control")).toContain("s-maxage=60");
  });
});

describe("errores antes y después de una escritura", () => {
  const vote = () => submitRating({ venueId: id(4), stars: 5, visitorKey: "synthetic", ip: "192.0.2.1" });
  it.each(["GET", "HEAD"])("un fallo %s al comprobar el voto/límite diario impide escribir", async method => {
    failure = context => context.table === "venue_ratings" && context.method === method;
    await expect(vote()).rejects.toBeInstanceOf(DatabaseOperationError);
    expect(writes).toEqual([]);
  });
  it("un conteo exacto ausente no se interpreta como cero", async () => {
    missingCount = true;
    await expect(vote()).rejects.toBeInstanceOf(DatabaseOperationError);
    expect(writes).toEqual([]);
  });
  it("un voto guardado sigue confirmado si falla su relectura", async () => {
    failure = context => saved && context.table === "venues";
    expect(await vote()).toMatchObject({ ok: true, mine: 5, sum: null, count: null });
    expect(reportError).toHaveBeenCalledWith(expect.any(DatabaseOperationError), { vote_saved: true });
  });
  it("un upsert fallido no confirma el voto ni registra su evento", async () => {
    failure = context => context.table === "venue_ratings" && context.method === "POST";
    await expect(vote()).rejects.toBeInstanceOf(DatabaseOperationError);
    expect(saved).toBe(false);
    expect(writes).not.toContain("analytics_events");
  });
  it.each([
    ["negocio", () => recordVenueStat(id(4), "view")],
    ["plaza", () => recordVvnStat(id(2), "plaza")],
    ["promoción", () => recordPromotionStats([id(7)], "view")],
  ] as const)("un RPC fallido de %s no activa fallback ni registra eventos de éxito", async (_name, run) => {
    failure = context => context.table.startsWith("rpc/");
    await expect(run()).rejects.toBeInstanceOf(DatabaseOperationError);
    expect(writes).not.toContain("analytics_events");
    expect(calls.some(c => c.method === "PATCH")).toBe(false);
  });
  it("reporta un fallo de analítica sin desmentir el contador ya actualizado", async () => {
    failure = context => context.table === "analytics_events";
    expect(await recordVenueStat(id(4), "view")).toEqual({ ok: true });
    expect(reportError).toHaveBeenCalledWith(expect.any(DatabaseOperationError), expect.objectContaining({ operation: "logAnalyticsEvents" }));
  });
  it("un lote parcialmente fallido reporta error y registra analítica solo del RPC confirmado", async () => {
    tables.promotions.push({ ...tables.promotions[0], id: id(8) });
    failure = context => context.table.startsWith("rpc/") && context.body?.p_id === id(7);
    await expect(recordPromotionStats([id(7), id(8)], "view")).rejects.toBeInstanceOf(DatabaseOperationError);
    const event = vi.mocked(fetch).mock.calls.find(([input]) => String(input).includes("/analytics_events"));
    const payload = JSON.parse(String(event?.[1]?.body));
    expect(payload).toHaveLength(1);
    expect(payload[0].entity_id).toBe(id(8));
  });
});
