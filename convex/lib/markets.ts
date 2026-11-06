/**
 * Mercados de un partido a partir de la fuerza de los equipos (Poisson con
 * corrección Dixon-Coles).
 *
 * Desde que la fuerza se ajusta a goles + xG (lib/xgBlend.ts) y hay 3 temporadas
 * de 5 ligas, la fuerza SÍ predice cuántos goles habrá: en walk-forward
 * (3.920 partidos) le gana a la frecuencia de cada liga en +1,5, +2,5, +3,5 y
 * ambos marcan, así que los totales salen de la matriz de marcadores.
 * Antes (solo goles, 1 temporada) pasaba lo contrario y se usaba la frecuencia.
 * ρ = −0,1 sale prácticamente óptimo en ese mismo backtest (−0,15 / −0,05 empatan).
 */
export const TOTAL_SHRINK = 1; // peso de la fuerza en el TOTAL de goles (0 = solo media de la liga)
export const DC_RHO = -0.1;

export interface TeamForMarkets {
  attackRating?: number | null;
  defenseRating?: number | null;
}
export interface GoalRates {
  over15: number;
  over25: number;
  over35: number;
  btts: number;
  // Frecuencias 1X2 de la liga (referencia para evaluar el modelo)
  homeWin?: number;
  draw?: number;
  awayWin?: number;
  homeCleanSheet?: number;
  awayCleanSheet?: number;
}
export interface LeagueForMarkets {
  goalsPerTeam?: number | null;
  homeAdvantage?: number | null;
  goalRates?: GoalRates | null;
}

/** Frecuencias de goles de una liga, ponderadas por antigüedad (vida media ≈ 170 días). */
export function leagueGoalRates(
  rows: Array<{ homeGoals: number; awayGoals: number; date: string }>,
  xi = 0.004
): GoalRates | null {
  if (rows.length < 20) return null;
  const now = Math.max(...rows.map((r) => Date.parse(r.date) || 0));
  let w = 0, o15 = 0, o25 = 0, o35 = 0, bt = 0, hw = 0, dr = 0, aw = 0, csh = 0, csa = 0;
  for (const r of rows) {
    const wi = Math.exp((-xi * (now - (Date.parse(r.date) || now))) / 86_400_000);
    const g = r.homeGoals + r.awayGoals;
    w += wi;
    if (g > 1) o15 += wi;
    if (g > 2) o25 += wi;
    if (g > 3) o35 += wi;
    if (r.homeGoals > 0 && r.awayGoals > 0) bt += wi;
    if (r.homeGoals > r.awayGoals) hw += wi;
    else if (r.homeGoals === r.awayGoals) dr += wi;
    else aw += wi;
    if (r.awayGoals === 0) csh += wi;
    if (r.homeGoals === 0) csa += wi;
  }
  const r3 = (x: number) => +(x / w).toFixed(3);
  return {
    over15: r3(o15),
    over25: r3(o25),
    over35: r3(o35),
    btts: r3(bt),
    homeWin: r3(hw),
    draw: r3(dr),
    awayWin: r3(aw),
    homeCleanSheet: r3(csh),
    awayCleanSheet: r3(csa),
  };
}

export interface Markets {
  expectedGoals: { home: number; away: number };
  reliable: boolean; // false si falta la fuerza de algún equipo
  probabilities: { home: number; draw: number; away: number };
  over15: number;
  over25: number;
  over35: number;
  btts: number;
  homeCleanSheet: number;
  awayCleanSheet: number;
  topScores: Array<{ home: number; away: number; p: number }>;
  // Descanso (estimado: ~45 % de los goles en la primera parte; no validado)
  halfTime: { home: number; draw: number; away: number; goalless: number };
}

function pois(k: number, l: number) {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-l) * Math.pow(l, k)) / f;
}

