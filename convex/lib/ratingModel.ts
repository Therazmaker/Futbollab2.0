/**
 * Modelo de NOTA (rating Sofascore/FotMob) del jugador.
 *
 *   nota = nivel del jugador + β_casa·casa + β_fuerza·(fuerza propia − fuerza rival) + β_suplente·(<45')
 *
 *  - El nivel de cada jugador es una media ponderada de sus notas (las
 *    recientes pesan más) que parte de la media general (vale N0 partidos).
 *  - Los β son GLOBALES: se aprenden con los partidos de TODOS los jugadores
 *    (regresión ridge con prior). Por eso el modelo mejora al registrar más
 *    jugadores, no solo más partidos del mismo.
 *  - Fuerza de un equipo = ln(ataque) − ln(defensa), con los ratings Poisson de
 *    la tabla `teams` (0 = equipo medio de su liga; +0.5 ≈ muy superior).
 *
 * Puro (sin Convex) para usarlo en queries, mutations y tests.
 */

export const RATING_FEATURES = ["home", "strengthDiff", "shortMinutes", "postInjury"] as const;
export type RatingFeature = (typeof RATING_FEATURES)[number];

export const RATING_FEATURE_LABELS: Record<RatingFeature, string> = {
  home: "Jugar en casa",
  strengthDiff: "Diferencia de fuerza con el rival",
  shortMinutes: "Jugar menos de 45'",
  postInjury: "Vuelta de lesión",
};

/** Prior de cada efecto (media y desviación) en puntos de nota. */
export const RATING_PRIORS: Record<RatingFeature, { mean: number; sd: number }> = {
  home: { mean: 0.08, sd: 0.1 },
  strengthDiff: { mean: 0.35, sd: 0.25 }, // por unidad de ln-fuerza
  shortMinutes: { mean: -0.2, sd: 0.2 },
  postInjury: { mean: -0.15, sd: 0.15 },
};
export const RATING_DEFAULTS = { populationMean: 6.85, sigma: 0.62, n0: 3, halfLife: 12 };

export interface RatingParams {
  beta: Record<RatingFeature, number>;
  betaSd: Record<RatingFeature, number>;
  sigma: number; // ruido de un partido (desviación de la nota)
  populationMean: number;
  matches: number; // partidos con nota usados
  players: number;
}

export const DEFAULT_RATING_PARAMS: RatingParams = {
  beta: Object.fromEntries(RATING_FEATURES.map((f) => [f, RATING_PRIORS[f].mean])) as Record<RatingFeature, number>,
  betaSd: Object.fromEntries(RATING_FEATURES.map((f) => [f, RATING_PRIORS[f].sd])) as Record<RatingFeature, number>,
  sigma: RATING_DEFAULTS.sigma,
  populationMean: RATING_DEFAULTS.populationMean,
  matches: 0,
  players: 0,
};

export interface TeamStrengthInput {
  attackRating?: number | null;
  defenseRating?: number | null;
}

export function teamStrength(t?: TeamStrengthInput | null): number | null {
  if (!t?.attackRating || !t?.defenseRating) return null;
  return Math.log(t.attackRating) - Math.log(t.defenseRating);
}

export interface RatingContext {
  isAway: boolean;
  minutes?: number;
  ownStrength?: number | null;
  opponentStrength?: number | null;
  /** Primeros partidos tras una lesión */
  postInjury?: boolean;
  /** Salió lesionado: su nota de ese partido pesa poco (no es rendimiento normal) */
  injuredOff?: boolean;
}

/** Peso de un partido con nota: los que acabaron en lesión cuentan poco. */
const INJURED_OFF_WEIGHT = 0.3;

export function ratingFeatures(c: RatingContext): Record<RatingFeature, number> {
  // Si solo conocemos a uno de los dos equipos, el otro se toma como medio (0)
  const own = c.ownStrength ?? 0;
  const opp = c.opponentStrength ?? 0;
  return {
    home: c.isAway ? 0 : 1,
    strengthDiff: own - opp,
    // Salir lesionado pronto no es "jugar poco" por decisión técnica
    shortMinutes: !c.injuredOff && c.minutes !== undefined && c.minutes > 0 && c.minutes < 45 ? 1 : 0,
    postInjury: c.postInjury ? 1 : 0,
  };
}

export interface RatingRow extends RatingContext {
  playerId: string;
  rating: number;
  order: number; // posición cronológica dentro del jugador (0 = el más viejo)
  total: number; // nº de partidos con nota del jugador
}

const weightOf = (r: Pick<RatingRow, "order" | "total" | "injuredOff">) =>
  Math.pow(0.5, (r.total - 1 - r.order) / RATING_DEFAULTS.halfLife) * (r.injuredOff ? INJURED_OFF_WEIGHT : 1);

