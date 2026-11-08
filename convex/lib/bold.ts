/**
 * Radar AUDAZ: lo que diría el Radar si se atreviera.
 *
 * El conservador (lib/radar.ts) parte del mercado y solo le aplica tus bajas a
 * medio peso, porque el backtest dice que el modelo solo no le gana al mercado.
 * El Audaz parte también del mercado, pero se deja EMPUJAR por todo lo que el
 * conservador ignora, y enseña cada empujón:
 *   - el modelo (goles + xG) a un 30 % de su diferencia con el mercado
 *     (el modelo solo, a cualquier peso, pierde ~22 % en el histórico: 3.920 partidos)
 *   - tus bajas a peso completo
 *   - las reglas del Detector que se cumplen, según lo que dieron en el histórico
 *   - las tendencias de las narraciones (favorito que se relaja, underdog que compite…)
 *   - las señales de la previa (empate, sorpresa, a quién favorece el relato)
 * Solo hay APUESTA audaz si la empuja algo más que el modelo (una regla, tus bajas,
 * las narraciones o la previa): el modelo solo ya sabemos que pierde.
 * Los pesos son a propósito "atrevidos" y NO están validados: para eso se guarda
 * la foto previa del Audaz y Entrenamiento lo compara con el conservador y el mercado.
 */
import type { TeamTrends } from "./narrative";
import type { PreviewAnalysis } from "./preview";
import type { RuleHit } from "./ruleMatch";

export type Outcome = "home" | "draw" | "away";
type P3 = Record<Outcome, number>;

export const BOLD_WEIGHTS = {
  model: 0.3, // fracción de la diferencia modelo − mercado que se acepta
  ruleMaxLift: 0.12, // como mucho 12 pts por regla
  ruleMinN: 30, // una regla solo empuja si se cumplió al menos 30 veces en el histórico
  narrative: 0.03,
  narrativeFlattered: 0.02,
  previewDraw: 0.03,
  previewUpset: 0.03,
  previewLean: 0.02,
  previewMotivation: 0.015,
  pickEdge: 0.03, // pick audaz si ve ≥ 3 pts más que el mercado
};

export interface BoldPart {
  source: "modelo" | "bajas" | "regla" | "narraciones" | "previa";
  label: string;
  delta: P3; // en probabilidad (0.05 = 5 pts)
}

export interface BoldResult {
  probs: P3;
  market: P3;
  parts: BoldPart[];
  craziness: number; // máxima distancia al mercado (0–1)
  level: "mercado" | "atrevido" | "loco";
  pick: { outcome: Outcome; prob: number; market: number; odds: number | null; ev: number | null } | null;
}

const OUT: Outcome[] = ["home", "draw", "away"];
const zero = (): P3 => ({ home: 0, draw: 0, away: 0 });

/** Sube `amount` a un resultado y lo quita a los otros dos en proporción a su probabilidad. */
function pushTo(base: P3, o: Outcome, amount: number): P3 {
  const d = zero();
  d[o] = amount;
  const others = OUT.filter((x) => x !== o);
  const tot = others.reduce((a, x) => a + base[x], 0) || 1;
  for (const x of others) d[x] = -amount * (base[x] / tot);
  return d;
}

export interface BoldInput {
  market: P3; // tus cuotas sin margen
  odds: { home?: number; draw?: number; away?: number } | null;
  modelBase: P3; // modelo SIN bajas
  modelWithAbsences: P3; // modelo con bajas
  rules: RuleHit[];
  trends: { home: TeamTrends | null; away: TeamTrends | null };
  preview: PreviewAnalysis | null;
  names: { home: string; away: string };
}

