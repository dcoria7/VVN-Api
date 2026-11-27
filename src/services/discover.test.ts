import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deploymentBrandId } from "@/lib/deployment-brand";
import { getFeaturedVenues, getSponsoredCampaigns, discoverCacheControl } from "./discover";
import { GET } from "@/app/api/v1/descubre/route";
import { recordTrackEvent } from "@/server/stats/track";

vi.mock("@/lib/supabase-admin", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { scopeBrandClient } = await import("@/lib/brand-client");
  const { deploymentBrandId } = await import("@/lib/deployment-brand");
  const db = scopeBrandClient(createClient("http://127.0.0.1:54321", "synthetic", {
    accessToken: async () => "operator", auth: { persistSession: false },
    global: { fetch: (input, init) => globalThis.fetch(input, init) },
  }), deploymentBrandId);
  return { createSupabaseAdmin: () => db };
});
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn() }));

const id = (n: number) => `${String(n).padStart(8,"0")}-1111-4111-8111-111111111111`;
type Row = Record<string, any>;
let tables: Record<string, Row[]>;
let failTable: string | null;
let calls: URL[];
let writes: Row[];
const now = "2026-11-26T18:00:00Z";
const live = { brand_id: deploymentBrandId, is_active: true, starts_at: "2020-01-01T00:00:00Z", ends_at: null, position: 0, created_at: now };

