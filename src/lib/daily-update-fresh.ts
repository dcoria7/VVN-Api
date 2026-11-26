/**
 * Las actualizaciones del día caducan a las 24 horas de haberse publicado
 * (ventana rodante desde `daily_updated_at`). No se borra el registro en DB:
 * simplemente deja de exponerse en el feed y en la ficha. El dueño la sigue
 * viendo/reemplazando por el bot y una nueva publicación reinicia la ventana.
 */
export const DAILY_UPDATE_TTL_MS = 24 * 60 * 60 * 1000;

/** true si la actualización sigue vigente (< 24h). Sin fecha ⇒ no vigente. */
export function isDailyUpdateFresh(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return false;
  const ts = new Date(updatedAt).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < DAILY_UPDATE_TTL_MS;
}

/** Corte ISO (now − 24h) para filtrar en queries de Supabase. */
export function dailyUpdateCutoffISO(): string {
  return new Date(Date.now() - DAILY_UPDATE_TTL_MS).toISOString();
}
