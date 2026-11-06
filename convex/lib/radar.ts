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

/**
 * Con cuotas, el 1X2 parte del MERCADO (tus cuotas sin margen), no del modelo.
 *
 * Backtest (football-data, 3.920 partidos 2024-08 → 2026-11, cuota media de
 * apertura): mezclar el modelo con el mercado empeora siempre la predicción —
 * peso 0 % → log-loss 0,9688; 10 % → 0,9699; 30 % → 0,9728— y una mezcla
 * aprendida le da al modelo peso NEGATIVO. Es decir: con solo resultados y tiros
 * el modelo no sabe nada que el mercado no sepa.
 *
 * Encima del mercado solo se aplican TUS correcciones (por ahora, las bajas):
 *   P ∝ mercado · (modelo con bajas / modelo sin bajas)^CORRECTION_WEIGHT
 * El mercado suele conocer las lesiones públicas, así que empiezan a medio peso.
 * Entrenamiento mide si esas correcciones mejoran al mercado.
 */
export const CORRECTION_WEIGHT = 0.5;
export const INFO_EDGE = 0.02; // "Tu información" si tus correcciones mueven ≥ 2 pts

export interface RadarAnalysis {
  /** Mercados del partido; con cuotas, el 1X2 es mercado + tus correcciones */
  markets: Markets;
  /** 1X2 del modelo (fuerza + bajas), para comparar */
  modelProbabilities: { home: number; draw: number; away: number };
  /** De dónde sale el 1X2 mostrado */
  source: "market" | "model";
  /** Mercados sin el ajuste por bajas (para mostrar cuánto mueven) */
  baseMarkets: Markets | null;
  attackFactor: { home: number; away: number };
  fair: { home: number; draw: number; away: number; margin: number } | null;
  edges: Record<Outcome, number> | null; // 1X2 final − mercado (solo lo que mueven tus correcciones)
  modelEdges: Record<Outcome, number> | null; // modelo − mercado
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
 * Todo (1X2 y goles) sale del Poisson con el ataque reducido: desde que los
 * totales salen de la fuerza, una baja ya baja el total esperado por sí sola.
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
  return { ...computeMarkets(adj(home, factor.home), adj(away, factor.away), league), reliable: base.reliable };
}

export function analyzeRadarMatch(input: RadarInput): RadarAnalysis {
  const share = input.absentXgShare ?? { home: 0, away: 0 };
  const attackFactor = {
    home: +(1 - Math.min(MAX_ABSENCE_HIT, REPLACEMENT_LOSS * share.home)).toFixed(3),
    away: +(1 - Math.min(MAX_ABSENCE_HIT, REPLACEMENT_LOSS * share.away)).toFixed(3),
  };
  const hasAbsenceEffect = attackFactor.home < 1 || attackFactor.away < 1;
  const baseMarkets = hasAbsenceEffect ? computeMarkets(input.home, input.away, input.league) : null;
  let markets = marketsWithAttackFactor(input.home, input.away, input.league, attackFactor);
  const fair = input.odds ? fairProbabilities(input.odds) : null;
  const outcomes: Outcome[] = ["home", "draw", "away"];
  const modelP = markets.probabilities;
  const baseP = baseMarkets ? baseMarkets.probabilities : modelP;
  let P = modelP;
  if (fair) {
    const raw = outcomes.map((o) => fair[o] * Math.pow(modelP[o] / Math.max(1e-6, baseP[o]), CORRECTION_WEIGHT));
    const t = raw[0] + raw[1] + raw[2];
    P = { home: +(raw[0] / t).toFixed(3), draw: +(raw[1] / t).toFixed(3), away: +(raw[2] / t).toFixed(3) };
    markets = { ...markets, probabilities: P };
  }
  const diff = (a: Record<Outcome, number>) =>
    fair ? (Object.fromEntries(outcomes.map((o) => [o, +(a[o] - fair[o]).toFixed(3)])) as Record<Outcome, number>) : null;
  const edges = diff(P);
  const modelEdges = diff(modelP);
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
    // Solo hay "ventaja" si TUS correcciones (bajas) mueven el 1X2 frente al mercado
    for (const o of outcomes) {
      const odds = input.odds[o]!;
      if (edges[o] >= INFO_EDGE && P[o] >= 0.15 && (!bestEdge || edges[o] > bestEdge.edge)) {
        bestEdge = { outcome: o, edge: edges[o], model: P[o], fair: fair[o], odds };
      }
    }
    if (bestEdge) {
      flags.push({
        code: "TU_INFO",
        label: `Tu información: ${nameOf(bestEdge.outcome)} @${bestEdge.odds}`,
        tone: "good",
        detail:
          `Tus bajas mueven el ${LABEL[bestEdge.outcome]} de ${pct(bestEdge.fair)} (mercado) a ${pct(bestEdge.model)} (+${Math.round(bestEdge.edge * 100)} pts). ` +
          `Solo vale si el mercado aún no lo sabe. Su CLV se mide en Entrenamiento.`,
      });
    }
    const mktFav: Outcome = fair.home >= fair.away ? "home" : "away";
    if (fair[mktFav] >= 0.55 && fair[mktFav] - modelP[mktFav] >= RADAR_RULES.fragileGap) {
      flags.push({
        code: "FAVORITO_FRAGIL",
        label: `Favorito frágil: ${nameOf(mktFav)}`,
        tone: "info",
        detail: `El mercado le da ${pct(fair[mktFav])}, el modelo ${pct(modelP[mktFav])}. Ojo: en el histórico el mercado acierta más que el modelo.`,
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
  const disagreement = modelEdges ? Math.min(1, Math.max(...outcomes.map((o) => Math.abs(modelEdges[o]))) / 0.15) : null;
  const logged = input.playersLogged ?? { home: 0, away: 0 };
  const data = Math.min(1, (Math.min(logged.home, 8) + Math.min(logged.away, 8)) / 16) * (markets.reliable ? 1 : 0.5);
  const score =
    disagreement === null
      ? 0.65 * entropy + 0.35 * data
      : 0.35 * entropy + 0.45 * disagreement + 0.2 * data;
  return {
    markets,
    modelProbabilities: modelP,
    source: fair ? "market" : "model",
    baseMarkets,
    attackFactor,
    fair,
    edges,
    modelEdges,
    bestEdge,
    favorite,
    flags,
    studyScore: Math.round(score * 100),
    studyParts: { uncertainty: +entropy.toFixed(3), disagreement: disagreement === null ? null : +disagreement.toFixed(3), data: +data.toFixed(3) },
  };
}

export const OUTCOME_LABEL = LABEL;
