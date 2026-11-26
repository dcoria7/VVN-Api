import { getPublishedBlogPosts } from "@/services/blog";
import { parseCursor, parseLimit, paginate } from "@/server/api/dto";
import { CACHE_READ_SHORT, apiInvalid, apiOk, apiServerError } from "@/server/api/respond";
import type { BlogCategory } from "@/types";

const CATEGORIES: BlogCategory[] = ["guia", "evento", "anuncio", "noticia"];

/**
 * GET /api/v1/blog?cat=&limit=&cursor=
 *
 * Posts publicados, más recientes primero.
 *
 * ⚠️ La RLS de `blog_posts` solo filtra `is_active`: la condición
 * `published_at <= now()` la aplica la APLICACIÓN. Por eso se usa
 * `getPublishedBlogPosts`, que ya la aplica — una query propia aquí publicaría
 * borradores.
 */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const limit = parseLimit(params.get("limit"));
    const offset = parseCursor(params.get("cursor"));
    const cat = params.get("cat")?.trim() || null;

    if (cat && !CATEGORIES.includes(cat as BlogCategory)) return apiInvalid();

    const all = await getPublishedBlogPosts();
    const filtered = cat ? all.filter((p) => p.category === cat) : all;
    const page = paginate(filtered, limit, offset);

    return apiOk(
      req,
      { posts: page.items, next_cursor: page.next_cursor, total: page.total },
      CACHE_READ_SHORT,
    );
  } catch (e) {
    return apiServerError("v1/blog", e);
  }
}