export function computeBold(x: BoldInput): BoldResult {
  const W = BOLD_WEIGHTS;
  const M = x.market;
  const fav: Outcome = M.home >= M.away ? "home" : "away";
  const dog: Outcome = fav === "home" ? "away" : "home";
  const name = (o: Outcome) => (o === "home" ? x.names.home : o === "away" ? x.names.away : "empate");
  const parts: BoldPart[] = [];

  // 1) Modelo (sin bajas, para no contarlas dos veces)
  const dm = zero();
  for (const o of OUT) dm[o] = W.model * (x.modelBase[o] - M[o]);
  if (OUT.some((o) => Math.abs(dm[o]) >= 0.005)) parts.push({ source: "modelo", label: "El modelo (goles + xG de 3 temporadas)", delta: dm });

  // 2) Bajas a peso completo
  const ratio = OUT.map((o) => x.modelWithAbsences[o] / Math.max(1e-6, x.modelBase[o]));
  if (ratio.some((r) => Math.abs(r - 1) > 0.002)) {
    const raw = OUT.map((o, i) => M[o] * ratio[i]);
    const t = raw[0] + raw[1] + raw[2];
    const d = zero();
    OUT.forEach((o, i) => (d[o] = raw[i] / t - M[o]));
    parts.push({ source: "bajas", label: "Tus bajas registradas, a peso completo", delta: d });
  }

  // 3) Reglas del Detector con muestra suficiente: empujan lo que se desviaron del mercado en el histórico
  for (const h of x.rules) {
    if (h.n < W.ruleMinN || h.rate === null || h.market === null) continue;
    const lift = Math.max(-W.ruleMaxLift, Math.min(W.ruleMaxLift, h.rate - h.market));
    if (Math.abs(lift) < 0.01) continue;
    const team = h.teamSide ?? fav;
    const opp: Outcome = team === "home" ? "away" : "home";
    let d: P3 | null = null;
    switch (h.target) {
      case "fav_win": d = pushTo(M, fav, lift); break;
      case "fav_not_win": d = pushTo(M, fav, -lift); break;
      case "dog_win": d = pushTo(M, dog, lift); break;
      case "draw": d = pushTo(M, "draw", lift); break;
      case "home_win": d = pushTo(M, "home", lift); break;
      case "away_win": d = pushTo(M, "away", lift); break;
      case "team_win": d = pushTo(M, team, lift); break;
      case "team_not_lose": d = pushTo(M, opp, -lift); break;
      case "team_not_win": d = pushTo(M, team, -lift); break;
    }
    if (d) parts.push({ source: "regla", label: `Regla «${h.name}» (${Math.round(h.rate * 100)} % vs ${Math.round(h.market * 100)} % del mercado, n=${h.n})`, delta: d });
  }

  // 4) Tendencias de las narraciones
  const tr = (o: "home" | "away") => x.trends[o];
  const F = tr(fav as "home" | "away"), D = tr(dog as "home" | "away");
  if (F && F.asFavorite.matches >= 2 && F.asFavorite.easedOff / F.asFavorite.matches >= 0.5)
    parts.push({ source: "narraciones", label: `${name(fav)} se relaja de favorito (${F.asFavorite.easedOff} de ${F.asFavorite.matches})`, delta: pushTo(M, fav, -W.narrative) });
  if (D && D.asUnderdog.matches >= 2 && D.asUnderdog.competitive / D.asUnderdog.matches >= 0.5)
    parts.push({ source: "narraciones", label: `${name(dog)} compite de underdog (${D.asUnderdog.competitive} de ${D.asUnderdog.matches})`, delta: pushTo(M, fav, -W.narrative) });
  for (const o of ["home", "away"] as const) {
    const t = tr(o);
    if (!t || t.matches < 2) continue;
    if (t.flattered >= 2 && t.flattered / t.matches >= 0.5)
      parts.push({ source: "narraciones", label: `A ${name(o)} el marcador le ha favorecido (${t.flattered} de ${t.matches})`, delta: pushTo(M, o, -W.narrativeFlattered) });
    if (t.hardDone >= 2 && t.hardDone / t.matches >= 0.5)
      parts.push({ source: "narraciones", label: `${name(o)} juega mejor de lo que dicen sus resultados (${t.hardDone} de ${t.matches})`, delta: pushTo(M, o, W.narrativeFlattered) });
  }

  // 5) Previa
  const pv = x.preview?.signals;
  if (pv) {
    if (pv.drawSignal === "high") parts.push({ source: "previa", label: "La previa pinta un partido de empate", delta: pushTo(M, "draw", W.previewDraw) });
    if (pv.upsetAlert === "high") parts.push({ source: "previa", label: "La previa ve motivos para la sorpresa", delta: pushTo(M, dog, W.previewUpset) });
    if (pv.narrativeFavours !== "neutral")
      parts.push({ source: "previa", label: `El relato de la previa favorece a ${name(pv.narrativeFavours)}`, delta: pushTo(M, pv.narrativeFavours, W.previewLean) });
    if (pv.motivationGap !== "neutral")
      parts.push({ source: "previa", label: `${name(pv.motivationGap)} se juega más`, delta: pushTo(M, pv.motivationGap, W.previewMotivation) });
  }

  // Suma de empujones, sin bajar de un 2 % por resultado
  const raw = OUT.map((o) => Math.max(0.02, M[o] + parts.reduce((a, p) => a + p.delta[o], 0)));
  const t = raw[0] + raw[1] + raw[2];
  const probs = { home: +(raw[0] / t).toFixed(3), draw: +(raw[1] / t).toFixed(3), away: +(raw[2] / t).toFixed(3) };
  const craziness = Math.max(...OUT.map((o) => Math.abs(probs[o] - M[o])));
  const best = OUT.reduce((a, b) => (probs[b] - M[b] > probs[a] - M[a] ? b : a));
  const edge = probs[best] - M[best];
  const odds = x.odds?.[best] ?? null;
  return {
    probs,
    market: { home: +M.home.toFixed(3), draw: +M.draw.toFixed(3), away: +M.away.toFixed(3) },
    parts,
    craziness: +craziness.toFixed(3),
    level: craziness < 0.03 ? "mercado" : craziness < 0.07 ? "atrevido" : "loco",
    pick:
      edge >= W.pickEdge && parts.some((p) => p.source !== "modelo" && p.delta[best] >= 0.01)
        ? { outcome: best, prob: probs[best], market: M[best], odds, ev: odds ? +(odds * probs[best] - 1).toFixed(3) : null }
        : null,
  };
}
