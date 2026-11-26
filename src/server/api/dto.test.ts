import { describe, expect, it } from "vitest";
import {
  MAX_LIMIT,
  isSlugParam,
  isUuidParam,
  normalizeSlugParam,
  paginate,
  parseCursor,
  parseLimit,
  toApiVenue,
  toApiVenues,
} from "./dto";
import { isVenuePro } from "@/lib/venue-pro";
import { deploymentBrandId } from "@/lib/deployment-brand";
import type { Venue } from "@/types";

// Estos tests cubren tres cosas que hoy solo verificaba un script contra un
// servidor levantado (y que por tanto no corre en CI):
//
//  1. Que la lista blanca de `toApiVenue` NO publique los campos privados del
//     dueño. Es el modo de fallo caro: si alguien agrega una columna a `Venue` y
//     el DTO la deja pasar, se publica el teléfono o el chat de un dueño en un
//     JSON paginable, y nada avisa.
//  2. La pared ClickLocal/VVN en el DTO.
//  3. Los helpers puros de paginación y validación, donde un off-by-one se cuela
//     sin ruido.

/** Venue completo y realista; cada test cambia solo lo que le interesa. */
function makeVenue(over: Partial<Venue> = {}): Venue {
  return {
    brand_id: deploymentBrandId,
    id: "543882c2-41cf-4c44-a587-972a0842fbbf",
    name: "Panadería La Espiga",
    type: "food",
    description: "Pan artesanal",
    status: "open",
    status_updated_at: "2026-10-19T10:00:00Z",
    opening_hours: null,
    status_override: null,
    status_override_until: null,
    is_active: true,
    contact: {
      phone: "523312345678",
      bot_phone: "523399999999",
      instagram: "https://instagram.com/espiga",
      cta: "whatsapp",
      website_url: null,
    },
    location: {
      lat: 20.78,
      lng: -103.42,
      reference: "Plaza Altures, local 4",
      address: "Av. Principal 100",
      is_ambulatory: false,
      is_closed_door: false,
    },
    media: { logo_url: "https://x/logo.webp", cover_url: "https://x/cover.webp" },
    daily_update: null,
    stats: {
      views: 10,
      whatsapp_taps: 2,
      website_taps: 0,
      rating_sum: 8,
      rating_count: 2,
    },
    tags: ["pan"],
    category: "panaderia",
    owner_id: "admin",
    telegram_chat_id: "123456789",
    whatsapp_wa_id: "5215512345678",
    catalog_pdf_url: null,
    catalog_updated_on: null,
    fraccionamiento_id: "f3bd6937-7b28-4325-b056-e3a224027b7a",
    plaza_id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    local_number: "4",
    floor: "PB",
    location_note: null,
    is_premium: false,
    is_featured: false,
    paid_until: "2026-12-01T00:00:00Z",
    is_deprioritized: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-10-19T10:00:00Z",
    ...over,
  };
}

