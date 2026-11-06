import { computeMarkets, fairProbabilities, Markets, TeamForMarkets, LeagueForMarkets } from "./markets";

/**
 * Radar 2.0: para cada partido, probabilidades por mercado (modelo validado),
 * comparación con las cuotas si las hay, alertas definidas SOBRE
 * PROBABILIDADES (no sumas de puntos) y un Study Score para ordenar qué
 * partidos vale la pena estudiar.
 */

export type Outcome = "home" | "draw" | "away";

export interface RadarFlag {
  code: string;
  label: string;
  tone: "info" | "good" | "warn" | "risk";
  detail: string;
}

export interface RadarInput {
  home: TeamForMarkets & { name: string };
  away: TeamForMarkets & { name: string };
  league: LeagueForMarkets;
  odds?: { home?: number; draw?: number; away?: number } | null;
  /** Jugadores registrados (con partidos) en cada equipo */
  playersLogged?: { home: number; away: number };
  /** Jugadores de baja en cada equipo */
  absences?: { home: string[]; away: string[] };
  /**
   * Parte del xG del equipo que se pierde por bajas (0–1), según los perfiles
   * de los jugadores lesionados. Se descuenta REPLACEMENT_LOSS de ella.
   */
  absentXgShare?: { home: number; away: number };
}

/**
 * Cuando falta un jugador, otro ocupa su sitio y produce algo: se asume que se
 * pierde la mitad de su aporte. Suposición razonable, todavía SIN VALIDAR con
 * datos (se podrá ajustar cuando haya partidos con bajas registradas).
 */
export const REPLACEMENT_LOSS = 0.5;
export const MAX_ABSENCE_HIT = 0.35; // como mucho −35 % del ataque de un equipo

export interface RadarAnalysis {
  markets: Markets;
  /** Mercados sin el ajuste por bajas (para mostrar cuánto mueven) */
  baseMarkets: Markets | null;
  attackFactor: { home: number; away: number };
  fair: { home: number; draw: number; away: number; margin: number } | null;
  edges: Record<Outcome, number> | null; // modelo − mercado (probabilidad)
  bestEdge: { outcome: Outcome; edge: number; model: number; fair: number; odds: number } | null;
  favorite: Outcome;
  flags: RadarFlag[];
  studyScore: number;
  studyParts: { uncertainty: number; disagreement: number | null; data: number };
}

const LABEL: Record<Outcome, string> = { home: "local", draw: "empate", away: "visitante" };

/** Umbrales de las alertas (documentados en la UI). */
export const RADAR_RULES = {
  favoriteClear: 0.6, // favorito claro si su probabilidad ≥ 60 %
  drawLive: 0.29, // empate vivo: ≥ 29 % (la media de las ligas ronda 26 %)
  upsetAlive: 0.3, // sorpresa posible: el no favorito ≥ 30 %
  valueEdge: 0.05, // valor: el modelo da ≥ 5 puntos más que el mercado
  fragileGap: 0.08, // favorito frágil: el mercado lo ve ≥ 8 puntos más fuerte
};

/**
 * Mercados con el ataque de cada equipo multiplicado por `factor` (bajas).
 * El 1X2 sale del Poisson con el ataque reducido. Para los goles totales se
 * parte de la frecuencia real de la liga y se le suma el cambio que la baja
 * produce en el Poisson (el total esperado baja en proporción al ataque perdido).
 */
export function marketsWithAttackFactor(
  home: TeamForMarkets,
  away: TeamForMarkets,
  league: LeagueForMarkets,
  factor: { home: number; away: number }
): Markets {
  const base = computeMarkets(home, away, league);
  if (factor.home === 1 && factor.away === 1) return base;
  const adj = (t: TeamForMarkets, f: number) => ({ ...t, attackRating: (t.attackRating ?? 1) * f });
  const noRates: LeagueForMarkets = { ...league, goalRates: null };
  const pBase = computeMarkets(home, away, noRates);
  const { home: lhB, away: laB } = pBase.expectedGoals;
  const scale = (lhB * factor.home + laB * factor.away) / (lhB + laB);
  const pAdj = computeMarkets(adj(home, factor.home), adj(away, factor.away), {
    ...noRates,
    goalsPerTeam: (league.goalsPerTeam ?? 1.4) * scale,
  });
  const clamp01 = (x: number) => +Math.min(0.99, Math.max(0.01, x)).toFixed(3);
  return {
    ...pAdj,
    reliable: base.reliable,
    over15: clamp01(base.over15 + (pAdj.over15 - pBase.over15)),
    over25: clamp01(base.over25 + (pAdj.over25 - pBase.over25)),
    over35: clamp01(base.over35 + (pAdj.over35 - pBase.over35)),
    btts: clamp01(base.btts + (pAdj.btts - pBase.btts)),
  };
}

