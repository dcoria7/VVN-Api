import { supabase } from "@/lib/supabase";
import { throwIfDatabaseError } from "@/server/data/database-error";
import { VvnAnnouncement } from "@/types";

function rowToAnnouncement(row: Record<string, unknown>): VvnAnnouncement {
  return {
    id: row.id as string,
    title: (row.title as string) ?? "",
    text: (row.body as string) ?? "",
    is_active: row.is_active as boolean,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * Avisos "de la casa" visibles al público, más recientes primero.
 *
 * Una lista vacía significa que no hay avisos. Los fallos se propagan para no
 * cachear un feed incompleto como si fuera una lectura correcta.
 */
export async function getActiveVvnAnnouncements(): Promise<VvnAnnouncement[]> {
  const { data, error } = await supabase
    .from("vvn_announcements")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  throwIfDatabaseError(error, "getActiveVvnAnnouncements");
  return (data ?? []).map(rowToAnnouncement);
}