/** Ajuste global: niveles de jugador + β compartidos (alternando, 10 vueltas). */
export function fitRatingModel(rows: RatingRow[]): RatingParams {
  const valid = rows.filter((r) => Number.isFinite(r.rating) && r.rating > 0 && r.rating <= 10);
  if (!valid.length) return DEFAULT_RATING_PARAMS;
  const xs = valid.map(ratingFeatures);
  const w = valid.map(weightOf);
  const players = Array.from(new Set(valid.map((r) => r.playerId)));
  const popMean =
    (RATING_DEFAULTS.populationMean * 20 + valid.reduce((a, r) => a + r.rating, 0)) / (20 + valid.length);

  const beta: Record<RatingFeature, number> = { ...DEFAULT_RATING_PARAMS.beta };
  let sigma2 = RATING_DEFAULTS.sigma ** 2;
  let level = new Map<string, number>();

  for (let iter = 0; iter < 10; iter++) {
    // 1) nivel de cada jugador con los β actuales (media ponderada con prior)
    const num = new Map<string, number>();
    const den = new Map<string, number>();
    valid.forEach((r, i) => {
      const adj = r.rating - RATING_FEATURES.reduce((a, f) => a + beta[f] * xs[i][f], 0);
      num.set(r.playerId, (num.get(r.playerId) ?? 0) + w[i] * adj);
      den.set(r.playerId, (den.get(r.playerId) ?? 0) + w[i]);
    });
    level = new Map(
      players.map((p) => [p, (RATING_DEFAULTS.n0 * popMean + (num.get(p) ?? 0)) / (RATING_DEFAULTS.n0 + (den.get(p) ?? 0))])
    );
    // 2) β por ridge: (XᵀWX + Λ) β = XᵀW(y − nivel) + Λ μ0, con Λ = σ²/sd0²
    const k = RATING_FEATURES.length;
    const A = Array.from({ length: k }, () => new Array(k).fill(0));
    const b = new Array(k).fill(0);
    valid.forEach((r, i) => {
      const y = r.rating - level.get(r.playerId)!;
      RATING_FEATURES.forEach((f, a) => {
        b[a] += w[i] * xs[i][f] * y;
        RATING_FEATURES.forEach((g, c) => (A[a][c] += w[i] * xs[i][f] * xs[i][g]));
      });
    });
    RATING_FEATURES.forEach((f, a) => {
      const lam = sigma2 / RATING_PRIORS[f].sd ** 2;
      A[a][a] += lam;
      b[a] += lam * RATING_PRIORS[f].mean;
    });
    const sol = solve(A, b);
    RATING_FEATURES.forEach((f, a) => (beta[f] = sol[a]));
    // 3) ruido de un partido (con prior, para no colapsar con pocos datos)
    let ss = 0;
    let ws = 0;
    valid.forEach((r, i) => {
      const pred = level.get(r.playerId)! + RATING_FEATURES.reduce((a, f) => a + beta[f] * xs[i][f], 0);
      ss += w[i] * (r.rating - pred) ** 2;
      ws += w[i];
    });
    sigma2 = (ss + 10 * RATING_DEFAULTS.sigma ** 2) / (ws + 10);
  }

  // Incertidumbre aproximada de cada β (diagonal de la inversa)
  const k = RATING_FEATURES.length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  valid.forEach((_, i) =>
    RATING_FEATURES.forEach((f, a) => RATING_FEATURES.forEach((g, c) => (A[a][c] += w[i] * xs[i][f] * xs[i][g])))
  );
  const betaSd = {} as Record<RatingFeature, number>;
  RATING_FEATURES.forEach((f, a) => {
    const prec = A[a][a] / sigma2 + 1 / RATING_PRIORS[f].sd ** 2;
    betaSd[f] = 1 / Math.sqrt(prec);
  });

  return { beta, betaSd, sigma: Math.sqrt(sigma2), populationMean: popMean, matches: valid.length, players: players.length };
}

/** Gauss con pivoteo para sistemas pequeños. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-9));
}

export interface PlayerRatingLog extends RatingContext {
  rating: number;
}

export interface RatingForecast {
  mean: number;
  sd: number;
  low: number; // percentil 10
  high: number; // percentil 90
  level: number; // nivel propio del jugador (en contexto neutro)
  ownMatches: number;
  dataShare: number;
  contributions: Array<{ feature: RatingFeature; label: string; delta: number }>;
}

/** Nota esperada de un jugador en un contexto, con sus partidos previos (orden cronológico). */
export function forecastRating(params: RatingParams, history: PlayerRatingLog[], ctx: RatingContext): RatingForecast {
  const rated = history.filter((h) => Number.isFinite(h.rating) && h.rating > 0 && h.rating <= 10);
  const n = rated.length;
  let num = 0;
  let den = 0;
  rated.forEach((h, i) => {
    const wt = Math.pow(0.5, (n - 1 - i) / RATING_DEFAULTS.halfLife) * (h.injuredOff ? INJURED_OFF_WEIGHT : 1);
    const x = ratingFeatures(h);
    num += wt * (h.rating - RATING_FEATURES.reduce((a, f) => a + params.beta[f] * x[f], 0));
    den += wt;
  });
  const level = (RATING_DEFAULTS.n0 * params.populationMean + num) / (RATING_DEFAULTS.n0 + den);
  const x = ratingFeatures(ctx);
  const contributions = RATING_FEATURES.map((f) => ({
    feature: f,
    label: RATING_FEATURE_LABELS[f],
    delta: params.beta[f] * x[f],
  })).filter((c) => Math.abs(c.delta) > 0.005);
  const mean = level + contributions.reduce((a, c) => a + c.delta, 0);
  const sd = params.sigma * Math.sqrt(1 + 1 / (RATING_DEFAULTS.n0 + den));
  const clamp = (v: number) => Math.min(10, Math.max(3, v));
  return {
    mean: clamp(mean),
    sd,
    low: clamp(mean - 1.2816 * sd),
    high: clamp(mean + 1.2816 * sd),
    level,
    ownMatches: n,
    dataShare: den / (RATING_DEFAULTS.n0 + den),
    contributions,
  };
}
