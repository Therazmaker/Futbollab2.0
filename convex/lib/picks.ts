/**
 * Predicciones guardadas antes del partido (IA o tuyas) y cómo se resuelven.
 * Mismos 7 mercados que el "Entrenamiento del Radar" del FutbolLab viejo, más doble oportunidad.
 */

export const PICK_MARKETS = {
  result: { label: "Resultado (1X2)", picks: ["home", "draw", "away"] },
  doubleChance: { label: "Doble oportunidad", picks: ["home_draw", "away_draw", "home_away"] },
  btts: { label: "Ambos marcan", picks: ["yes", "no"] },
  over15: { label: "Más de 1.5 goles", picks: ["yes", "no"] },
  over25: { label: "Más de 2.5 goles", picks: ["yes", "no"] },
  cleanSheet: { label: "Portería a cero", picks: ["home", "away", "none"] },
  htGoalless: { label: "0-0 al descanso", picks: ["yes", "no"] },
  htResult: { label: "Resultado al descanso", picks: ["home", "draw", "away"] },
} as const;

export type PickMarket = keyof typeof PICK_MARKETS;

export function pickLabel(market: string, pick: string, home = "Local", away = "Visitante") {
  const side = (p: string) => (p === "home" ? home : p === "away" ? away : "Empate");
  switch (market) {
    case "result":
    case "htResult":
      return `${market === "htResult" ? "Descanso: " : ""}${pick === "draw" ? "Empate" : `Gana ${side(pick)}`}`;
    case "doubleChance":
      return pick === "home_draw" ? `${home} o empate (1X)` : pick === "away_draw" ? `${away} o empate (X2)` : "No empate (12)";
    case "btts":
      return pick === "yes" ? "Ambos marcan" : "No marcan los dos";
    case "over15":
      return pick === "yes" ? "Más de 1.5" : "Menos de 1.5";
    case "over25":
      return pick === "yes" ? "Más de 2.5" : "Menos de 2.5";
    case "cleanSheet":
      return pick === "none" ? "Nadie deja la portería a cero" : `${side(pick)} portería a cero`;
    case "htGoalless":
      return pick === "yes" ? "0-0 al descanso" : "Goles en la 1ª parte";
    default:
      return `${market}: ${pick}`;
  }
}

export function isValidPick(market: string, pick: string) {
  const m = (PICK_MARKETS as Record<string, { picks: readonly string[] }>)[market];
  return !!m && m.picks.includes(pick);
}

type Score = { homeGoals?: number; awayGoals?: number; halfTime?: { home: number; away: number } | null };

/** "won" | "lost" | null (sin resultado todavía, o sin marcador al descanso para los mercados de 1ª parte) */
export function evaluatePick(market: string, pick: string, m: Score): "won" | "lost" | null {
  if (m.homeGoals === undefined || m.awayGoals === undefined) return null;
  const h = m.homeGoals, a = m.awayGoals;
  const out = h > a ? "home" : h === a ? "draw" : "away";
  const ok = (b: boolean) => (b ? "won" : "lost");
  switch (market) {
    case "result":
      return ok(out === pick);
    case "doubleChance":
      return ok(pick === "home_draw" ? out !== "away" : pick === "away_draw" ? out !== "home" : out !== "draw");
    case "btts":
      return ok((h > 0 && a > 0) === (pick === "yes"));
    case "over15":
      return ok((h + a > 1) === (pick === "yes"));
    case "over25":
      return ok((h + a > 2) === (pick === "yes"));
    case "cleanSheet":
      return ok(pick === "home" ? a === 0 : pick === "away" ? h === 0 : h > 0 && a > 0);
    case "htGoalless":
    case "htResult": {
      if (!m.halfTime) return null;
      const hh = m.halfTime.home, ha = m.halfTime.away;
      if (market === "htGoalless") return ok((hh + ha === 0) === (pick === "yes"));
      return ok((hh > ha ? "home" : hh === ha ? "draw" : "away") === pick);
    }
    default:
      return null;
  }
}

export interface ProbSource {
  home: number;
  draw: number;
  away: number;
  over15?: number;
  over25?: number;
  btts?: number;
  homeCleanSheet?: number;
  awayCleanSheet?: number;
  htHome?: number;
  htDraw?: number;
  htAway?: number;
  htGoalless?: number;
}

/** Probabilidad que el Radar da a un pick (null si ese mercado no lo calcula). */
export function probOfPick(p: ProbSource, market: string, pick: string): number | null {
  const yesNo = (x: number | undefined) => (x === undefined ? null : pick === "yes" ? x : 1 - x);
  switch (market) {
    case "result":
      return p[pick as "home" | "draw" | "away"] ?? null;
    case "doubleChance":
      return pick === "home_draw" ? p.home + p.draw : pick === "away_draw" ? p.away + p.draw : p.home + p.away;
    case "btts":
      return yesNo(p.btts);
    case "over15":
      return yesNo(p.over15);
    case "over25":
      return yesNo(p.over25);
    case "cleanSheet":
      if (pick === "home") return p.homeCleanSheet ?? null;
      if (pick === "away") return p.awayCleanSheet ?? null;
      return p.btts ?? null;
    case "htGoalless":
      return yesNo(p.htGoalless);
    case "htResult":
      return pick === "home" ? p.htHome ?? null : pick === "draw" ? p.htDraw ?? null : p.htAway ?? null;
    default:
      return null;
  }
}

/** Probabilidad del mercado (1X2 sin margen) para los picks que se pueden sacar de él. */
export function marketProbOfPick(fair: { home: number; draw: number; away: number } | null, market: string, pick: string) {
  if (!fair) return null;
  if (market === "result") return fair[pick as "home" | "draw" | "away"] ?? null;
  if (market === "doubleChance") return probOfPick(fair, market, pick);
  return null;
}