describe("toApiVenue — los campos privados del dueño NUNCA salen", () => {
  // `bot_phone`, `telegram_chat_id` y `whatsapp_wa_id` son el teléfono personal y
  // el chat con los que el dueño edita su ficha por bot. En un JSON paginable
  // serían un directorio enumerable.
  it.each(["brand_id", "telegram_chat_id", "whatsapp_wa_id", "owner_id", "paid_until"])(
    "no expone %s",
    (field) => {
      const api = toApiVenue(makeVenue()) as unknown as Record<string, unknown>;
      expect(field in api).toBe(false);
    },
  );

  it("no expone contact.bot_phone pero sí el teléfono público", () => {
    const api = toApiVenue(makeVenue());
    expect("bot_phone" in api.contact).toBe(false);
    expect(api.contact.phone).toBe("523312345678");
  });

  it("tampoco salen serializando a JSON (no quedan como undefined)", () => {
    const raw = JSON.stringify(toApiVenue(makeVenue()));
    for (const secret of ["523399999999", "123456789", "5215512345678", "paid_until"]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("si alguien agrega una columna privada a Venue, NO se publica sola", () => {
    // La lista blanca es explícita a propósito: una columna nueva solo aparece si
    // alguien la agrega a mano al DTO. Este test documenta ese contrato.
    const venue = makeVenue();
    const conUnaColumnaNueva = { ...venue, internal_secret_note: "no publicar" } as Venue;
    const api = toApiVenue(conUnaColumnaNueva) as unknown as Record<string, unknown>;
    expect("internal_secret_note" in api).toBe(false);
  });
});

describe("toApiVenue — campos calculados por el servidor", () => {
  it("is_pro sigue la regla canónica", () => {
    expect(toApiVenue(makeVenue({ is_premium: false })).is_pro).toBe(false);
    expect(toApiVenue(makeVenue({ is_premium: true })).is_pro).toBe(true);
  });

  it("has_promo es false cuando no se pasa el set", () => {
    expect(toApiVenue(makeVenue()).has_promo).toBe(false);
  });

  it("has_promo es true solo para los ids del set", () => {
    const v = makeVenue();
    expect(toApiVenue(v, new Set([v.id])).has_promo).toBe(true);
    expect(toApiVenue(v, new Set(["otro-id"])).has_promo).toBe(false);
  });

  it("el estado viaja CRUDO para que el cliente lo recalcule con su reloj", () => {
    const api = toApiVenue(
      makeVenue({
        opening_hours: [{ closed: false, open: "08:00", close: "21:00" }],
        status_override: "closed",
        status_override_until: "2026-10-20T06:00:00Z",
      }),
    );
    expect(api.status).toBe("open");
    expect(api.opening_hours).toHaveLength(1);
    expect(api.status_override).toBe("closed");
    expect(api.status_override_until).toBe("2026-10-20T06:00:00Z");
  });
});

describe("isVenuePro — la regla canónica de capado", () => {
  it.each([
    ["ClickLocal general (sin fraccionamiento)", null, false, true],
    ["ClickLocal general premium", null, true, true],
    ["VVN sin pagar", "f3bd6937-7b28-4325-b056-e3a224027b7a", false, false],
    ["VVN pagado", "f3bd6937-7b28-4325-b056-e3a224027b7a", true, true],
  ])("%s → is_pro %s", (_caso, fraccId, premium, esperado) => {
    expect(
      isVenuePro({ fraccionamiento_id: fraccId as string | null, is_premium: premium as boolean }),
    ).toBe(esperado);
  });
});

describe("toApiVenues — la pared ClickLocal/VVN", () => {
  it("descarta otra marca aunque tenga fraccionamiento", () => {
    expect(toApiVenues([makeVenue({ brand_id: "22222222-2222-4222-8222-222222222222" })])).toEqual([]);
  });
  it("descarta los negocios de ClickLocal general", () => {
    const vvn = makeVenue({ id: "11111111-1111-4111-8111-111111111111" });
    const clickLocal = makeVenue({
      id: "22222222-2222-4222-8222-222222222222",
      fraccionamiento_id: null,
      plaza_id: null,
    });
    const out = toApiVenues([vvn, clickLocal]);
    expect(out.map((v) => v.id)).toEqual([vvn.id]);
  });

  it("una lista entera de ClickLocal general sale vacía, no a medias", () => {
    expect(toApiVenues([makeVenue({ fraccionamiento_id: null })])).toEqual([]);
  });
});

describe("parseLimit", () => {
  it("usa el default cuando no viene", () => {
    expect(parseLimit(null)).toBe(50);
  });

  it.each(["0", "-5", "abc", "1.5", ""])("ignora el valor inválido %s", (v) => {
    expect(parseLimit(v)).toBe(50);
  });

  it("recorta al máximo", () => {
    expect(parseLimit("99999")).toBe(MAX_LIMIT);
    // Number("1e9") sí es entero, así que pasa el guard y se recorta igual.
    expect(parseLimit("1e9")).toBe(MAX_LIMIT);
  });

  it("respeta un valor válido", () => {
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("100")).toBe(100);
  });
});

describe("parseCursor", () => {
  it("sin cursor empieza en 0", () => {
    expect(parseCursor(null)).toBe(0);
  });

  it.each(["' OR 1=1--", "no-es-base64!!", "LTU=" /* -5 */, "YWJj" /* abc */])(
    "un cursor basura cae a 0 en vez de lanzar: %s",
    (v) => {
      expect(parseCursor(v)).toBe(0);
    },
  );

  it("hace ida y vuelta con el cursor que emite paginate", () => {
    const page = paginate([1, 2, 3, 4, 5], 2, 0);
    expect(parseCursor(page.next_cursor)).toBe(2);
  });
});

describe("paginate", () => {
  const items = [1, 2, 3, 4, 5];

  it("primera página con cursor siguiente", () => {
    const p = paginate(items, 2, 0);
    expect(p.items).toEqual([1, 2]);
    expect(p.total).toBe(5);
    expect(p.next_cursor).not.toBeNull();
  });

  it("la última página no trae cursor", () => {
    expect(paginate(items, 2, 4).next_cursor).toBeNull();
  });

  it("recorre la lista completa sin repetir ni saltar", () => {
    const visto: number[] = [];
    let offset = 0;
    for (let i = 0; i < 10; i++) {
      const p = paginate(items, 2, offset);
      visto.push(...p.items);
      if (!p.next_cursor) break;
      offset = parseCursor(p.next_cursor);
    }
    expect(visto).toEqual(items);
  });

  it("un offset más allá del final devuelve vacío y cierra", () => {
    const p = paginate(items, 2, 99);
    expect(p.items).toEqual([]);
    expect(p.next_cursor).toBeNull();
    expect(p.total).toBe(5);
  });
});

describe("validación de parámetros", () => {
  it("isUuidParam solo acepta UUID bien formado", () => {
    expect(isUuidParam("543882c2-41cf-4c44-a587-972a0842fbbf")).toBe(true);
    for (const malo of ["", "abc", "543882c2-41cf-4c44-a587-972a0842fbb", null, 42, {}]) {
      expect(isUuidParam(malo)).toBe(false);
    }
  });

  it("isSlugParam acota el charset", () => {
    expect(isSlugParam("capital-norte")).toBe(true);
    expect(isSlugParam("imperial-fitness-club-543882c2")).toBe(true);
    for (const malo of ["con espacios", "../../etc/passwd", "'; DROP TABLE venues;--", "-empieza-con-guion", "a".repeat(200)]) {
      expect(isSlugParam(malo)).toBe(false);
    }
  });

  it("isSlugParam tolera mayúsculas y normalizeSlugParam las baja", () => {
    expect(isSlugParam("CAPITAL-NORTE")).toBe(true);
    expect(normalizeSlugParam("  CAPITAL-Norte ")).toBe("capital-norte");
  });
});
