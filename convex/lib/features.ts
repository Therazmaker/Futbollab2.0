/**
 * Detector de patrones (reglas que dictas tú; la IA las traduce): los datos que
 * una regla puede usar, calculados SOLO con lo que se sabía antes del partido.
 * Mismo cálculo para el histórico (backtest) y para los partidos que vienen.
 *
 * Cada dato existe desde tres puntos de vista:
 *   fav_ / dog_   → favorito y no favorito según el mercado
 *   home_ / away_ → local y visitante
 *   team_ / opp_  → el equipo de la regla y su rival (reglas de un equipo concreto)
 */
import { matchXg } from "./xgBlend";

export interface TeamGame {
  date: string;
  league: string;
  gf: number;
  ga: number;
  xgf: number | null;
  xga: number | null;
  home: boolean;
}

/** Datos de un equipo (se combinan con un prefijo: fav_, dog_, home_, away_, team_, opp_) */
export const SIDE_STATS = {
  gf10: "goles a favor por partido (últimos 10)",
  ga10: "goles en contra por partido (últimos 10)",
  xgd10: "diferencia de xG por partido (últimos 10)",
  draws10: "empates en sus últimos 10",
  wins10: "victorias en sus últimos 10",
  pts5: "puntos en sus últimos 5",
  luck10: "goles − xG por partido, últimos 10 (positivo = está teniendo suerte)",
  trend3: "tendencia de xG en sus últimos 3 (último − primero; positivo = mejorando)",
  rest: "días de descanso desde su último partido",
  midweek: "jugó otra competición (Champions, copa…) en los 4 días previos (1 sí / 0 no)",
  gf_last: "goles a favor en su último partido",
  ga_last: "goles en contra en su último partido",
  pts_last: "puntos en su último partido (3 ganó, 1 empató, 0 perdió)",
  xgd_last: "diferencia de xG en su último partido",
} as const;
export type SideStat = keyof typeof SIDE_STATS;

export const PREFIXES = {
  fav: "Favorito",
  dog: "No favorito",
  home: "Local",
  away: "Visitante",
  team: "El equipo de la regla",
  opp: "Su rival",
} as const;

/** Datos del partido (mercado y papeles) */
export const MATCH_STATS = {
  fav_prob: "probabilidad del favorito según el mercado (0–1)",
  dog_prob: "probabilidad del no favorito según el mercado (0–1)",
  draw_prob: "probabilidad de empate según el mercado (0–1)",
  home_prob: "probabilidad del local según el mercado (0–1)",
  away_prob: "probabilidad del visitante según el mercado (0–1)",
  fav_is_home: "el favorito juega en casa (1/0)",
  team_prob: "probabilidad de que gane el equipo de la regla (0–1)",
  team_is_home: "el equipo de la regla juega en casa (1/0)",
  team_is_fav: "el equipo de la regla es el favorito (1/0)",
} as const;

export const TARGETS = {
  fav_win: "Gana el favorito",
  fav_not_win: "El favorito NO gana (empate o sorpresa)",
  dog_win: "Gana el no favorito",
  draw: "Empate",
  home_win: "Gana el local",
  away_win: "Gana el visitante",
  team_win: "Gana el equipo de la regla",
  team_not_lose: "El equipo de la regla no pierde",
  team_not_win: "El equipo de la regla no gana",
  over25: "Más de 2.5 goles",
  under25: "Menos de 2.5 goles",
  btts_yes: "Ambos marcan",
  btts_no: "No marcan los dos",
} as const;
export type TargetKey = keyof typeof TARGETS;

export const TEAM_ONLY_TARGETS = new Set(["team_win", "team_not_lose", "team_not_win"]);

/** Catálogo completo de datos válidos (para validar y para el prompt de la IA). */
export function featureCatalog(): Record<string, string> {
  const out: Record<string, string> = { ...MATCH_STATS };
  for (const [p, pl] of Object.entries(PREFIXES)) for (const [s, sl] of Object.entries(SIDE_STATS)) out[`${p}_${s}`] = `${pl}: ${sl}`;
  return out;
}

const DAY = 86_400_000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function fairOf(o?: { home?: number; draw?: number; away?: number } | null) {
  if (!o || !(o.home! > 1 && o.draw! > 1 && o.away! > 1)) return null;
  const i = [1 / o.home!, 1 / o.draw!, 1 / o.away!];
  const t = i[0] + i[1] + i[2];
  return { home: i[0] / t, draw: i[1] / t, away: i[2] / t };
}

