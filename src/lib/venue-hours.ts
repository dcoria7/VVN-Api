import type { DayHours, OpeningHours, Venue, VenueStatus } from "@/types";

// Horario de atención y estado automático abierto/cerrado.
//
// Regla clave de zona horaria: el horario del negocio está en hora de
// Guadalajara (America/Mexico_City). "Ahora" se calcula SIEMPRE en esa zona con
// Intl —no con el reloj del dispositivo— para que el estado sea correcto para
// cualquier visitante sin importar su ubicación, y también en el servidor (UTC).

const TZ = "America/Mexico_City";

/** Etiquetas de los días, índice 0=Lunes … 6=Domingo (orden del arreglo). */
export const DAY_LABELS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
] as const;

/** Horario por defecto al activar el horario en el admin: todos los días 9–20. */
export function defaultOpeningHours(): OpeningHours {
  return Array.from({ length: 7 }, () => ({ closed: false, open: "09:00", close: "20:00" }));
}

/** "HH:mm" → minutos desde medianoche. Devuelve null si el formato es inválido. */
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm?.trim() ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Un día del arreglo, ya saneado. Devuelve null si el índice no existe. */
function dayAt(hours: OpeningHours, index: number): DayHours | null {
  const d = hours[index];
  if (!d || typeof d.open !== "string" || typeof d.close !== "string") return null;
  return d;
}

/** Momento actual en hora de Guadalajara: día (0=Lun…6=Dom) y minutos del día. */
export function nowInGuadalajara(now: Date = new Date()): {
  day: number;
  minutes: number;
  seconds: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  // Map "Mon".."Sun" → 0..6 (índice del arreglo, 0=Lunes).
  const WD: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const day = WD[get("weekday")] ?? 0;
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0; // algunos entornos devuelven "24" a medianoche
  const minutes = hour * 60 + Number(get("minute"));
  const seconds = Number(get("second")) || 0;
  return { day, minutes, seconds };
}

/** Milisegundos que faltan para la próxima medianoche en Guadalajara. Sirve para
 *  fijar la vigencia del override manual (fin del día local) sin construir fechas
 *  con offset (robusto ante DST). */
export function msUntilEndOfGuadalajaraDay(now: Date = new Date()): number {
  const { minutes, seconds } = nowInGuadalajara(now);
  const remainingSeconds = (24 * 60 - minutes) * 60 - seconds;
  return Math.max(1000, remainingSeconds * 1000);
}

/** ISO de la próxima medianoche en Guadalajara (vigencia del override). */
export function endOfGuadalajaraDayISO(now: Date = new Date()): string {
  return new Date(now.getTime() + msUntilEndOfGuadalajaraDay(now)).toISOString();
}

/** ¿El negocio está abierto según su horario, en el momento `now`? Considera
 *  rangos que cruzan la medianoche (spillover del día anterior). */
export function isOpenByHours(hours: OpeningHours, now: Date = new Date()): boolean {
  if (!Array.isArray(hours) || hours.length === 0) return false;
  const { day, minutes } = nowInGuadalajara(now);

  // Rango de hoy.
  const today = dayAt(hours, day);
  if (today && !today.closed) {
    const o = toMinutes(today.open);
    const c = toMinutes(today.close);
    if (o !== null && c !== null) {
      if (c > o) {
        // Rango normal dentro del mismo día.
        if (minutes >= o && minutes < c) return true;
      } else if (c < o) {
        // Cruza medianoche: hoy abre desde `o` hasta las 24:00.
        if (minutes >= o) return true;
      }
      // c === o → rango de longitud cero: se considera cerrado.
    }
  }

  // Spillover: el día anterior tenía un rango que cruzaba la medianoche y sigue
  // vigente en la madrugada de hoy (minutes < close del día anterior).
  const prevIdx = (day + 6) % 7;
  const prev = dayAt(hours, prevIdx);
  if (prev && !prev.closed) {
    const o = toMinutes(prev.open);
    const c = toMinutes(prev.close);
    if (o !== null && c !== null && c < o && minutes < c) return true;
  }

  return false;
}

/**
 * Estado efectivo abierto/cerrado del venue:
 * 1. Sin horario (`opening_hours` null) → estado manual clásico (`status`).
 * 2. Con override manual vigente (`status_override_until` en el futuro) → gana el override.
 * 3. En otro caso → se calcula desde el horario y la hora de Guadalajara.
 */
export function getEffectiveStatus(
  venue: Pick<
    Venue,
    "status" | "opening_hours" | "status_override" | "status_override_until"
  >,
  now: Date = new Date(),
): VenueStatus {
  if (!venue.opening_hours || venue.opening_hours.length === 0) return venue.status;

  if (
    venue.status_override &&
    venue.status_override_until &&
    new Date(venue.status_override_until).getTime() > now.getTime()
  ) {
    return venue.status_override;
  }

  return isOpenByHours(venue.opening_hours, now) ? "open" : "closed";
}

/** ¿El override manual sigue vigente en este momento? (para UI del admin/bot) */
export function hasActiveOverride(
  venue: Pick<Venue, "status_override" | "status_override_until">,
  now: Date = new Date(),
): boolean {
  return Boolean(
    venue.status_override &&
      venue.status_override_until &&
      new Date(venue.status_override_until).getTime() > now.getTime(),
  );
}

/** Valida/sanea el jsonb crudo de la DB a OpeningHours (o null). Tolerante:
 *  rellena a 7 días y descarta formas inválidas. */
export function parseOpeningHours(raw: unknown): OpeningHours | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: DayHours[] = [];
  for (let i = 0; i < 7; i++) {
    const d = raw[i] as Partial<DayHours> | undefined;
    if (d && typeof d === "object") {
      out.push({
        closed: Boolean(d.closed),
        open: typeof d.open === "string" ? d.open : "09:00",
        close: typeof d.close === "string" ? d.close : "18:00",
      });
    } else {
      out.push({ closed: true, open: "09:00", close: "18:00" });
    }
  }
  return out;
}

/** Lee el campo JSON del editor de horario del admin (FormData). Vacío → null
 *  (= sin horario, estado manual). */
export function readOpeningHoursField(formData: FormData): OpeningHours | null {
  const raw = String(formData.get("opening_hours") ?? "").trim();
  if (!raw) return null;
  try {
    return parseOpeningHours(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Texto corto del horario de hoy para la ficha (ej. "Hoy 9:00–18:00" o "Cerrado hoy"). */
export function todayHoursLabel(hours: OpeningHours, now: Date = new Date()): string {
  const { day } = nowInGuadalajara(now);
  const d = dayAt(hours, day);
  if (!d || d.closed) return "Cerrado hoy";
  return `Hoy ${d.open}–${d.close}`;
}
