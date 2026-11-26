/**
 * Script de contrato de la API móvil (/api/v1/*).
 *
 * Golpea cada endpoint contra un servidor local y valida FORMA de la respuesta,
 * código de estado y cabeceras de caché. No es un test unitario: se corre contra
 * un servidor real porque lo que verifica —el `Cache-Control` que decide si Vercel
 * invoca o no la función, el ETag/304, y los códigos de error— solo existe en la
 * respuesta HTTP.
 *
 *   npm run build && npx next start -p 3123
 *   npm run check:v1 -- http://localhost:3123
 *
 * Correrlo contra un BUILD DE PRODUCCIÓN, no `next dev`: en dev las rutas se
 * ejecutan siempre y el comportamiento de caché no se puede observar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXIGE LA URL Y SE NIEGA A ESCRIBIR
 *
 * El servidor local lee `.env.local`, que apunta al Supabase de PRODUCCIÓN. Tres
 * de estas comprobaciones hacen POST de verdad: dejan una fila en
 * `analytics_events` y un token falso en `device_tokens`. Ya pasó una vez: hubo
 * que borrar a mano un voto de prueba y diez eventos de la base real.
 *
 * Por eso: la URL base es obligatoria (sin default a localhost:3000, que invita
 * al accidente), las comprobaciones que escriben están detrás de `--writes`, y
 * `--writes` se niega a correr contra un Supabase de producción salvo que se pase
 * `ALLOW_PROD_WRITES=1` a mano. Sin `--writes` el script sigue siendo útil: valida
 * las 11 lecturas completas, los códigos 400/404/405 y todas las cabeceras.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Qué NO comprueba: que los datos sean correctos. Comprueba el contrato — que la
 * app móvil pueda deserializar lo que recibe y reaccionar a los errores.
 */

const args = process.argv.slice(2);
const WRITES = args.includes("--writes");
const baseArg = args.find((a) => !a.startsWith("--"));

if (!baseArg) {
  console.error(
    [
      "Falta la URL base.",
      "",
      "  npm run check:v1 -- http://localhost:3123",
      "",
      "Agrega --writes para incluir las 3 comprobaciones que ESCRIBEN en la base",
      "(una fila en analytics_events y un token falso en device_tokens).",
    ].join("\n"),
  );
  process.exit(1);
}

// Freno de producción: el servidor local lee .env.local, que apunta a prod.
if (WRITES) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const looksLikeProd = /\.supabase\.co/.test(supabaseUrl) && !/localhost|127\.0\.0\.1/.test(supabaseUrl);
  if (looksLikeProd && process.env.ALLOW_PROD_WRITES !== "1") {
    console.error(
      [
        "--writes apunta a un Supabase hospedado (probablemente producción):",
        `  ${supabaseUrl}`,
        "",
        "Estas comprobaciones insertan filas reales. Si de verdad es lo que quieres:",
        "  ALLOW_PROD_WRITES=1 npm run check:v1 -- <url> --writes",
        "",
        "y acuérdate de limpiar después. Sin --writes el script valida todo lo demás.",
      ].join("\n"),
    );
    process.exit(1);
  }
}

