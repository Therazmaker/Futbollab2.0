import type { Doc } from "../_generated/dataModel";
import { computeFeatures, Condition, fairOf, matchesConditions, targetOutcome, teamGame, TeamGame, verdictOf } from "./features";
import { wilson } from "./radarTraining";

export type M = { _id: string; date: string; league: string; homeTeamId: string; awayTeamId: string; homeGoals?: number; awayGoals?: number; stats?: any; odds?: any; closingOdds?: any };

/** Recorre todos los partidos en orden y evalúa las reglas con lo que se sabía antes de cada uno. */
export function backtestRules(all: M[], rules: Array<Pick<Doc<"radarRules">, "_id" | "conditions" | "target" | "teamId" | "createdAt">>) {
  const hist = new Map<string, TeamGame[]>();
  const H = (id: string) => (hist.has(id) ? hist.get(id)! : (hist.set(id, []), hist.get(id)!));
  const acc = rules.map(() => ({ n: 0, hits: 0, p: 0, nP: 0, profit: 0, nOdds: 0, live: { n: 0, hits: 0 }, last: [] as Array<{ date: string; matchId: string; hit: boolean }> }));
  const sorted = [...all].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const m of sorted) {
    const scored = m.homeGoals !== undefined && m.awayGoals !== undefined;
    const marketOdds = m.closingOdds ?? m.odds ?? null;
    const fair = fairOf(marketOdds);
    if (scored && fair) {
      const hh = H(m.homeTeamId), ah = H(m.awayTeamId);
      rules.forEach((r, i) => {
        let side: "home" | "away" | undefined;
        if (r.teamId) {
          if (r.teamId === m.homeTeamId) side = "home";
          else if (r.teamId === m.awayTeamId) side = "away";
          else return;
        }
        const f = computeFeatures(m.date, m.league, fair, hh, ah, side);
        if (!f || !matchesConditions(f, r.conditions as Condition[])) return;
        const o = targetOutcome(r.target, m.homeGoals!, m.awayGoals!, fair, marketOdds, side);
        const a = acc[i];
        a.n++;
        if (o.hit) a.hits++;
        if (o.p !== null) { a.p += o.p; a.nP++; }
        if (o.odds) { a.nOdds++; a.profit += o.hit ? o.odds - 1 : -1; }
        if (Date.parse(m.date) >= r.createdAt - 86_400_000) { a.live.n++; if (o.hit) a.live.hits++; }
        a.last.push({ date: m.date, matchId: m._id, hit: o.hit });
        if (a.last.length > 8) a.last.shift();
      });
    }
    if (scored) {
      const g1 = teamGame(m, true), g2 = teamGame(m, false);
      if (g1) H(m.homeTeamId).push(g1);
      if (g2) H(m.awayTeamId).push(g2);
    }
  }
  return acc.map((a) => {
    const ci = wilson(a.hits, a.n);
    const market = a.nP ? a.p / a.nP : null;
    return {
      n: a.n, hits: a.hits, rate: a.n ? a.hits / a.n : null, ci, market,
      roi: a.nOdds ? a.profit / a.nOdds : null, nOdds: a.nOdds, verdict: verdictOf(a.n, market, ci),
      live: a.live, last: a.last.reverse(), computedAt: Date.now(),
    };
  });
}

