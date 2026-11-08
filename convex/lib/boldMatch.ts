import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc } from "../_generated/dataModel";
import { computeBold, BoldResult } from "./bold";
import { normalizeAnalysis, roleFor, teamTrends, TrendRow } from "./narrative";
import { normalizePreview } from "./preview";
import { teamStrength } from "./ratingModel";
import { HistoryCache, rulesForMatch } from "./ruleMatch";
import type { analyzeStoredMatch } from "./radarMatch";

type Reader = GenericDatabaseReader<DataModel>;
type Analysis = NonNullable<Awaited<ReturnType<typeof analyzeStoredMatch>>>;

export interface BoldContext {
  rules: Doc<"radarRules">[];
  history: HistoryCache;
  /** Narraciones de cada equipo (pocas: se leen una vez) */
  narr: Map<string, Array<TrendRow & { date: string }>>;
}

export async function newBoldContext(db: Reader): Promise<BoldContext> {
  const rules = (await db.query("radarRules").collect()).filter((r) => r.active);
  const narr = new Map<string, Array<TrendRow & { date: string }>>();
  const teamCache = new Map<string, Doc<"teams"> | null>();
  const team = async (id: Doc<"matches">["homeTeamId"]) => {
    if (!teamCache.has(id)) teamCache.set(id, await db.get(id));
    return teamCache.get(id)!;
  };
  for (const n of await db.query("matchNarratives").collect()) {
    const m = await db.get(n.matchId);
    if (!m) continue;
    const analysis = normalizeAnalysis(n.analysis);
    const [h, a] = [await team(m.homeTeamId), await team(m.awayTeamId)];
    for (const side of ["home", "away"] as const) {
      const id = side === "home" ? m.homeTeamId : m.awayTeamId;
      if (!narr.has(id)) narr.set(id, []);
      narr.get(id)!.push({
        side,
        role: roleFor(side, m.odds, teamStrength(h), teamStrength(a)),
        goalsFor: side === "home" ? m.homeGoals : m.awayGoals,
        goalsAgainst: side === "home" ? m.awayGoals : m.homeGoals,
        analysis,
        date: m.date,
      });
    }
  }
  return { rules, history: new Map(), narr };
}

/** Radar Audaz de un partido (null si no hay cuotas: sin mercado no hay de qué alejarse). */
export async function boldForMatch(db: Reader, bc: BoldContext, m: Doc<"matches">, a: Analysis): Promise<BoldResult | null> {
  if (!a.fair) return null;
  const pv = await db
    .query("matchPreviews")
    .withIndex("by_match", (q) => q.eq("matchId", m._id))
    .unique();
  const rules = await rulesForMatch(db, bc.history, m, bc.rules);
  const trendsOf = (id: string) => {
    const rows = (bc.narr.get(id) ?? []).filter((r) => r.date < m.date);
    return rows.length ? teamTrends(rows.sort((x, y) => (x.date < y.date ? 1 : -1)).slice(0, 20)) : null;
  };
  return computeBold({
    market: { home: a.fair.home, draw: a.fair.draw, away: a.fair.away },
    odds: m.odds ?? null,
    modelBase: a.baseMarkets ? a.baseMarkets.probabilities : a.modelProbabilities,
    modelWithAbsences: a.modelProbabilities,
    rules,
    trends: { home: trendsOf(m.homeTeamId), away: trendsOf(m.awayTeamId) },
    preview: pv ? normalizePreview(pv.analysis) : null,
    names: { home: a.home.name, away: a.away.name },
  });
}
