import "server-only";
import { brandEntityExists } from "@/server/data/brand-entities";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { logAnalyticsEvent } from "@/lib/track-server";
import type { TrackEvent } from "@/lib/track";
import { throwIfDatabaseError } from "@/server/data/database-error";
import { WRITE_NOT_FOUND, WRITE_OK, type WriteResult } from "./types";

// Cuerpo compartido de /api/vvn/stats (web) y /api/v1/stats/vvn (apps).

export type VvnStatKind = "plaza" | "parque";

export function isVvnStatKind(v: unknown): v is VvnStatKind {
  return v === "plaza" || v === "parque";
}

const EVENT_FOR: Record<VvnStatKind, TrackEvent> = {
  plaza: "plaza_view",
  parque: "parque_view",
};

const CONFIG: Record<VvnStatKind, { rpc: string; arg: string }> = {
  plaza: { rpc: "increment_plaza_views", arg: "plaza_id" },
  parque: { rpc: "increment_parque_views", arg: "parque_id" },
};

/** Incrementa `views` de una plaza o parque (RPC atómico y evento después del éxito). */
export async function recordVvnStat(
  id: string,
  kind: VvnStatKind,
  opts: { platform?: string | null } = {},
): Promise<WriteResult> {
  if (!await brandEntityExists(kind, id)) return WRITE_NOT_FOUND;
  const cfg = CONFIG[kind];
  const supabase = createSupabaseAdmin();

  const { error: rpcErr } = await supabase.rpc(cfg.rpc, { [cfg.arg]: id });
  throwIfDatabaseError(rpcErr, `recordVvnStat.${cfg.rpc}`);

  await logAnalyticsEvent(supabase, EVENT_FOR[kind], {
    entityType: kind,
    entityId: id,
    meta: opts.platform ? { platform: opts.platform } : null,
  });

  return WRITE_OK;
}