function matrix(lh: number, la: number, rho: number, max = 10) {
  const m: number[][] = [];
  let total = 0;
  for (let i = 0; i <= max; i++) {
    m.push([]);
    for (let j = 0; j <= max; j++) {
      let p = pois(i, lh) * pois(j, la);
      if (rho) {
        if (i === 0 && j === 0) p *= 1 - lh * la * rho;
        else if (i === 0 && j === 1) p *= 1 + lh * rho;
        else if (i === 1 && j === 0) p *= 1 + la * rho;
        else if (i === 1 && j === 1) p *= 1 - rho;
      }
      m[i].push(p);
      total += p;
    }
  }
  return m.map((row) => row.map((p) => p / total));
}

export function expectedGoals(home: TeamForMarkets, away: TeamForMarkets, league: LeagueForMarkets) {
  const avg = league.goalsPerTeam ?? 1.4;
  const homeAdv = league.homeAdvantage ?? 1.15;
  const reliable = !!(home.attackRating && home.defenseRating && away.attackRating && away.defenseRating);
  const lhRaw = avg * homeAdv * (home.attackRating ?? 1) * (away.defenseRating ?? 1);
  const laRaw = avg * (away.attackRating ?? 1) * (home.defenseRating ?? 1);
  // Reparto local/visitante = fuerza; TOTAL = casi la media de la liga
  const baseTotal = avg * (homeAdv + 1);
  const total = TOTAL_SHRINK * (lhRaw + laRaw) + (1 - TOTAL_SHRINK) * baseTotal;
  const share = lhRaw / (lhRaw + laRaw);
  return { lh: total * share, la: total * (1 - share), reliable };
}

export function computeMarkets(home: TeamForMarkets, away: TeamForMarkets, league: LeagueForMarkets): Markets {
  const { lh, la, reliable } = expectedGoals(home, away, league);
  const m = matrix(lh, la, DC_RHO);
  let H = 0, D = 0, A = 0, o15 = 0, o25 = 0, o35 = 0, btts = 0, csH = 0, csA = 0;
  const scores: Array<{ home: number; away: number; p: number }> = [];
  m.forEach((row, i) =>
    row.forEach((p, j) => {
      if (i > j) H += p;
      else if (i === j) D += p;
      else A += p;
      if (i + j > 1) o15 += p;
      if (i + j > 2) o25 += p;
      if (i + j > 3) o35 += p;
      if (i > 0 && j > 0) btts += p;
      if (j === 0) csH += p;
      if (i === 0) csA += p;
      scores.push({ home: i, away: j, p });
    })
  );
  scores.sort((a, b) => b.p - a.p);
  const ht = matrix(lh * 0.45, la * 0.45, 0);
  let hH = 0, hD = 0, hA = 0;
  ht.forEach((row, i) => row.forEach((p, j) => (i > j ? (hH += p) : i === j ? (hD += p) : (hA += p))));
  const r = (x: number) => +x.toFixed(3);
  return {
    expectedGoals: { home: +lh.toFixed(2), away: +la.toFixed(2) },
    reliable,
    probabilities: { home: r(H), draw: r(D), away: r(A) },
    over15: r(o15),
    over25: r(o25),
    over35: r(o35),
    btts: r(btts),
    homeCleanSheet: r(csH),
    awayCleanSheet: r(csA),
    topScores: scores.slice(0, 5).map((s) => ({ ...s, p: r(s.p) })),
    halfTime: { home: r(hH), draw: r(hD), away: r(hA), goalless: r(ht[0][0]) },
  };
}

/** Cuotas decimales 1-X-2 → probabilidades justas (sin el margen de la casa). */
export function fairProbabilities(odds: { home?: number; draw?: number; away?: number }) {
  const { home, draw, away } = odds;
  if (!(home && home > 1 && draw && draw > 1 && away && away > 1)) return null;
  const raw = [1 / home, 1 / draw, 1 / away];
  const sum = raw[0] + raw[1] + raw[2];
  return { home: raw[0] / sum, draw: raw[1] / sum, away: raw[2] / sum, margin: sum - 1 };
}
