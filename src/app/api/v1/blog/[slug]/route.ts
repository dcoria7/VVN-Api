import { getBlogPostBySlug } from "@/services/blog";
import { getBlogVenueCards } from "@/services/blog-venues";
import { extractVenueSlugs } from "@/lib/blog-body-refs";
import { isSlugParam, normalizeSlugParam } from "@/server/api/dto";
import {
  CACHE_READ_SHORT,
  apiInvalid,
  apiNotFound,
  apiOk,
  apiServerError,
} from "@/server/api/respond";

/**
 * GET /api/v1/blog/{slug}
 *
 * El post completo con las tarjetas de negocio que referencia el cuerpo ya
 * RESUELTAS (`venue_cards`): el cuerpo trae líneas `@venue:slug | descripción` y si
 * la app tuviera que resolverlas una por una haría N llamadas al abrir un post.
 *
 * Misma regla de visibilidad que la lista: activo y `published_at <= now()`
 * (`getBlogPostBySlug` ya la aplica).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/blog/[slug]">) {
  try {
    const { slug } = await ctx.params;
    if (!isSlugParam(slug)) return apiInvalid();

    const post = await getBlogPostBySlug(normalizeSlugParam(slug));
    if (!post) return apiNotFound(true);

    const venueCards = await getBlogVenueCards(extractVenueSlugs(post.body));

    return apiOk(req, { post, venue_cards: venueCards }, CACHE_READ_SHORT);
  } catch (e) {
    return apiServerError("v1/blog/[slug]", e);
  }
}
