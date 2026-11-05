/**
 * Lesiones. Una lesión tiene inicio (fecha del partido en que se lesionó o
 * fecha manual), vuelta prevista opcional y fin (cuando vuelve a jugar o se
 * marca recuperado).
 *
 * Efectos en el modelo:
 *  - El partido en que sale lesionado no cuenta como mal rendimiento.
 *  - Los RETURN_MATCHES primeros partidos tras una lesión llevan el efecto
 *    "vuelta de lesión" (menos minutos, algo menos de producción y nota).
 */
export const RETURN_MATCHES = 2;

export interface InjuryLike {
  startDate: string;
  endDate?: string | null;
  expectedReturn?: string | null;
}

/** Para cada partido (orden cronológico): ¿es de los primeros tras una lesión? */
export function postInjuryFlags(logDatesAsc: string[], injuries: InjuryLike[]): boolean[] {
  const flags = logDatesAsc.map(() => false);
  for (const inj of injuries) {
    let count = 0;
    for (let i = 0; i < logDatesAsc.length && count < RETURN_MATCHES; i++) {
      if (logDatesAsc[i] > inj.startDate) {
        flags[i] = true;
        count++;
      }
    }
  }
  return flags;
}

export type Availability =
  | { status: "available" }
  | { status: "injured"; since: string; expectedReturn?: string | null; note?: string | null }
  | { status: "returning"; matchesBack: number };

/**
 * Disponibilidad para un partido en `date`, con sus lesiones y las fechas de
 * los partidos ya jugados.
 */
export function availabilityOn(
  date: string,
  injuries: Array<InjuryLike & { note?: string | null }>,
  logDatesAsc: string[]
): Availability {
  const open = injuries
    .filter((i) => !i.endDate && i.startDate <= date)
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
  if (open && (!open.expectedReturn || open.expectedReturn > date)) {
    return { status: "injured", since: open.startDate, expectedReturn: open.expectedReturn ?? null, note: open.note ?? null };
  }
  // Vuelta reciente: menos de RETURN_MATCHES partidos jugados desde la última lesión
  const last = injuries.filter((i) => i.startDate <= date).sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
  if (last) {
    const back = logDatesAsc.filter((d) => d > last.startDate && d <= date).length;
    if (back < RETURN_MATCHES) return { status: "returning", matchesBack: back };
  }
  return { status: "available" };
}
