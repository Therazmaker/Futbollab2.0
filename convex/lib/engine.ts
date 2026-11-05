/**
 * FutbolLab 2.0 — Motor de perfil del jugador.
 *
 * Idea (la del criminalista): primero la TASA BASE del "tipo" (posición), después
 * la evidencia del individuo, y solo nos alejamos de la tasa base cuando la
 * evidencia es suficiente. Matemáticamente es un modelo bayesiano jerárquico:
 *
 *   y_s ~ Poisson( λ_s · (min/90) · exp(β·x) )           (recuento por partido)
 *   λ_s ~ Gamma(a0, b0)    prior = media de la posición, vale K_PRIOR partidos de 90'
 *   β_f ~ Normal(μ0_f, σ0_f)  efectos de contexto (visitante, rival, etc.)
 *
 *  - λ_s es la "firma" del jugador por 90 minutos (tiros, xG, pases clave, duelos).
 *  - β es el "modus operandi": cómo cambia según el contexto. Los efectos se
 *    estiman con todos sus partidos a la vez (Newton sobre la log-verosimilitud
 *    penalizada), no con un pasito por partido, así no deambulan con el ruido.
 *  - Los partidos recientes pesan más (vida media HALF_LIFE partidos).
 *  - La predicción es una distribución (Binomial Negativa), no un número:
 *    da media, intervalo 80% y P(≥k).
 *
 * Todo es puro (sin Convex) para poder usarlo en queries, mutations y tests.
 */

export type StatKey = "totalShots" | "xG" | "keyPasses" | "groundDuelsWon";
export const STATS: StatKey[] = ["totalShots", "xG", "keyPasses", "groundDuelsWon"];
/** Stats a las que afecta el contexto (producción ofensiva). */
const CONTEXT_STAT_LIST: StatKey[] = ["totalShots", "xG", "keyPasses"];
const CONTEXT_STATS = new Set<StatKey>(CONTEXT_STAT_LIST);
/** xG no es un recuento: se trata como cuasi-Poisson. */
const CONTINUOUS = new Set<StatKey>(["xG"]);

export const STAT_LABELS: Record<StatKey, string> = {
  totalShots: "Tiros",
  xG: "xG",
  keyPasses: "Pases clave",
  groundDuelsWon: "Duelos",
};

export type PositionGroup = "GK" | "DF" | "MF" | "AM" | "FW";

/** Tasas base por 90' (referencias aproximadas de las 5 grandes ligas). */
export const POSITION_PRIORS: Record<PositionGroup, Record<StatKey, number>> = {
  GK: { totalShots: 0.02, xG: 0.002, keyPasses: 0.05, groundDuelsWon: 0.3 },
  DF: { totalShots: 0.6, xG: 0.05, keyPasses: 0.6, groundDuelsWon: 3.0 },
  MF: { totalShots: 1.2, xG: 0.1, keyPasses: 1.2, groundDuelsWon: 3.4 },
  AM: { totalShots: 2.2, xG: 0.25, keyPasses: 1.9, groundDuelsWon: 3.6 },
  FW: { totalShots: 2.6, xG: 0.38, keyPasses: 1.1, groundDuelsWon: 3.2 },
};
export const RATING_PRIOR = { mean: 6.9, n0: 3 };

/** Cuántos partidos completos "vale" la tasa base de la posición. */
export const K_PRIOR = 3;
/** Un partido de hace HALF_LIFE partidos pesa la mitad que el último. */
export const HALF_LIFE = 12;
const DEFAULT_MINUTES = 80;

export interface FeaturePrior {
  mean: number; // en escala log: exp(mean) es el multiplicador
  sd: number;
  label: string;
}

/**
 * Efectos de contexto conocidos. is_away: los equipos visitantes generan
 * ~10% menos producción ofensiva. opponent_defense: x = ln(defensa del rival),
 * donde >0 significa que el rival concede más que la media de su liga.
 */
