import { throwIfDatabaseError } from "@/server/data/database-error";
import { supabase } from "@/lib/supabase";
import { BlogPost, BlogCategory } from "@/types";

// Blog de zona "Vive Valle Norte". Lecturas públicas (RLS: select si is_active).
// Escritura solo desde server actions con service role (CRUD curado en /admin/blog).

function rowToBlogPost(row: Record<string, unknown>): BlogPost {
  return {
    id: row.id as string,
    title: row.title as string,
    slug: row.slug as string,
    excerpt: (row.excerpt as string) ?? "",
    body: (row.body as string) ?? "",
    cover_url: (row.cover_url as string | null) || null,
    category: row.category as BlogCategory,
    published_at: row.published_at as string,
    is_active: row.is_active as boolean,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** Posts visibles al público: activos y ya publicados (published_at <= ahora). */
export async function getPublishedBlogPosts(limit?: number): Promise<BlogPost[]> {
  const nowIso = new Date().toISOString();
  let query = supabase
    .from("blog_posts")
    .select("*")
    .eq("is_active", true)
    .lte("published_at", nowIso)
    .order("published_at", { ascending: false });

  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  throwIfDatabaseError(error, "getPublishedBlogPosts");
  return (data ?? []).map(rowToBlogPost);
}

/** Un post por slug, con las mismas reglas de visibilidad pública que la lista. */
export async function getBlogPostBySlug(slug: string): Promise<BlogPost | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .lte("published_at", nowIso)
    .maybeSingle();

  throwIfDatabaseError(error, "getBlogPostBySlug");
  if (!data) return null;
  return rowToBlogPost(data);
}
