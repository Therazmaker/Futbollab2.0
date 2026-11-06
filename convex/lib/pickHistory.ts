/**
 * Histórico del Radar: métricas de las predicciones (IA y tuyas), como el panel
 * del FutbolLab viejo — acierto, ROI, beneficio, rachas, barras por liga /
 * mercado / pick — más lo que le faltaba: comparar con lo que el Radar esperaba,
 * calibración de la confianza y CLV.
 */
import { wilson } from "./radarTraining";

export interface HistoryRow {
  id: string;
  matchId: string;
  date: string;
  competition: string;
  home: string;
  away: string;
  source: "ai" | "user";
  market: string;
  pick: string;
  label: string;
  confidence: number | null;
  odds: number | null;
  systemProb: number | null;
  marketProb: number | null;
  closingProb: number | null;
  verdict: "won" | "lost" | null;
  score: string | null;
}

type Agg = { n: number; won: number; expected: number; nExpected: number; staked: number; profit: number };
const agg = (): Agg => ({ n: 0, won: 0, expected: 0, nExpected: 0, staked: 0, profit: 0 });
function addTo(a: Agg, r: HistoryRow) {
  a.n++;
  if (r.verdict === "won") a.won++;
  if (r.systemProb !== null) {
    a.expected += r.systemProb;
    a.nExpected++;
  }
  if (r.odds) {
    a.staked++;
    a.profit += r.verdict === "won" ? r.odds - 1 : -1;
  }
}
const out = (a: Agg) => ({
  n: a.n,
  won: a.won,
  rate: a.n ? a.won / a.n : null,
  ci: wilson(a.won, a.n),
  expected: a.nExpected ? a.expected / a.nExpected : null,
  staked: a.staked,
  profit: +a.profit.toFixed(2),
  roi: a.staked ? a.profit / a.staked : null,
});

export function summarizeHistory(rows: HistoryRow[]) {
  const resolved = rows.filter((r) => r.verdict !== null).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  const total = agg();
  const by = { source: {} as Record<string, Agg>, competition: {} as Record<string, Agg>, market: {} as Record<string, Agg>, pick: {} as Record<string, Agg> };
  for (const r of resolved) {
    addTo(total, r);
    addTo((by.source[r.source] ??= agg()), r);
    addTo((by.competition[r.competition] ??= agg()), r);
    addTo((by.market[r.market] ??= agg()), r);
    addTo((by.pick[`${r.market}:${r.pick}`] ??= agg()), r);
  }
  // Rachas (sobre los resueltos, en orden de fecha)
  let best = 0, cur = 0;
  for (const r of resolved) {
    cur = r.verdict === "won" ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  let streak = 0;
  const last = resolved[resolved.length - 1]?.verdict ?? null;
  for (let i = resolved.length - 1; i >= 0 && resolved[i].verdict === last; i--) streak++;

  // Beneficio acumulado por fecha y fuente (solo picks con cuota)
  const curve: Array<{ date: string; ai: number; user: number }> = [];
  const acc = { ai: 0, user: 0 };
  for (const r of resolved) {
    if (!r.odds) continue;
    acc[r.source] += r.verdict === "won" ? r.odds - 1 : -1;
    const lastPt = curve[curve.length - 1];
    if (lastPt && lastPt.date === r.date) {
      lastPt.ai = +acc.ai.toFixed(2);
      lastPt.user = +acc.user.toFixed(2);
    } else curve.push({ date: r.date, ai: +acc.ai.toFixed(2), user: +acc.user.toFixed(2) });
  }

  // Calibración de la confianza (IA y tú, si la diste)
  const edges = [0, 0.4, 0.55, 0.7, 0.85, 1.01];
  const calibration = edges.slice(0, -1).map((lo, i) => {
    const inB = resolved.filter((r) => r.confidence !== null && r.confidence >= lo && r.confidence < edges[i + 1]);
    return {
      range: `${Math.round(lo * 100)}–${Math.round(Math.min(edges[i + 1], 1) * 100)}%`,
      n: inB.length,
      confidence: inB.length ? inB.reduce((a, r) => a + r.confidence!, 0) / inB.length : null,
      observed: inB.length ? inB.filter((r) => r.verdict === "won").length / inB.length : null,
    };
  });

  // CLV de los picks 1X2 / doble oportunidad con cuota y cierre
  const clvRows = resolved.filter((r) => r.odds && r.closingProb !== null);
  const clvVals = clvRows.map((r) => r.odds! * r.closingProb! - 1);
  const clvMean = clvVals.length ? clvVals.reduce((a, b) => a + b, 0) / clvVals.length : null;

  const map = (o: Record<string, Agg>) => Object.entries(o).map(([key, a]) => ({ key, ...out(a) })).sort((x, y) => y.n - x.n);
  return {
    total: rows.length,
    pending: rows.length - resolved.length,
    ...out(total),
    streak: { current: streak, type: last, best },
    bySource: map(by.source),
    byCompetition: map(by.competition),
    byMarket: map(by.market),
    byPick: map(by.pick),
    curve,
    calibration,
    clv: clvMean === null ? null : { n: clvVals.length, mean: clvMean, beat: clvVals.filter((x) => x > 0).length / clvVals.length },
  };
}