export const FEATURE_PRIORS: Record<string, FeaturePrior> = {
  is_away: { mean: Math.log(0.9), sd: 0.1, label: "Visitante" },
  opponent_defense: { mean: 0.6, sd: 0.3, label: "Defensa del rival" },
};
const GENERIC_FEATURE_PRIOR: FeaturePrior = { mean: 0, sd: 0.15, label: "" };
export function featurePrior(name: string): FeaturePrior {
  return FEATURE_PRIORS[name] ?? { ...GENERIC_FEATURE_PRIOR, label: name.replace(/_/g, " ") };
}

export interface ModelLog {
  id?: string;
  matchDate: string;
  opponent?: string;
  isAway: boolean;
  minutesPlayed: number;
  rawStats: any;
  contextFeatures?: string[];
  /** Multiplicador defensivo del rival (1 = media de la liga), si se conoce. */
  opponentDefense?: number | null;
  /** Fuerza (ln ataque − ln defensa) del rival y del propio equipo, para la nota. */
  opponentStrength?: number | null;
  ownStrength?: number | null;
}

export interface PlayerPriorInput {
  position?: string;
  seasonStats?: { minutes?: number; goals?: number } | null;
}

export function positionGroup(position = ""): PositionGroup {
  const p = position.toLowerCase();
  if (/\bgk\b|portero|goalkeeper|arquero/.test(p)) return "GK";
  if (/\bam\b|attacking|mediapunta|shadow|enganche|box-to-box|\b10\b/.test(p)) return "AM";
  if (/\bfw\b|striker|delantero|forward|wing|extremo|punta|\bst\b|\bcf\b/.test(p)) return "FW";
  if (/\bdf\b|defens|back|lateral|\bcb\b|\blb\b|\brb\b|zaguero|central def/.test(p)) return "DF";
  return "MF";
}

