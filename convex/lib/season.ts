/**
 * Temporadas europeas: de julio a junio. "2026-11-05" → "2026-27".
 * La tabla y la forma solo usan la temporada actual; el resto del histórico
 * se usa para entrenar los modelos (fuerza de equipos, perfiles, nota).
 */
export const SEASON_START_MONTH = 7;

export function seasonOf(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return "";
  const start = m >= SEASON_START_MONTH ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function currentSeason(now: Date = new Date()): string {
  return seasonOf(now.toISOString().slice(0, 10));
}

export function previousSeason(season: string): string {
  const start = Number(season.slice(0, 4)) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