function sideStats(H: TeamGame[], date: string, league: string): Record<SideStat, number> {
  const l10 = H.slice(-10);
  const xs = l10.filter((g) => g.xgf !== null && g.xga !== null);
  const l3 = H.slice(-3).filter((g) => g.xgf !== null && g.xga !== null);
  const last = H[H.length - 1];
  const t0 = Date.parse(date);
  const pts = (g: TeamGame) => (g.gf > g.ga ? 3 : g.gf === g.ga ? 1 : 0);
  return {
    gf10: mean(l10.map((g) => g.gf)),
    ga10: mean(l10.map((g) => g.ga)),
    xgd10: xs.length >= 5 ? mean(xs.map((g) => g.xgf! - g.xga!)) : NaN,
    draws10: l10.filter((g) => g.gf === g.ga).length,
    wins10: l10.filter((g) => g.gf > g.ga).length,
    pts5: H.slice(-5).reduce((a, g) => a + pts(g), 0),
    luck10: xs.length >= 5 ? mean(xs.map((g) => g.gf - g.ga - (g.xgf! - g.xga!))) : NaN,
    trend3: l3.length === 3 ? l3[2].xgf! - l3[2].xga! - (l3[0].xgf! - l3[0].xga!) : NaN,
    rest: last ? Math.round((t0 - Date.parse(last.date)) / DAY) : NaN,
    midweek: H.some((g) => g.league !== league && t0 > Date.parse(g.date) && t0 - Date.parse(g.date) <= 4 * DAY) ? 1 : 0,
    gf_last: last ? last.gf : NaN,
    ga_last: last ? last.ga : NaN,
    pts_last: last ? pts(last) : NaN,
    xgd_last: last && last.xgf !== null && last.xga !== null ? last.xgf - last.xga : NaN,
  };
}

/**
 * Datos de un partido. `teamSide` = "home" | "away" si la regla es de un equipo
 * concreto (define team_ / opp_). Necesita ≥5 partidos previos de cada equipo.
 */
export function computeFeatures(
  date: string,
  league: string,
  fair: { home: number; draw: number; away: number },
  homeHist: TeamGame[],
  awayHist: TeamGame[],
  teamSide?: "home" | "away"
): Record<string, number> | null {
  if (homeHist.length < 5 || awayHist.length < 5) return null;
  const h = sideStats(homeHist, date, league);
  const a = sideStats(awayHist, date, league);
  const favHome = fair.home >= fair.away;
  const out: Record<string, number> = {
    fav_prob: favHome ? fair.home : fair.away,
    dog_prob: favHome ? fair.away : fair.home,
    draw_prob: fair.draw,
    home_prob: fair.home,
    away_prob: fair.away,
    fav_is_home: favHome ? 1 : 0,
  };
  const put = (p: string, s: Record<SideStat, number>) => {
    for (const [k, v] of Object.entries(s)) out[`${p}_${k}`] = v;
  };
  put("home", h);
  put("away", a);
  put("fav", favHome ? h : a);
  put("dog", favHome ? a : h);
  if (teamSide) {
    put("team", teamSide === "home" ? h : a);
    put("opp", teamSide === "home" ? a : h);
    out.team_prob = teamSide === "home" ? fair.home : fair.away;
    out.team_is_home = teamSide === "home" ? 1 : 0;
    out.team_is_fav = (teamSide === "home") === favHome ? 1 : 0;
  }
  return out;
}

export interface Condition {
  feature: string;
  op: ">=" | "<=" | "=";
  value: number;
}

/** ¿Cumple el partido todas las condiciones? (un dato que falta = no cumple) */
export function matchesConditions(features: Record<string, number>, conds: Condition[]) {
  return conds.every((c) => {
    const x = features[c.feature];
    if (x === undefined || Number.isNaN(x)) return false;
    return c.op === ">=" ? x >= c.value : c.op === "<=" ? x <= c.value : Math.abs(x - c.value) < 1e-9;
  });
}