const BASE = baseArg.replace(/\/$/, "");
const API = `${BASE}/api/v1`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-4000-8000-000000000000";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(detail ? `${name} — ${detail}` : name);
    console.log(`  FALLA ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type Res = { status: number; headers: Headers; body: Record<string, unknown> };

async function req(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<Res> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`${API}${path}`, {
    ...rest,
    ...(json !== undefined
      ? {
          method: rest.method ?? "POST",
          headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) },
          body: JSON.stringify(json),
        }
      : {}),
  });
  let body: Record<string, unknown> = {};
  if (res.status !== 304) {
    body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }
  return { status: res.status, headers: res.headers, body };
}

/** Toda respuesta de v1 lleva la versión; las de éxito, `{ ok: true, data }`. */
function checkEnvelope(name: string, r: Res, expectStatus = 200) {
  check(`${name} → ${expectStatus}`, r.status === expectStatus, `recibido ${r.status}`);
  check(`${name} lleva X-Api-Version`, r.headers.get("x-api-version") === "1");
  if (expectStatus === 200) {
    check(`${name} responde ok:true con data`, r.body.ok === true && typeof r.body.data === "object");
  }
}

function checkPublicCache(name: string, r: Res, expectSMaxAge: number) {
  const cc = r.headers.get("cache-control") ?? "";
  check(
    `${name} cachea en CDN (s-maxage=${expectSMaxAge})`,
    cc.includes("public") && cc.includes(`s-maxage=${expectSMaxAge}`),
    `Cache-Control: ${cc}`,
  );
  check(`${name} emite ETag`, Boolean(r.headers.get("etag")), `ETag: ${r.headers.get("etag")}`);
}

async function checkEtag304(name: string, path: string) {
  const first = await req(path);
  const etag = first.headers.get("etag");
  if (!etag) return check(`${name} ETag/304`, false, "sin ETag");
  const second = await req(path, { headers: { "If-None-Match": etag } });
  check(`${name} revalida con 304`, second.status === 304, `recibido ${second.status}`);
}

async function main() {
  console.log(`\nContrato /api/v1 contra ${BASE}\n`);

  // ── config ────────────────────────────────────────────────────────────────
  console.log("GET /config");
  const config = await req("/config");
  checkEnvelope("/config", config);
  checkPublicCache("/config", config, 60);
  const cfg = config.body.data as Record<string, unknown>;
  for (const key of [
    "api_version",
    "min_app_version",
    "kill_switch",
    "default_fraccionamiento_slug",
    "contact",
    "plan_pro",
    "plan_free",
  ]) {
    check(`/config trae ${key}`, key in cfg);
  }
  const planPro = cfg.plan_pro as Record<string, unknown>;
  check("/config plan_pro.price_mxn es número", typeof planPro?.price_mxn === "number");
  check("/config plan_pro.features no está vacío", Array.isArray(planPro?.features) && planPro.features.length > 0);

  // ── fraccionamientos ──────────────────────────────────────────────────────
  console.log("\nGET /fraccionamientos");
  const fraccs = await req("/fraccionamientos");
  checkEnvelope("/fraccionamientos", fraccs);
  checkPublicCache("/fraccionamientos", fraccs, 300);
  const list = (fraccs.body.data as { fraccionamientos: Array<Record<string, unknown>> })
    .fraccionamientos;
  check("/fraccionamientos devuelve al menos uno", list.length > 0);
  const slug = list[0]?.slug as string;
  check("/fraccionamientos trae slug y name", typeof slug === "string" && typeof list[0]?.name === "string");

  console.log(`\nGET /fraccionamientos/${slug}`);
  const fracc = await req(`/fraccionamientos/${slug}`);
  checkEnvelope(`/fraccionamientos/${slug}`, fracc);
  checkPublicCache(`/fraccionamientos/${slug}`, fracc, 300);
  const fd = fracc.body.data as Record<string, unknown>;
  for (const key of ["fraccionamiento", "plazas", "parques", "venues", "announcements", "counts"]) {
    check(`payload trae ${key}`, key in fd);
  }
  const venues = fd.venues as Array<Record<string, unknown>>;
  check("venues trae is_pro y has_promo", venues.every((v) => "is_pro" in v && "has_promo" in v));

  // LA PARED: ningún endpoint devuelve negocios de ClickLocal general.
  check(
    "LA PARED: todos los venues tienen fraccionamiento_id",
    venues.every((v) => v.fraccionamiento_id != null),
    "¡hay un venue de ClickLocal general en la respuesta!",
  );

  // Campos privados del dueño: nunca salen.
  const leaked = new Set<string>();
  for (const v of venues) {
    for (const k of ["telegram_chat_id", "whatsapp_wa_id", "owner_id", "paid_until"]) {
      if (k in v) leaked.add(k);
    }
    if (v.contact && "bot_phone" in (v.contact as object)) leaked.add("contact.bot_phone");
  }
  check(
    "no se filtran campos privados del dueño",
    leaked.size === 0,
    `filtrados: ${[...leaked].join(", ")}`,
  );

  await checkEtag304(`/fraccionamientos/${slug}`, `/fraccionamientos/${slug}`);

  check("/fraccionamientos/{slug} inexistente → 404", (await req("/fraccionamientos/no-existe")).status === 404);
  check("/fraccionamientos/{slug} inválido → 400", (await req("/fraccionamientos/MAL_slug")).status === 400);

  // ── plazas y parques ──────────────────────────────────────────────────────
  const plazas = fd.plazas as Array<Record<string, unknown>>;
  if (plazas.length > 0) {
    console.log("\nGET /plazas/{id}");
    const plaza = await req(`/plazas/${plazas[0].id}`);
    checkEnvelope("/plazas/{id}", plaza);
    checkPublicCache("/plazas/{id}", plaza, 300);
    const pd = plaza.body.data as Record<string, unknown>;
    check("/plazas trae plaza y venues", "plaza" in pd && Array.isArray(pd.venues));
    check(
      "LA PARED en /plazas",
      (pd.venues as Array<Record<string, unknown>>).every((v) => v.fraccionamiento_id != null),
    );
  }
  check("/plazas/{id} inválido → 400", (await req("/plazas/123")).status === 400);
  check("/plazas/{id} inexistente → 404", (await req(`/plazas/${NIL_UUID}`)).status === 404);

  const parques = fd.parques as Array<Record<string, unknown>>;
  if (parques.length > 0) {
    console.log("\nGET /parques/{id}");
    const parque = await req(`/parques/${parques[0].id}`);
    checkEnvelope("/parques/{id}", parque);
    checkPublicCache("/parques/{id}", parque, 300);
    check("/parques trae parque", "parque" in (parque.body.data as object));
  }
  check("/parques/{id} inexistente → 404", (await req(`/parques/${NIL_UUID}`)).status === 404);

  // ── ficha de negocio ──────────────────────────────────────────────────────
  if (venues.length > 0) {
    const vid = venues[0].id as string;
    console.log("\nGET /venues/{id}");
    const venue = await req(`/venues/${vid}`);
    checkEnvelope("/venues/{id}", venue);
    checkPublicCache("/venues/{id}", venue, 300);
    const vd = venue.body.data as Record<string, unknown>;
    for (const key of ["venue", "menu_items", "services", "promotions", "photos", "plaza_card"]) {
      check(`ficha trae ${key}`, key in vd);
    }
    const v = vd.venue as Record<string, unknown>;
    check("ficha: is_pro es booleano", typeof v.is_pro === "boolean");
    check(
      "ficha: estado CRUDO (la app lo recalcula)",
      "status" in v && "opening_hours" in v && "status_override" in v && "status_override_until" in v,
    );
    check("ficha: contact anidado", typeof v.contact === "object" && "phone" in (v.contact as object));
    check("ficha: location anidado", typeof v.location === "object" && "lat" in (v.location as object));

    console.log("\nGET /venues/resolve");
    const resolved = await req(`/venues/resolve?path=${encodeURIComponent(String(vd.venue && (vd.venue as Record<string, unknown>).name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))}`);
    checkEnvelope("/venues/resolve", resolved);
    const rd = resolved.body.data as Record<string, unknown>;
    check("/venues/resolve devuelve un UUID", UUID_RE.test(String(rd?.id)));
  }
  check("/venues/{id} inválido → 400", (await req("/venues/no-es-uuid")).status === 400);
  check("/venues/{id} inexistente → 404", (await req(`/venues/${NIL_UUID}`)).status === 404);
  check("/venues/resolve sin path → 400", (await req("/venues/resolve")).status === 400);
  check("/venues/resolve inexistente → 404", (await req("/venues/resolve?path=no-existe-xyz")).status === 404);

  // ── feed, cupones, blog ───────────────────────────────────────────────────
  console.log("\nGET /feed");
  const feed = await req("/feed?limit=5");
  checkEnvelope("/feed", feed);
  checkPublicCache("/feed", feed, 300);
  const fed = feed.body.data as Record<string, unknown>;
  check("/feed trae announcements, venues, next_cursor, total",
    ["announcements", "venues", "next_cursor", "total"].every((k) => k in fed));
  check("/feed: los avisos exponen `text` (no la columna `body`)",
    (fed.announcements as Array<Record<string, unknown>>).every((a) => "text" in a && !("body" in a)));
  check("LA PARED en /feed",
    (fed.venues as Array<Record<string, unknown>>).every((v) => v.fraccionamiento_id != null));

  console.log("\nGET /cupones");
  const cupones = await req("/cupones");
  checkEnvelope("/cupones", cupones);
  checkPublicCache("/cupones", cupones, 300);
  const cd = cupones.body.data as Record<string, unknown>;
  check("/cupones trae groups y next_cursor", "groups" in cd && "next_cursor" in cd);
  for (const g of (cd.groups as Array<Record<string, unknown>>).slice(0, 3)) {
    check(
      "cupones: cada grupo trae identidad del negocio y sus promos",
      ["venue_id", "venue_name", "venue_logo_url", "venue_web_path", "promotions"].every((k) => k in g),
    );
    const promos = g.promotions as Array<Record<string, unknown>>;
    check(
      "cupones: la promo trae todo para pintar la tarjeta",
      promos.every((p) =>
        ["kind", "title", "description", "discount_label", "code", "image_url", "terms", "starts_at", "ends_at"].every(
          (k) => k in p,
        ),
      ),
    );
    const kinds = promos.map((p) => p.kind);
    check(
      "cupones: ofertas antes que cupones dentro del grupo",
      kinds.indexOf("promo") === -1 || kinds.lastIndexOf("promo") < (kinds.indexOf("coupon") === -1 ? Infinity : kinds.indexOf("coupon")),
    );
  }
  check("/cupones con fraccionamiento inexistente → 404",
    (await req("/cupones?fraccionamiento=no-existe")).status === 404);

  console.log("\nGET /blog");
  const blog = await req("/blog?limit=5");
  checkEnvelope("/blog", blog);
  checkPublicCache("/blog", blog, 60);
  const bd = blog.body.data as Record<string, unknown>;
  const posts = bd.posts as Array<Record<string, unknown>>;
  check("/blog trae posts y next_cursor", Array.isArray(posts) && "next_cursor" in bd);
  check("/blog: nada publicado a futuro (borradores fuera)",
    posts.every((p) => new Date(String(p.published_at)).getTime() <= Date.now()),
    "¡hay un post con published_at en el futuro!");
  check("/blog?cat inválida → 400", (await req("/blog?cat=inventada")).status === 400);

  if (posts.length > 0) {
    console.log("\nGET /blog/{slug}");
    const post = await req(`/blog/${posts[0].slug}`);
    checkEnvelope("/blog/{slug}", post);
    checkPublicCache("/blog/{slug}", post, 60);
    const pd = post.body.data as Record<string, unknown>;
    check("/blog/{slug} trae post y venue_cards (resueltas)", "post" in pd && "venue_cards" in pd);
  }
  check("/blog/{slug} inexistente → 404", (await req("/blog/no-existe")).status === 404);

  // ── escrituras ────────────────────────────────────────────────────────────
  console.log("\nEscrituras");

  // La calificación es la ÚNICA respuesta personalizada: jamás en el CDN.
  if (venues.length > 0) {
    const rating = await req(`/ratings?venueId=${venues[0].id}`, {
      headers: { "X-Visitor-Id": "11111111-1111-4111-8111-111111111111" },
    });
    checkEnvelope("/ratings GET", rating);
    const cc = rating.headers.get("cache-control") ?? "";
    check(
      "/ratings GET NO se cachea (private, no-store)",
      cc.includes("private") && cc.includes("no-store"),
      `Cache-Control: ${cc}`,
    );
    check("/ratings GET sin ETag (no hay nada que revalidar)", !rating.headers.get("etag"));
    check("/ratings GET lleva Vary: x-visitor-id", (rating.headers.get("vary") ?? "").toLowerCase().includes("x-visitor-id"));
    const rdata = rating.body.data as Record<string, unknown>;
    check("/ratings GET trae sum, count, mine", ["sum", "count", "mine"].every((k) => k in rdata));
  }

  check("/ratings POST con estrellas inválidas → 400 invalid_stars",
    (await req("/ratings", { json: { venueId: NIL_UUID, stars: 9 } })).body.error === "invalid_stars");
  check("/ratings POST con venueId inválido → 400",
    (await req("/ratings", { json: { venueId: "x", stars: 5 } })).status === 400);

  check("/stats/venue con kind inválido → 400",
    (await req("/stats/venue", { json: { venueId: NIL_UUID, kind: "nope" } })).status === 400);
  check("/stats/vvn con kind inválido → 400",
    (await req("/stats/vvn", { json: { id: NIL_UUID, kind: "nope" } })).status === 400);
  check("/stats/promotions sin ids → 400",
    (await req("/stats/promotions", { json: { kind: "view" } })).status === 400);

  // ── A partir de aquí, lo que ESCRIBE (solo con --writes) ─────────────────
  if (!WRITES) {
    console.log("  (omitidas las comprobaciones que escriben en la base; usa --writes)");
  } else {
    const firstGroup = (cd.groups as Array<Record<string, unknown>>)[0];
    const firstPromo = (firstGroup?.promotions as Array<Record<string, unknown>> | undefined)?.[0];
    if (firstPromo) {
      const promoBatch = await req("/stats/promotions", { json: { ids: [firstPromo.id], kind: "view" } });
      check("/stats/promotions con ID propio → 200", promoBatch.status === 200);
      const pdata = promoBatch.body.data as Record<string, unknown>;
      check("/stats/promotions dice cuántos registró (no trunca en silencio)",
        typeof pdata.recorded === "number" && typeof pdata.received === "number" && typeof pdata.max_per_request === "number");
    }

    check("/track acepta un evento de app",
      (await req("/track", { json: { event: "app_open", platform: "ios" } })).status === 200);

    const device = await req("/devices", {
      json: { token: `contract-test-${Date.now()}`, platform: "ios", fraccionamientoSlug: slug, topics: ["ofertas"], appVersion: "1.0.0" },
    });
    if (device.status === 503) {
      check("/devices sin contrato por marca → 503 unavailable", device.body.error === "unavailable");
    } else {
      checkEnvelope("/devices", device);
    }
    console.log("  nota  --writes dejó filas de prueba en la base. Límpialas.");
  }

  // El guard que evita el doble conteo: los eventos con contraparte en columna.
  for (const event of ["venue_view", "promo_view", "rating_submit"]) {
    const r = await req("/track", { json: { event } });
    check(`/track rechaza ${event} (lo escribe solo el servidor)`,
      r.status === 400 && r.body.error === "invalid_event",
      `recibido ${r.status} ${JSON.stringify(r.body)}`);
  }
  check("/track rechaza un evento fuera de whitelist → 400 invalid_event",
    (await req("/track", { json: { event: "inventado" } })).body.error === "invalid_event");
  check("/devices sin token → 400", (await req("/devices", { json: { platform: "ios" } })).status === 400);
  check("/devices con plataforma inválida → 400",
    (await req("/devices", { json: { token: "abc", platform: "windows" } })).status === 400);

  // ── métodos no soportados ─────────────────────────────────────────────────
  console.log("\nMétodos");
  check("GET a una ruta de escritura → 405", (await req("/stats/venue", { method: "GET" })).status === 405);
  check("POST a una ruta de lectura → 405", (await req("/config", { method: "POST" })).status === 405);

  console.log(`\n${passed} comprobaciones OK, ${failures.length} fallas`);
  if (failures.length > 0) {
    console.log("\nFallas:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\nEl script no pudo terminar:", e instanceof Error ? e.message : e);
  console.error("¿Está corriendo el servidor? npm run build && npx next start -p 3123");
  process.exit(1);
});
