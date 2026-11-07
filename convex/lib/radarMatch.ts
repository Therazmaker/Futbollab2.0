import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { analyzeRadarMatch } from "./radar";
import { buildTeamPlayerLayer, LayerCaches, newLayerCaches, relevantPlayers } from "./playerLayer";
import { loadRatingParams } from "./ratingStore";
import { RatingParams, teamStrength } from "./ratingModel";
import { computeMarkets } from "./markets";
import { homeCompetition } from "./noLeague";
import { buildReading, teamSeasonBefore } from "./matchReading";

type Reader = GenericDatabaseReader<DataModel>;

export interface RadarContext {
  teams: Map<string, Doc<"teams"> | null>;
  leagues: Map<string, Doc<"leagues"> | null>;
  layer: LayerCaches;
  ratingParams: RatingParams;
}

export async function newRadarContext(db: Reader): Promise<RadarContext> {
  return { teams: new Map(), leagues: new Map(), layer: newLayerCaches(await relevantPlayers(db)), ratingParams: await loadRatingParams(db) };
}

/** Análisis completo de un partido para el Radar (equipos, mercados, cuotas, alertas, jugadores). */
export async function analyzeStoredMatch(db: Reader, m: Doc<"matches">, rc: RadarContext) {
  const team = async (id: Id<"teams">) => {
    if (!rc.teams.has(id)) rc.teams.set(id, await db.get(id));
    return rc.teams.get(id)!;
  };
  const leagueDoc = async (code: string) => {
    if (!rc.leagues.has(code)) {
      rc.leagues.set(
        code,
        await db
          .query("leagues")
          .withIndex("by_code", (q) => q.eq("code", code))
          .first()
      );
    }
    return rc.leagues.get(code)!;
  };
  const home = await team(m.homeTeamId);
  const away = await team(m.awayTeamId);
  if (!home || !away) return null;
  // Parámetros de liga: los de la liga del partido; en copas/UCL, los de la liga del local
  let lg: Doc<"leagues"> | null = null;
  for (const code of [m.league, homeCompetition(home), homeCompetition(away)]) {
    const d = await leagueDoc(code);
    if (d?.goalsPerTeam) {
      lg = d;
      break;
    }
  }
  const league = { goalsPerTeam: lg?.goalsPerTeam, homeAdvantage: lg?.homeAdvantage, goalRates: lg?.goalRates };
  // Capa de jugadores: solo con lo que se sabía antes del partido
  const hs = await buildTeamPlayerLayer(
    db,
    home._id,
    { date: m.date, isAway: false, opponentDefense: away.defenseRating ?? null, opponentStrength: teamStrength(away) },
    rc.ratingParams,
    rc.layer
  );
  const as = await buildTeamPlayerLayer(
    db,
    away._id,
    { date: m.date, isAway: true, opponentDefense: home.defenseRating ?? null, opponentStrength: teamStrength(home) },
    rc.ratingParams,
    rc.layer
  );
  const base = computeMarkets(home, away, league).expectedGoals;
  const share = (absent: number, lambda: number) => (absent > 0 ? Math.min(1, absent / Math.max(lambda, absent, 0.3)) : 0);
  const analysis = analyzeRadarMatch({
    home: { ...home, name: home.name },
    away: { ...away, name: away.name },
    league,
    odds: m.odds ?? null,
    playersLogged: { home: hs.logged, away: as.logged },
    absences: { home: hs.absent.map((a) => a.name), away: as.absent.map((a) => a.name) },
    absentXgShare: { home: share(hs.absentXg, base.home), away: share(as.absentXg, base.away) },
  });
  const played = m.homeGoals !== undefined && m.awayGoals !== undefined;
  const [hSeason, aSeason] = await Promise.all([
    teamSeasonBefore(db, home._id, home.name, homeCompetition(home), m.date),
    teamSeasonBefore(db, away._id, away.name, homeCompetition(away), m.date),
  ]);
  const reading = buildReading({
    home: { ...hSeason, rank: home.rank, points: home.points },
    away: { ...aSeason, rank: away.rank, points: away.points },
    probs: analysis.markets.probabilities,
    modelProbs: analysis.modelProbabilities,
    fair: analysis.fair,
    expectedGoals: analysis.markets.expectedGoals,
    over25: analysis.markets.over25,
    homeAdvantage: lg?.homeAdvantage,
    goalsPerTeam: lg?.goalsPerTeam,
    absences: { home: hs.absent.map((a) => a.name), away: as.absent.map((a) => a.name) },
    played,
  });
  const outcome = played ? (m.homeGoals! > m.awayGoals! ? "home" : m.homeGoals === m.awayGoals ? "draw" : "away") : null;
  return {
    _id: m._id,
    date: m.date,
    competition: m.league,
    home: { _id: home._id, name: home.name, league: home.league },
    away: { _id: away._id, name: away.name, league: away.league },
    odds: m.odds ?? null,
    closingOdds: m.closingOdds ?? null,
    result: played ? { home: m.homeGoals!, away: m.awayGoals!, outcome } : null,
    playersLogged: { home: hs.logged, away: as.logged },
    players: {
      home: { list: hs.players.slice(0, 8), absent: hs.absent, playersXg: hs.playersXg, absentXg: hs.absentXg, coverage: hs.coverage },
      away: { list: as.players.slice(0, 8), absent: as.absent, playersXg: as.playersXg, absentXg: as.absentXg, coverage: as.coverage },
    },
    leagueBase: lg?.goalRates ?? null,
    reading,
    ...analysis,
  };
}
