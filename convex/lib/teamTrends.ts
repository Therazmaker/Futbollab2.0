import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { normalizeAnalysis, roleFor, teamTrends, TrendRow } from "./narrative";
import { teamStrength } from "./ratingModel";

/** Tendencias de un equipo a partir de sus narraciones analizadas (solo partidos anteriores a beforeDate). */
export async function computeTeamTrends(db: GenericDatabaseReader<DataModel>, teamId: Id<"teams">, beforeDate?: string) {
  const ctx = { db };
    const [asHome, asAway] = await Promise.all([
      ctx.db.query("matches").withIndex("by_home_and_date", (q) => q.eq("homeTeamId", teamId)).collect(),
      ctx.db.query("matches").withIndex("by_away_and_date", (q) => q.eq("awayTeamId", teamId)).collect(),
    ]);
    const teamCache = new Map<string, Doc<"teams"> | null>();
    const team = async (id: Doc<"matches">["homeTeamId"]) => {
      if (!teamCache.has(id)) teamCache.set(id, await ctx.db.get(id));
      return teamCache.get(id)!;
    };
    const rows: (TrendRow & { date: string; matchId: string; opponent: string })[] = [];
    for (const m of [...asHome, ...asAway]) {
      if (beforeDate && m.date >= beforeDate) continue;
      const n = await ctx.db
        .query("matchNarratives")
        .withIndex("by_match", (q) => q.eq("matchId", m._id))
        .unique();
      if (!n) continue;
      const side = m.homeTeamId === teamId ? "home" : "away";
      const [h, a] = [await team(m.homeTeamId), await team(m.awayTeamId)];
      rows.push({
        side,
        role: roleFor(side, m.odds, teamStrength(h), teamStrength(a)),
        goalsFor: side === "home" ? m.homeGoals : m.awayGoals,
        goalsAgainst: side === "home" ? m.awayGoals : m.homeGoals,
        analysis: normalizeAnalysis(n.analysis),
        date: m.date,
        matchId: m._id,
        opponent: (side === "home" ? a?.name : h?.name) ?? "?",
      });
    }
    rows.sort((x, y) => (x.date < y.date ? 1 : -1));
    const recent = rows.slice(0, 20);
    return {
      trends: teamTrends(recent),
      matches: recent.map((r) => ({
        matchId: r.matchId,
        date: r.date,
        opponent: r.opponent,
        side: r.side,
        role: r.role,
        dominance: r.analysis[r.side].dominance,
        clearChances: r.analysis[r.side].clearChances,
        clearChancesAgainst: r.analysis[r.side === "home" ? "away" : "home"].clearChances,
        summary: r.analysis.summary,
      })),
    };
}