export function analyzeRadarMatch(input: RadarInput): RadarAnalysis {
  const share = input.absentXgShare ?? { home: 0, away: 0 };
  const attackFactor = {
    home: +(1 - Math.min(MAX_ABSENCE_HIT, REPLACEMENT_LOSS * share.home)).toFixed(3),
    away: +(1 - Math.min(MAX_ABSENCE_HIT, REPLACEMENT_LOSS * share.away)).toFixed(3),
  };
  const hasAbsenceEffect = attackFactor.home < 1 || attackFactor.away < 1;
  const baseMarkets = hasAbsenceEffect ? computeMarkets(input.home, input.away, input.league) : null;
  const markets = marketsWithAttackFactor(input.home, input.away, input.league, attackFactor);
  const P = markets.probabilities;
  const fair = input.odds ? fairProbabilities(input.odds) : null;
  const outcomes: Outcome[] = ["home", "draw", "away"];
  const edges = fair ? (Object.fromEntries(outcomes.map((o) => [o, +(P[o] - fair[o]).toFixed(3)])) as Record<Outcome, number>) : null;
  const favorite: Outcome = P.home >= P.away ? "home" : "away";
  const underdog: Outcome = favorite === "home" ? "away" : "home";
  const nameOf = (o: Outcome) => (o === "home" ? input.home.name : o === "away" ? input.away.name : "Empate");
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  const flags: RadarFlag[] = [];
  if (!markets.reliable) {
    flags.push({
      code: "POCOS_DATOS",
      label: "Fuerza sin calcular",
      tone: "warn",
      detail: "Algún equipo no tiene resultados con marcador: se toma como equipo medio.",
    });
  }
  if (P[favorite] >= RADAR_RULES.favoriteClear) {
    flags.push({ code: "FAVORITO_CLARO", label: `Favorito claro: ${nameOf(favorite)}`, tone: "info", detail: `${pct(P[favorite])} de ganar.` });
  }
  if (P.draw >= RADAR_RULES.drawLive) {
    flags.push({ code: "EMPATE_VIVO", label: "Empate vivo", tone: "info", detail: `Empate ${pct(P.draw)} (media de liga ≈ 26 %).` });
  }
  if (P[favorite] >= 0.45 && P[underdog] >= RADAR_RULES.upsetAlive) {
    flags.push({
      code: "SORPRESA_POSIBLE",
      label: `Sorpresa posible: ${nameOf(underdog)}`,
      tone: "warn",
      detail: `El no favorito gana ${pct(P[underdog])} de las veces.`,
    });
  }
  let bestEdge: RadarAnalysis["bestEdge"] = null;
  if (fair && edges && input.odds) {
    for (const o of outcomes) {
      const odds = input.odds[o]!;
      if (edges[o] >= RADAR_RULES.valueEdge && P[o] >= 0.15 && (!bestEdge || edges[o] > bestEdge.edge)) {
        bestEdge = { outcome: o, edge: edges[o], model: P[o], fair: fair[o], odds };
      }
    }
    if (bestEdge) {
      flags.push({
        code: "VALOR",
        label: `Valor: ${nameOf(bestEdge.outcome)} @${bestEdge.odds}`,
        tone: "good",
        detail: `Modelo ${pct(bestEdge.model)} vs mercado ${pct(bestEdge.fair)} (+${Math.round(bestEdge.edge * 100)} pts).`,
      });
    }
    const mktFav: Outcome = fair.home >= fair.away ? "home" : "away";
    if (fair[mktFav] >= 0.55 && fair[mktFav] - P[mktFav] >= RADAR_RULES.fragileGap) {
      flags.push({
        code: "FAVORITO_FRAGIL",
        label: `Favorito frágil: ${nameOf(mktFav)}`,
        tone: "risk",
        detail: `El mercado le da ${pct(fair[mktFav])}, el modelo ${pct(P[mktFav])}.`,
      });
    }
  }
  const abs = input.absences ?? { home: [], away: [] };
  for (const side of ["home", "away"] as const) {
    if (abs[side].length) {
      const hit = Math.round((1 - attackFactor[side]) * 100);
      flags.push({
        code: side === "home" ? "BAJAS_LOCAL" : "BAJAS_VISITANTE",
        label: `Bajas ${nameOf(side)}: ${abs[side].length}${hit ? ` (−${hit}% ataque)` : ""}`,
        tone: "risk",
        detail: abs[side].join(", ") + (hit ? `. Su ataque baja un ${hit}% (se asume que el sustituto cubre la mitad).` : ". Sin perfil con xG: no se ajusta el ataque."),
      });
    }
  }

  // Study Score (0–100): incertidumbre del resultado + discrepancia con el
  // mercado + datos propios disponibles.
  const entropy = -outcomes.reduce((a, o) => a + (P[o] > 0 ? P[o] * Math.log(P[o]) : 0), 0) / Math.log(3);
  const disagreement = edges ? Math.min(1, Math.max(...outcomes.map((o) => Math.abs(edges[o]))) / 0.15) : null;
  const logged = input.playersLogged ?? { home: 0, away: 0 };
  const data = Math.min(1, (Math.min(logged.home, 8) + Math.min(logged.away, 8)) / 16) * (markets.reliable ? 1 : 0.5);
  const score =
    disagreement === null
      ? 0.65 * entropy + 0.35 * data
      : 0.35 * entropy + 0.45 * disagreement + 0.2 * data;
  return {
    markets,
    baseMarkets,
    attackFactor,
    fair,
    edges,
    bestEdge,
    favorite,
    flags,
    studyScore: Math.round(score * 100),
    studyParts: { uncertainty: +entropy.toFixed(3), disagreement: disagreement === null ? null : +disagreement.toFixed(3), data: +data.toFixed(3) },
  };
}

export const OUTCOME_LABEL = LABEL;
