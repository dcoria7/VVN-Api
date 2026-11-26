import { describe, expect, it } from "vitest";
import {
  buildVenuePath,
  isUuid,
  normalizeVenueNameSlug,
  parseVenueShortId,
} from "@/lib/venue-path";

// `resolve-venue.ts` construye `.ilike("id", \`${shortId}%\`)` con el segmento de
// la URL. Ese es el ÚNICO punto del código donde input de usuario llega a un
// filtro LIKE de PostgREST; si parseVenueShortId filtrara cualquier cosa que no
// sea exactamente 8 hex, entrarían wildcards (`%`, `_`) y sintaxis de filtro.
// Estos tests fijan esa validación como contrato de seguridad.

describe("parseVenueShortId — única entrada a .ilike en la DB", () => {
  it("acepta el formato legítimo: último segmento de exactamente 8 hex", () => {
    expect(parseVenueShortId("nombre-negocio-abc12345")).toBe("abc12345");
    expect(parseVenueShortId("abc12345")).toBe("abc12345");
    expect(parseVenueShortId("ABC12345")).toBe("abc12345"); // normaliza a minúsculas
  });

  const REJECTED = [
    "abc1234", // 7 chars
    "abc123456", // 9 chars
    "abcd234g", // no hex
    "%", // wildcard de ilike
    "%25", // wildcard urlencoded
    "_", // wildcard de 1 char en LIKE
    "____", // wildcard repetido
    "abc1234%", // hex + wildcard pegado
    "'; DROP TABLE venues;--",
    "' OR '1'='1",
    "1' UNION SELECT",
    "abc12345,def67890", // delimitador de listas de PostgREST
    "abc12345)", // cierre de expresión .or()
    "*.venues", // comodín PostgREST
    "../../etc", // path traversal
    "", // vacío
  ];

  it.each(REJECTED)("rechaza: %s", (evil) => {
    expect(parseVenueShortId(evil)).toBeNull();
    // También rechaza el payload si viene embebido en un segmento tipo slug.
    expect(parseVenueShortId(`slug-${evil}`)).toBeNull();
  });
});

describe("isUuid — entrada al .eq parametrizado", () => {
  it("acepta UUIDs válidos", () => {
    expect(isUuid("f3bd6937-7b28-4325-b056-e3a224027b7a")).toBe(true);
    expect(isUuid(" f3bd6937-7b28-4325-b056-e3a224027b7a ")).toBe(true); // recorta
  });

  it("rechaza cualquier cosa que no sea UUID estricto", () => {
    const evil = [
      "'; DROP TABLE venues;--",
      "' OR '1'='1",
      "1 OR 1=1",
      "f3bd6937-7b28-4325-b056-e3a224027b7a'", // comilla final
      "f3bd69377b284325b056e3a224027b7a", // sin guiones
      "zzzzzzzz-7b28-4325-b056-e3a224027b7a", // no hex
      "*",
      "%",
    ];
    for (const s of evil) expect(isUuid(s)).toBe(false);
  });
});

describe("normalizeVenueNameSlug — el fallback JS del resolve", () => {
  it("genera slugs seguros para URL (sin comillas ni SQL)", () => {
    expect(normalizeVenueNameSlug('Tony Pepperoni; DROP TABLE "venues"')).toBe(
      "tony-pepperoni-drop-table-venues",
    );
  });

  it("es idempotente y maneja acentos", () => {
    const slug = normalizeVenueNameSlug("Óptica OCI & Hijos");
    expect(slug).toBe("optica-oci-hijos");
    expect(normalizeVenueNameSlug(slug)).toBe(slug);
  });
});

describe("buildVenuePath", () => {
  it("usa el slug del nombre cuando lo hay", () => {
    expect(buildVenuePath("abc-12345", "Burger Lab")).toBe("/venue/burger-lab");
  });

  it("cae al id (validado después por isUuid/parseVenueShortId) sin nombre", () => {
    expect(buildVenuePath("abc-12345")).toBe("/venue/abc-12345");
    expect(buildVenuePath("abc-12345", "  ")).toBe("/venue/abc-12345");
  });
});
