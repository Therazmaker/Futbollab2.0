import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { computeFeatures, Condition, fairOf, matchesConditions, teamGame, TeamGame, TARGETS } from "./features";

type Reader = GenericDatabaseReader<DataModel>;

export type HistoryCache = Map<string, TeamGame[]>;

/** Últimos 12 partidos de un equipo antes de una fecha (con caché). */
export async function teamHistory(db: Reader, cache: HistoryCache, teamId: Id<"teams">, before: string) {
  const key = `${teamId}|${before}`;
  if (cache.has(key)) return cache.get(key)!;
  const [h, a] = await Promise.all([
    db.query("matches").withIndex("by_home_and_date", (q) => q.eq("homeTeamId", teamId).lt("date", before)).order("desc").take(12),
    db.query("matches").withIndex("by_away_and_date", (q) => q.eq("awayTeamId", teamId).lt("date", before)).order("desc").take(12),
  ]);
  const games = [...h.map((m) => teamGame(m, true)), ...a.map((m) => teamGame(m, false))]
    .filter((g): g is TeamGame => !!g)
    .sort((x, y) => (x.date < y.date ? -1 : 1))
    .slice(-12);
  cache.set(key, games);
  return games;
}

export interface RuleHit {
  ruleId: string;
  name: string;
  target: string;
  targetLabel: string;
  teamSide: "home" | "away" | null;
  verdict: string | null;
  rate: number | null;
  market: number | null;
  n: number;
  manualChecks: string[];
  conditionsMet: boolean;
}

/** Reglas activas que cumple un partido (solo con lo previo a su fecha). */
export async function rulesForMatch(db: Reader, cache: HistoryCache, m: Doc<"matches">, rules: Doc<"radarRules">[]): Promise<RuleHit[]> {
  if (!rules.length) return [];
  const fair = fairOf(m.odds ?? m.closingOdds);
  const [hh, ah] = [await teamHistory(db, cache, m.homeTeamId, m.date), await teamHistory(db, cache, m.awayTeamId, m.date)];
  const out: RuleHit[] = [];
  for (const r of rules) {
    let side: "home" | "away" | undefined;
    if (r.teamId) {
      if (r.teamId === m.homeTeamId) side = "home";
      else if (r.teamId === m.awayTeamId) side = "away";
      else continue;
    }
    let met = r.conditions.length === 0;
    if (r.conditions.length) {
      if (!fair) continue;
      const f = computeFeatures(m.date, m.league, fair, hh, ah, side);
      met = !!f && matchesConditions(f, r.conditions as Condition[]);
    }
    if (!met) continue;
    const bt = r.backtest as any;
    out.push({
      ruleId: r._id, name: r.name, target: r.target, targetLabel: (TARGETS as Record<string, string>)[r.target] ?? r.target,
      teamSide: side ?? null, verdict: bt?.verdict ?? null, rate: bt?.rate ?? null, market: bt?.market ?? null, n: bt?.n ?? 0,
      manualChecks: r.manualChecks, conditionsMet: true,
    });
  }
  return out;
}
