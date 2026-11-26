import { describe, expect, it } from "vitest";
import {
  CACHE_PRIVATE,
  CACHE_READ,
  CACHE_READ_404,
  apiError,
  apiNotFound,
  apiOk,
  apiServerError,
} from "./respond";

// `respond.ts` es la pieza que decide si Vercel invoca o no la función: el
// `Cache-Control` y el 304. Hasta ahora solo lo verificaba un script contra un
// servidor levantado, que no corre en CI. Estos tests son puros.

const GET = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/v1/x", { headers });

describe("apiOk — envoltura y caché", () => {
  it("devuelve { ok: true, data } con la versión de la API", async () => {
    const res = apiOk(GET(), { hola: "mundo" });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Api-Version")).toBe("1");
    expect(await res.json()).toEqual({ ok: true, data: { hola: "mundo" } });
  });

  it("una lectura se cachea en el CDN y emite ETag", () => {
    const res = apiOk(GET(), { a: 1 }, CACHE_READ);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=300");
    expect(res.headers.get("ETag")).toMatch(/^"[\w-]+"$/);
  });

  it("el ETag es estable para el mismo cuerpo y distinto para otro", () => {
    const a = apiOk(GET(), { a: 1 }).headers.get("ETag");
    const b = apiOk(GET(), { a: 1 }).headers.get("ETag");
    const c = apiOk(GET(), { a: 2 }).headers.get("ETag");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("una respuesta PRIVADA no emite ETag", () => {
    // El hash del cuerpo delataría que dos visitantes recibieron lo mismo, y no
    // hay nada que revalidar en algo que no se cachea.
    const res = apiOk(GET(), { mine: 4 }, CACHE_PRIVATE);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_PRIVATE);
    expect(res.headers.get("ETag")).toBeNull();
  });

  it("acepta cabeceras extra (p. ej. Vary en la respuesta personalizada)", () => {
    const res = apiOk(GET(), {}, CACHE_PRIVATE, { Vary: "x-visitor-id" });
    expect(res.headers.get("Vary")).toBe("x-visitor-id");
  });
});

describe("apiOk — revalidación con If-None-Match", () => {
  function etagDe(data: unknown) {
    return apiOk(GET(), data).headers.get("ETag") as string;
  }

  it("responde 304 sin cuerpo con el ETag correcto", async () => {
    const etag = etagDe({ a: 1 });
    const res = apiOk(GET({ "If-None-Match": etag }), { a: 1 });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  it("el 304 conserva el Cache-Control (si no, el cliente pierde la política)", () => {
    const etag = etagDe({ a: 1 });
    const res = apiOk(GET({ "If-None-Match": etag }), { a: 1 }, CACHE_READ);
    expect(res.status).toBe(304);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=300");
    expect(res.headers.get("ETag")).toBe(etag);
  });

  it("con un ETag que no coincide devuelve 200 con cuerpo", async () => {
    const res = apiOk(GET({ "If-None-Match": '"otro"' }), { a: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("acepta el validador DÉBIL que puede agregar un proxy (W/)", () => {
    const etag = etagDe({ a: 1 });
    const res = apiOk(GET({ "If-None-Match": `W/${etag}` }), { a: 1 });
    expect(res.status).toBe(304);
  });

  it("acepta una LISTA de ETags separada por comas", () => {
    const etag = etagDe({ a: 1 });
    const res = apiOk(GET({ "If-None-Match": `"viejo", ${etag}` }), { a: 1 });
    expect(res.status).toBe(304);
  });

  it('acepta el comodín "*"', () => {
    expect(apiOk(GET({ "If-None-Match": "*" }), { a: 1 }).status).toBe(304);
  });
});

describe("apiError", () => {
  it("devuelve { ok: false, error } y no se cachea", async () => {
    const res = apiError("invalid", 400);
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(await res.json()).toEqual({ ok: false, error: "invalid" });
  });

  it("incluye el mensaje solo si se pasa", async () => {
    expect(await apiError("invalid_stars", 400, "Las estrellas van de 1 a 5.").json()).toEqual({
      ok: false,
      error: "invalid_stars",
      message: "Las estrellas van de 1 a 5.",
    });
  });

  it("un 404 de lectura SÍ se cachea, corto", () => {
    // Absorbe el escaneo de ids inventados sin dejar pegado un 404 que venga de
    // un hipo de la base.
    expect(apiNotFound(true).headers.get("Cache-Control")).toBe(CACHE_READ_404);
    expect(apiNotFound().headers.get("Cache-Control")).toContain("no-store");
  });
});

describe("apiServerError — nunca filtra el detalle al cliente", () => {
  it("responde 500 genérico aunque el error traiga un mensaje de Postgres", async () => {
    const res = apiServerError(
      "v1/test",
      new Error('relation "public.venues" does not exist at character 15'),
    );
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain("public.venues");
    expect(body).not.toContain("character 15");
    expect(JSON.parse(body)).toMatchObject({ ok: false, error: "server_error" });
  });
});