/** ¿Pasó el objetivo? y su probabilidad y cuota de mercado (null si no se puede sacar). */
export function targetOutcome(
  target: string,
  hg: number,
  ag: number,
  fair: { home: number; draw: number; away: number } | null,
  odds: { home?: number; draw?: number; away?: number; over25?: number; under25?: number } | null,
  teamSide?: "home" | "away"
): { hit: boolean; p: number | null; odds: number | null } {
  const favHome = fair ? fair.home >= fair.away : true;
  const side = (s: "fav" | "dog" | "team" | "opp"): "home" | "away" =>
    s === "fav" ? (favHome ? "home" : "away") : s === "dog" ? (favHome ? "away" : "home") : s === "team" ? teamSide! : teamSide === "home" ? "away" : "home";
  const goals = (k: "home" | "away") => (k === "home" ? hg : ag);
  const other = (k: "home" | "away") => (k === "home" ? "away" : "home");
  const win = (k: "home" | "away") => ({ hit: goals(k) > goals(other(k)), p: fair?.[k] ?? null, odds: odds?.[k] ?? null });
  const notWin = (k: "home" | "away") => {
    const p = fair ? 1 - fair[k] : null;
    return { hit: goals(k) <= goals(other(k)), p, odds: p ? 0.95 / p : null }; // doble oportunidad aprox. (margen 5 %)
  };
  const notLose = (k: "home" | "away") => {
    const p = fair ? 1 - fair[other(k)] : null;
    return { hit: goals(k) >= goals(other(k)), p, odds: p ? 0.95 / p : null };
  };
  const ou = odds?.over25 && odds?.under25 ? 1 / odds.over25 / (1 / odds.over25 + 1 / odds.under25) : null;
  switch (target) {
    case "fav_win":
      return win(side("fav"));
    case "fav_not_win":
      return notWin(side("fav"));
    case "dog_win":
      return win(side("dog"));
    case "draw":
      return { hit: hg === ag, p: fair?.draw ?? null, odds: odds?.draw ?? null };
    case "home_win":
      return win("home");
    case "away_win":
      return win("away");
    case "team_win":
      return win(side("team"));
    case "team_not_lose":
      return notLose(side("team"));
    case "team_not_win":
      return notWin(side("team"));
    case "over25":
      return { hit: hg + ag > 2, p: ou, odds: odds?.over25 ?? null };
    case "under25":
      return { hit: hg + ag <= 2, p: ou === null ? null : 1 - ou, odds: odds?.under25 ?? null };
    case "btts_yes":
      return { hit: hg > 0 && ag > 0, p: null, odds: null };
    case "btts_no":
      return { hit: !(hg > 0 && ag > 0), p: null, odds: null };
    default:
      return { hit: false, p: null, odds: null };
  }
}

/** Un partido desde el punto de vista de un equipo (null si no tiene marcador). */
export function teamGame(
  m: { date: string; league: string; homeGoals?: number; awayGoals?: number; stats?: any },
  isHome: boolean
): TeamGame | null {
  if (m.homeGoals === undefined || m.awayGoals === undefined) return null;
  const xg = matchXg(m.stats);
  return {
    date: m.date,
    league: m.league,
    gf: isHome ? m.homeGoals : m.awayGoals,
    ga: isHome ? m.awayGoals : m.homeGoals,
    xgf: xg ? (isHome ? xg.home : xg.away) : null,
    xga: xg ? (isHome ? xg.away : xg.home) : null,
    home: isHome,
  };
}

export interface BacktestResult {
  n: number;
  hits: number;
  rate: number | null;
  ci: { low: number; high: number };
  market: number | null;
  roi: number | null;
  nOdds: number;
  verdict: "better" | "same" | "worse" | "few";
  computedAt: number;
}

/** ¿Le gana la regla al mercado? (con el margen de error al 90 %) */
export function verdictOf(n: number, market: number | null, ci: { low: number; high: number }): BacktestResult["verdict"] {
  if (n < 30 || market === null) return "few";
  if (ci.low > market) return "better";
  if (ci.high < market) return "worse";
  return "same";
}

/** Valida una regla (datos del catálogo, operador, objetivo) — para lo que devuelva la IA. */
export function validateRule(rule: { conditions: Condition[]; target: string; teamScoped: boolean }) {
  const cat = featureCatalog();
  const errors: string[] = [];
  if (!(rule.target in TARGETS)) errors.push(`Objetivo desconocido: ${rule.target}`);
  if (TEAM_ONLY_TARGETS.has(rule.target) && !rule.teamScoped) errors.push("Ese objetivo necesita una regla de un equipo concreto.");
  for (const c of rule.conditions) {
    if (!(c.feature in cat)) errors.push(`Dato desconocido: ${c.feature}`);
    if (!rule.teamScoped && /^(team|opp)_/.test(c.feature)) errors.push(`"${c.feature}" solo vale en reglas de un equipo concreto.`);
    if (![">=", "<=", "="].includes(c.op)) errors.push(`Operador no válido: ${c.op}`);
    if (!Number.isFinite(Number(c.value))) errors.push(`Valor no numérico en ${c.feature}`);
  }
  return errors;
}
