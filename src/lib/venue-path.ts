const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function slugifyName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function buildVenuePath(id: string, name?: string | null): string {
  const trimmedId = id.trim();
  if (!name?.trim()) return `/venue/${trimmedId}`;
  const slug = slugifyName(name);
  if (!slug) return `/venue/${trimmedId}`;
  return `/venue/${slug}`;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function parseVenueShortId(segment: string): string | null {
  const parts = segment.trim().split("-");
  const maybeShortId = parts[parts.length - 1] ?? "";
  if (/^[0-9a-f]{8}$/i.test(maybeShortId)) return maybeShortId.toLowerCase();
  return null;
}

export function normalizeVenueNameSlug(name: string): string {
  return slugifyName(name.trim());
}
