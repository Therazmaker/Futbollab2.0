/**
 * Fuerza de equipos con goles + xG.
 *
 * Los goles tienen mucha suerte; el xG mide lo que el equipo genera. La fuerza se
 * ajusta a una mezcla: objetivo = 70 % goles + 30 % xG. Cuando no hay xG real
 * (temporadas antiguas) se estima con los tiros:
 *     xG ≈ 0,2025 · tiros a puerta + 0,0639 · tiros fuera
 * (ajustado con el xG real de 2026-27, 904 equipos-partido, R² = 0,56).
 *
 * Validación walk-forward, 5 ligas, 3.920 partidos (2024-08 → 2026-11), frente al
 * modelo anterior (solo goles, total = media de la liga):
 *   1X2 log-loss 0,9943 → 0,9916 · +2,5: 0,6870 → 0,6781 · +1,5: 0,5312 → 0,5254
 *   +3,5: 0,6163 → 0,6064 · ambos marcan: 0,6880 → 0,6860
 * (cuotas de cierre del mercado, como referencia: 1X2 0,9667 · +2,5 0,6662).
 */

export const XG_WEIGHT = 0.3;
export const PROXY_SOT = 0.2025;
export const PROXY_OFF = 0.0639;

export interface MatchStats {
  hs: number;
  as: number;
  hst: number;
  ast: number;
  hxg?: number;
  axg?: number;
}

/** xG del partido: el real si existe, si no el estimado con los tiros. */
export function matchXg(stats: MatchStats | undefined | null): { home: number; away: number } | null {
  if (!stats) return null;
  const est = (s: number, st: number) => PROXY_SOT * st + PROXY_OFF * Math.max(0, s - st);
  const home = stats.hxg ?? (Number.isFinite(stats.hs) && Number.isFinite(stats.hst) ? est(stats.hs, stats.hst) : null);
  const away = stats.axg ?? (Number.isFinite(stats.as) && Number.isFinite(stats.ast) ? est(stats.as, stats.ast) : null);
  return home === null || away === null ? null : { home, away };
}

/** Objetivo de la fuerza para un partido: goles, o mezcla goles/xG si hay estadísticas. */
export function ratingTarget(m: { homeGoals: number; awayGoals: number; stats?: MatchStats | null }) {
  const xg = matchXg(m.stats);
  if (!xg) return { home: m.homeGoals, away: m.awayGoals };
  return {
    home: (1 - XG_WEIGHT) * m.homeGoals + XG_WEIGHT * xg.home,
    away: (1 - XG_WEIGHT) * m.awayGoals + XG_WEIGHT * xg.away,
  };
}

/** Goles reales por equipo y partido, con el mismo peso por antigüedad que la fuerza. */
export function weightedGoalsPerTeam(rows: Array<{ homeGoals: number; awayGoals: number; date: string }>, xi = 0.004) {
  if (!rows.length) return 1.35;
  const now = Math.max(...rows.map((r) => Date.parse(r.date) || 0));
  let w = 0;
  let g = 0;
  for (const r of rows) {
    const wi = Math.exp((-xi * (now - (Date.parse(r.date) || now))) / 86_400_000);
    w += wi;
    g += wi * (r.homeGoals + r.awayGoals);
  }
  return g / (2 * w) || 1.35;
}