export function readStat(raw: any, key: StatKey): number | null {
  if (!raw || typeof raw !== "object") return null;
  const candidates =
    key === "totalShots"
      ? [raw.totalShots, raw.shots]
      : key === "xG"
      ? [raw.xG, raw.xg]
      : key === "keyPasses"
      ? [raw.keyPasses]
      : [raw.groundDuelsWon, raw.duelsWon];
  for (const c of candidates) {
    if (c === null || c === undefined || c === "") continue;
    const n = Number(c);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function readRating(raw: any): number | null {
  const n = Number(raw?.rating);
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : null;
}

/** Vector de contexto de un partido (las claves ausentes valen 0). */
export function featureVector(log: Pick<ModelLog, "isAway" | "contextFeatures" | "opponentDefense">) {
  const x: Record<string, number> = {};
  if (log.isAway) x.is_away = 1;
  if (log.opponentDefense && log.opponentDefense > 0) {
    x.opponent_defense = Math.log(log.opponentDefense);
  }
  for (const f of log.contextFeatures ?? []) {
    if (f && f !== "is_away" && f !== "home_pitch_bias" && f !== "opponent_defense") x[f] = 1;
  }
  return x;
}

export function priorRates(input: PlayerPriorInput): Record<StatKey, number> {
  const base = { ...POSITION_PRIORS[positionGroup(input.position)] };
  // Si tenemos goles/minutos de temporada (p. ej. del histórico importado),
  // los usamos para afinar la tasa base de xG: goles ≈ xG a largo plazo.
  const s = input.seasonStats;
  if (s?.minutes && s.minutes > 0 && s.goals !== undefined) {
    const k = 5; // la posición sigue valiendo 5 partidos frente a los goles
    base.xG = (s.goals + k * base.xG) / (s.minutes / 90 + k);
  }
  return base;
}

export interface FittedState {
  rates: Record<StatKey, { A: number; B: number; rate: number; prior: number; dataShare: number }>;
  beta: Record<string, { mean: number; sd: number; prior: FeaturePrior; dataShare: number; matches: number }>;
  rating: { mean: number; n: number };
  expectedMinutes: number;
  matches: number;
}

function recencyWeights(n: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.pow(0.5, (n - 1 - i) / HALF_LIFE));
}

/** Ajusta el perfil con los partidos dados (en orden cronológico). */
export function fitProfile(logsAsc: ModelLog[], priorInput: PlayerPriorInput): FittedState {
  const logs = logsAsc.filter((l) => Number(l.minutesPlayed) > 0);
  const w = recencyWeights(logs.length);
  const t = logs.map((l) => Math.min(130, Number(l.minutesPlayed)) / 90);
  const xs = logs.map(featureVector);
  const ys = logs.map((l) => Object.fromEntries(STATS.map((s) => [s, readStat(l.rawStats, s)])) as Record<StatKey, number | null>);
  const priors = priorRates(priorInput);

  const featureNames = Array.from(new Set(xs.flatMap((x) => Object.keys(x))));
  const beta: Record<string, number> = {};
  for (const f of featureNames) beta[f] = featurePrior(f).mean;

  const exposure = (i: number, s: StatKey) => {
    if (!CONTEXT_STATS.has(s)) return t[i];
    let lin = 0;
    for (const [f, v] of Object.entries(xs[i])) lin += (beta[f] ?? 0) * v;
    return t[i] * Math.exp(lin);
  };

  const rates = {} as FittedState["rates"];
  const hess: Record<string, number> = {};

  for (let iter = 0; iter < 12; iter++) {
    // 1) tasas por 90 con el contexto actual (actualización Gamma conjugada)
    for (const s of STATS) {
      const a0 = priors[s] * K_PRIOR;
      const b0 = K_PRIOR;
      let A = a0;
      let B = b0;
      let Bdata = 0;
      for (let i = 0; i < logs.length; i++) {
        const y = ys[i][s];
        if (y === null) continue;
        const e = exposure(i, s);
        A += w[i] * y;
        B += w[i] * e;
        Bdata += w[i] * e;
      }
      rates[s] = { A, B, rate: A / B, prior: priors[s], dataShare: Bdata / B };
    }
    // 2) efectos de contexto: un paso de Newton por efecto (Poisson + prior normal)
    for (const f of featureNames) {
      const pr = featurePrior(f);
      const p0 = 1 / (pr.sd * pr.sd);
      let g = -p0 * (beta[f] - pr.mean);
      let h = p0;
      for (let i = 0; i < logs.length; i++) {
        const xv = xs[i][f];
        if (!xv) continue;
        for (const s of CONTEXT_STAT_LIST) {
          const y = ys[i][s];
          if (y === null) continue;
          const mu = rates[s].rate * exposure(i, s);
          g += w[i] * (y - mu) * xv;
          h += w[i] * mu * xv * xv;
        }
      }
      const step = Math.max(-0.5, Math.min(0.5, g / h));
      beta[f] += step;
      hess[f] = h;
    }
  }

  const betaOut: FittedState["beta"] = {};
  for (const f of featureNames) {
    const pr = featurePrior(f);
    const p0 = 1 / (pr.sd * pr.sd);
    const h = hess[f] ?? p0;
    betaOut[f] = {
      mean: beta[f],
      sd: 1 / Math.sqrt(h),
      prior: pr,
      dataShare: Math.max(0, (h - p0) / h),
      matches: xs.filter((x) => x[f]).length,
    };
  }

  let rNum = RATING_PRIOR.mean * RATING_PRIOR.n0;
  let rDen = RATING_PRIOR.n0;
  logs.forEach((l, i) => {
    const r = readRating(l.rawStats);
    if (r !== null) {
      rNum += w[i] * r;
      rDen += w[i];
    }
  });

  const recent = logs.slice(-5);
  const expectedMinutes = recent.length
    ? recent.reduce((acc, l) => acc + Number(l.minutesPlayed), 0) / recent.length
    : DEFAULT_MINUTES;

  return {
    rates,
    beta: betaOut,
    rating: { mean: rNum / rDen, n: rDen - RATING_PRIOR.n0 },
    expectedMinutes,
    matches: logs.length,
  };
}

export interface StatForecast {
  mean: number;
  sd: number;
  low: number; // percentil 10
  high: number; // percentil 90
  /** E|Y − media|: el error que es imposible evitar (piso de ruido). */
  noiseFloor: number;
  pAtLeast: Record<string, number>; // "1","2","3"
}

/** Binomial Negativa predictiva: la tasa es incierta (Gamma) y el partido es Poisson. */
function negBinForecast(A: number, B: number, exposure: number): StatForecast {
  const r = A;
  const p = B / (B + exposure);
  const mean = (r * (1 - p)) / p;
  const variance = mean / p;
  const pmf: number[] = [];
  let pk = Math.pow(p, r);
  let cdf = 0;
  let low = -1;
  let high = -1;
  for (let k = 0; k < 60; k++) {
    pmf.push(pk);
    cdf += pk;
    if (low < 0 && cdf >= 0.1) low = k;
    if (high < 0 && cdf >= 0.9) high = k;
    pk = pk * ((k + r) / (k + 1)) * (1 - p);
  }
  const noiseFloor = pmf.reduce((acc, q, k) => acc + q * Math.abs(k - mean), 0);
  const tail = (k: number) => 1 - pmf.slice(0, k).reduce((a, b) => a + b, 0);
  return {
    mean,
    sd: Math.sqrt(variance),
    low: Math.max(0, low),
    high: Math.max(0, high),
    noiseFloor,
    pAtLeast: { "1": tail(1), "2": tail(2), "3": tail(3) },
  };
}

/**
 * Dispersión del xG de un partido: es una suma de tiros con xG muy desigual
 * (muchos ~0.03–0.08, algunas ocasiones claras ~0.4, penaltis ~0.76), así que
 * Var(xG) ≈ media × E[x²]/E[x] ≈ media × 0.32 (Poisson compuesto).
 */
export const XG_DISPERSION = 0.32;

/** xG: media Gamma-Poisson, varianza de Poisson compuesto. */
function continuousForecast(A: number, B: number, exposure: number): StatForecast {
  const mean = (A / B) * exposure;
  const rateVar = (A / (B * B)) * exposure * exposure * XG_DISPERSION;
  const sd = Math.sqrt(mean * XG_DISPERSION + rateVar);
  return {
    mean,
    sd,
    low: Math.max(0, mean - 1.2816 * sd),
    high: mean + 1.2816 * sd,
    noiseFloor: sd * Math.sqrt(2 / Math.PI),
    pAtLeast: {},
  };
}

export interface MatchForecast {
  stats: Record<StatKey, StatForecast>;
  rating: number;
  minutes: number;
  multiplier: number;
  contributions: Array<{ feature: string; label: string; impact: number }>;
  dataShare: number;
}

export function forecast(
  state: FittedState,
  ctx: Pick<ModelLog, "isAway" | "contextFeatures" | "opponentDefense">,
  minutes?: number
): MatchForecast {
  const mins = minutes && minutes > 0 ? minutes : state.expectedMinutes;
  const x = featureVector(ctx);
  let lin = 0;
  const contributions: MatchForecast["contributions"] = [];
  for (const [f, v] of Object.entries(x)) {
    const b = state.beta[f]?.mean ?? featurePrior(f).mean;
    lin += b * v;
    contributions.push({ feature: f, label: featurePrior(f).label, impact: Math.exp(b * v) - 1 });
  }
  const multiplier = Math.exp(lin);
  const stats = {} as Record<StatKey, StatForecast>;
  for (const s of STATS) {
    const { A, B } = state.rates[s];
    const exposure = (mins / 90) * (CONTEXT_STATS.has(s) ? multiplier : 1);
    stats[s] = CONTINUOUS.has(s) ? continuousForecast(A, B, exposure) : negBinForecast(A, B, exposure);
  }
  const shares = STATS.map((s) => state.rates[s].dataShare);
  return {
    stats,
    rating: state.rating.mean,
    minutes: mins,
    multiplier,
    contributions,
    dataShare: shares.reduce((a, b) => a + b, 0) / shares.length,
  };
}

export interface WalkForwardPoint {
  index: number;
  logId?: string;
  matchDate: string;
  opponent?: string;
  isAway: boolean;
  minutes: number;
  stats: Partial<Record<StatKey, { predicted: number; sd: number; actual: number; naive: number; noiseFloor: number }>>;
  /** Error medio normalizado (|real − pred| / tasa base de la posición), promedio de stats. */
  modelError: number;
  naiveError: number;
  noiseFloor: number;
  dataShare: number;
}

/**
 * Validación honesta partido a partido: cada partido se predice SOLO con los
 * partidos anteriores (como si fuera la víspera) y se compara con lo que pasó.
 * El "ingenuo" es lo que haría cualquiera: la media simple de sus partidos previos.
 * Los minutos se toman como dados (los decide el entrenador, no el jugador).
 */
export function walkForward(logsAsc: ModelLog[], priorInput: PlayerPriorInput): WalkForwardPoint[] {
  const logs = logsAsc.filter((l) => Number(l.minutesPlayed) > 0);
  const priors = priorRates(priorInput);
  const scale = Object.fromEntries(STATS.map((s) => [s, Math.max(priors[s], s === "xG" ? 0.1 : 0.5)])) as Record<StatKey, number>;
  const points: WalkForwardPoint[] = [];
  for (let i = 0; i < logs.length; i++) {
    const history = logs.slice(0, i);
    const state = fitProfile(history, priorInput);
    const fc = forecast(state, logs[i], Number(logs[i].minutesPlayed));
    const stats: WalkForwardPoint["stats"] = {};
    let me = 0;
    let ne = 0;
    let nf = 0;
    let n = 0;
    for (const s of STATS) {
      const actual = readStat(logs[i].rawStats, s);
      if (actual === null) continue;
      const prev = history.map((h) => readStat(h.rawStats, s)).filter((v): v is number => v !== null);
      const naive = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : priors[s] * (Number(logs[i].minutesPlayed) / 90);
      const pred = fc.stats[s];
      stats[s] = { predicted: pred.mean, sd: pred.sd, actual, naive, noiseFloor: pred.noiseFloor };
      me += Math.abs(actual - pred.mean) / scale[s];
      ne += Math.abs(actual - naive) / scale[s];
      nf += pred.noiseFloor / scale[s];
      n++;
    }
    if (!n) continue;
    points.push({
      index: points.length + 1,
      logId: logs[i].id,
      matchDate: logs[i].matchDate,
      opponent: logs[i].opponent,
      isAway: logs[i].isAway,
      minutes: Number(logs[i].minutesPlayed),
      stats,
      modelError: me / n,
      naiveError: ne / n,
      noiseFloor: nf / n,
      dataShare: fc.dataShare,
    });
  }
  return points;
}

export function summarizeWalkForward(points: WalkForwardPoint[]) {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const model = mean(points.map((p) => p.modelError));
  const naive = mean(points.map((p) => p.naiveError));
  const floor = mean(points.map((p) => p.noiseFloor));
  const last = points.slice(-8);
  return {
    matches: points.length,
    modelError: model,
    naiveError: naive,
    noiseFloor: floor,
    improvementVsNaivePct: model !== null && naive ? ((naive - model) / naive) * 100 : null,
    recentModelError: mean(last.map((p) => p.modelError)),
    recentNaiveError: mean(last.map((p) => p.naiveError)),
  };
}
