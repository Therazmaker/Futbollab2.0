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
}

export interface RadarAnalysis {
  markets: Markets;
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

export function analyzeRadarMatch(input: RadarInput): RadarAnalysis {
  const markets = computeMarkets(input.home, input.away, input.league);
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
      flags.push({
        code: side === "home" ? "BAJAS_LOCAL" : "BAJAS_VISITANTE",
        label: `Bajas ${nameOf(side)}: ${abs[side].length}`,
        tone: "risk",
        detail: abs[side].join(", "),
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