beforeEach(() => {
  failTable = null; calls = []; writes = [];
  const venue = { id: id(2), brand_id: deploymentBrandId, is_active: true, fraccionamiento_id: id(3), plaza_id: id(4),
    name: "Local de prueba", type: "food", owner_id: "PRIVATE_OWNER", bot_phone: "PRIVATE_PHONE", telegram_chat_id: "PRIVATE_CHAT", status: "open" };
  tables = {
    vvn_featured_venues: [{ ...live, id: id(1), venue_id: id(2), venue }],
    vvn_sponsored_campaigns: [{ ...live, id: id(5), title: "Casa en renta", kind: "property_rent", image_url: "https://example.com/casa.jpg", target_type: "url", target_url: "https://example.com/casa", cta_label: "Ver casa", fraccionamiento_id: null }],
    venues: [venue], promotions: [], plazas: [{ id: id(4), brand_id: deploymentBrandId, name: "Plaza de prueba" }],
    fraccionamientos: [{ id: id(3), brand_id: deploymentBrandId, slug: "capital-norte", name: "Capital Norte" }],
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); calls.push(url);
    expect(url.origin).toBe("http://127.0.0.1:54321");
    const table = url.pathname.split('/').at(-1)!;
    expect(url.searchParams.get("brand_id") === `eq.${deploymentBrandId}` || init?.method === "POST").toBe(true);
    if (table === failTable) return Response.json({ code: "XX000", message: "PRIVATE_FAILURE" }, { status: 500 });
    if (init?.method === "POST") { writes.push(JSON.parse(String(init.body))); return new Response(null, {status:201}); }
    let rows = [...(tables[table] ?? [])];
    for (const [key, value] of url.searchParams) {
      const read = (row: Row) => key.split('.').reduce((v, k) => v?.[k], row);
      if (value.startsWith("eq.")) rows = rows.filter(row => String(read(row)) === value.slice(3));
      if (value.startsWith("in.(")) rows = rows.filter(row => value.slice(4,-1).split(',').includes(String(read(row))));
      if (value === "not.is.null") rows = rows.filter(row => read(row) != null);
      if (value.startsWith("lte.")) rows = rows.filter(row => String(read(row)) <= value.slice(4));
    }
    rows.sort((a,b) => (a.position ?? 0)-(b.position ?? 0) || String(a.id).localeCompare(String(b.id)));
    return Response.json(rows);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const request = (path = "", headers: Record<string,string> = {}) => new Request(`http://localhost/api/v1/descubre${path}`, {headers});

describe("swimlanes de Descubre", () => {
  it("devuelve el DTO del directorio y destinos de patrocinio independientes, sin escribir impresiones", async () => {
    const response = await GET(request()); const {data} = await response.json();
    expect(response.status).toBe(200);
    expect(data.featured_venues.visible).toBe(true);
    expect(data.sponsored.visible).toBe(true);
    expect(data.featured_venues.items[0].placement_id).toBe(id(1));
    const venue = data.featured_venues.items[0].venue;
    expect(venue.id).toBe(id(2)); expect(venue).toHaveProperty("has_promo", false);
    expect(venue).not.toHaveProperty("owner_id"); expect(venue.contact).not.toHaveProperty("bot_phone");
    expect(data.plazas).toEqual([{id:id(4),name:"Plaza de prueba"}]);
    expect(data.sponsored.items[0]).toMatchObject({id:id(5),label:"Patrocinado",kind:"property_rent",target:{type:"url",url:"https://example.com/casa"}});
    expect(writes).toEqual([]);
  });
  it("listas vacías son 200; un fallo no se convierte en contenido vacío cacheable", async () => {
    tables.vvn_featured_venues=[];tables.vvn_sponsored_campaigns=[];
    const empty=(await (await GET(request())).json()).data;
    expect(empty.featured_venues).toMatchObject({visible:false,items:[],total:0,next_cursor:null});
    expect(empty.sponsored).toMatchObject({visible:false,items:[],total:0,next_cursor:null});
    failTable="vvn_sponsored_campaigns";
    const response=await GET(request());expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("PRIVATE_FAILURE");
  });
  it("omite inactivos, programados, vencidos y negocios que dejaron de estar activos", async () => {
    const placement=tables.vvn_featured_venues[0];
    tables.vvn_featured_venues=[{...placement,is_active:false},{...placement,starts_at:"2099-01-01T00:00:00Z"},{...placement,ends_at:now},{...placement,venue:{...placement.venue,is_active:false}}];
    expect(await getFeaturedVenues(null,now)).toEqual([]);
  });
  it("no publica destinos inseguros ni campañas dirigidas a otra zona", async () => {
    const campaign=tables.vvn_sponsored_campaigns[0];
    tables.vvn_sponsored_campaigns=[{...campaign,target_url:"javascript:alert(1)"},{...campaign,fraccionamiento_id:id(9)}];
    expect(await getSponsoredCampaigns(id(3),now)).toEqual([]);
    const query=calls.find(url=>url.pathname.endsWith('vvn_sponsored_campaigns'))!;
    expect(query.searchParams.getAll('or')).toHaveLength(1);
    expect(query.searchParams.get('or')).toContain('fraccionamiento_id');
  });
  it("resuelve patrocinados de negocio sin convertir todos los patrocinados en venues", async () => {
    const campaign=tables.vvn_sponsored_campaigns[0];
    tables.vvn_sponsored_campaigns=[{...campaign,kind:"venue",target_type:"venue",venue_id:id(2),target_url:null}];
    expect((await getSponsoredCampaigns(null,now))[0].target).toMatchObject({type:"venue",venue_id:id(2)});
    tables.venues[0].is_active=false;
    expect(await getSponsoredCampaigns(null,now)).toEqual([]);
  });
  it("filtra por fraccionamiento y rechaza parámetros/zonas inexistentes", async () => {
    expect((await GET(request('?fraccionamiento=bad%2Fslug'))).status).toBe(400);
    expect((await GET(request('?fraccionamiento=ausente'))).status).toBe(404);
    const response=await GET(request('?fraccionamiento=capital-norte'));
    expect(response.status).toBe(200);
    const query=calls.find(url=>url.pathname.endsWith('vvn_featured_venues'))!;
    expect(query.searchParams.get('venue.fraccionamiento_id')).toBe(`eq.${id(3)}`);
  });
  it("pagina ambos carruseles por separado y emite ETag/304", async () => {
    const first=tables.vvn_featured_venues[0];
    tables.vvn_featured_venues.push({...first,id:id(6),position:1});
    const a=await GET(request('?limit=1'));const body=await a.json();
    expect(body.data.featured_venues.total).toBe(2);expect(body.data.featured_venues.next_cursor).not.toBeNull();
    const b=await GET(request(`?limit=1&featured_cursor=${body.data.featured_venues.next_cursor}`));
    expect((await b.json()).data.featured_venues.items[0].placement_id).toBe(id(6));
    expect((await GET(request('?limit=1',{'If-None-Match':a.headers.get('etag')!}))).status).toBe(304);
  });
  it("la caché no sobrevive al vencimiento", () => {
    expect(discoverCacheControl([{starts_at:now,ends_at:"2026-11-26T18:00:10Z"}],now)).toContain('s-maxage=10');
    expect(discoverCacheControl([],now)).toContain('s-maxage=60');
    expect(discoverCacheControl([{starts_at:now,ends_at:now}],now)).toContain('s-maxage=0');
  });
});

describe("medición de los carruseles", () => {
  it("atribuye impresiones y aperturas al destacado sin duplicar venue_view", async () => {
    const result=await recordTrackEvent({event:"featured_open",entityType:"venue",entityId:id(2),meta:{placement_id:id(1)}},{platform:"ios"});
    expect(result).toEqual({ok:true});expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({event_type:"featured_open",entity_id:id(2),meta:{placement_id:id(1),platform:"ios"}});
  });
  it("admite campañas no venue y rechaza campañas inventadas o vencidas", async () => {
    expect(await recordTrackEvent({event:"sponsored_click",meta:{campaign_id:id(5)}},{platform:"android"})).toEqual({ok:true});
    expect(writes[0]).toMatchObject({entity_id:null,meta:{campaign_id:id(5),platform:"android"}});
    expect(await recordTrackEvent({event:"sponsored_impression",meta:{campaign_id:id(9)}})).toEqual({ok:false,reason:"invalid"});
    tables.vvn_sponsored_campaigns[0].ends_at="2020-01-02T00:00:00Z";
    expect(await recordTrackEvent({event:"sponsored_click",meta:{campaign_id:id(5)}})).toEqual({ok:false,reason:"invalid"});
  });
  it("exige contexto coherente y preserva la atribución dentro del presupuesto de meta", async () => {
    expect(await recordTrackEvent({event:"featured_impression",entityType:"venue",entityId:id(9),meta:{placement_id:id(1)}})).toEqual({ok:false,reason:"invalid"});
    expect(await recordTrackEvent({event:"sponsored_click",entityType:"venue",entityId:id(2),meta:{campaign_id:id(5)}})).toEqual({ok:false,reason:"invalid"});
    const meta=Object.fromEntries(Array.from({length:10},(_,n)=>[`key${n}`,"value"]));
    expect(await recordTrackEvent({event:"sponsored_impression",meta:{...meta,campaign_id:id(5)}},{platform:"ios"})).toEqual({ok:true});
    expect(writes[0].meta.campaign_id).toBe(id(5));expect(Object.keys(writes[0].meta)).toHaveLength(8);
  });
});
