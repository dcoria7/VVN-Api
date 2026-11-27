import { describe, expect, it } from 'vitest';
import { isOpenByHours, parseOpeningHours, todayHoursLabel } from './venue-hours';

describe('horarios con múltiples intervalos', () => {
  const hours = parseOpeningHours(Array.from({ length: 7 }, () => ({ closed: false, open: '09:00', close: '20:00', intervals: [{ open: '09:00', close: '13:00' }, { open: '16:00', close: '20:00' }] })))!;
  it('respeta la pausa entre intervalos en hora de Guadalajara', () => {
    expect(isOpenByHours(hours, new Date('2026-11-27T16:00:00Z'))).toBe(true);
    expect(isOpenByHours(hours, new Date('2026-11-27T20:00:00Z'))).toBe(false);
    expect(isOpenByHours(hours, new Date('2026-11-27T23:00:00Z'))).toBe(true);
  });
  it('incluye ambos turnos en la etiqueta', () => {
    expect(todayHoursLabel(hours, new Date('2026-11-27T16:00:00Z'))).toBe('Hoy 09:00–13:00 / 16:00–20:00');
  });
  it('conserva el cierre al día siguiente aunque hoy esté cerrado', () => {
    const overnight = parseOpeningHours([{ closed: false, open: '18:00', close: '02:00', intervals: [{ open: '18:00', close: '02:00' }] }])!;
    expect(isOpenByHours(overnight, new Date('2026-11-24T07:00:00Z'))).toBe(true);
    expect(isOpenByHours(overnight, new Date('2026-11-24T08:00:00Z'))).toBe(false);
  });
});
