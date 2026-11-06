import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { analyzeRadarMatch } from "./lib/radar";
import { buildTeamPlayerLayer, newLayerCaches } from "./lib/playerLayer";
import { loadRatingParams } from "./lib/ratingStore";
import { teamStrength } from "./lib/ratingModel";
import { computeMarkets } from "./lib/markets";
import { findTeamMatch } from "./lib/teamMatches";
import { homeCompetition } from "./lib/noLeague";

/**
 * Radar 2.0: partidos de un rango de fechas (programados o jugados) con
 * probabilidades por mercado, cuotas, alertas y Study Score.
 */
export const getRadar = query({
  args: { fromDate: v.string(), toDate: v.string(), competition: v.optional(v.string()) },
  handler: async (ctx, { fromDate, toDate, competition }) => {
    const rows = (
      await ctx.db
        .query("matches")
        .withIndex("by_date", (q) => q.gte("date", fromDate).lte("date", toDate))
        .collect()
    )
      .filter((m) => !competition || competition === "all" || m.league === competition)
      .slice(0, 120);

    const teamCache = new Map<string, Doc<"teams"> | null>();
    const team = async (id: Id<"teams">) => {
      if (!teamCache.has(id)) teamCache.set(id, await ctx.db.get(id));
      return teamCache.get(id)!;
    };
    const leagueCache = new Map<string, Doc<"leagues"> | null>();
    const leagueDoc = async (code: string) => {
      if (!leagueCache.has(code)) {
        leagueCache.set(
          code,
          await ctx.db
            .query("leagues")
            .withIndex("by_code", (q) => q.eq("code", code))
            .first()
        );
      }
      return leagueCache.get(code)!;
    };
    const ratingParams = await loadRatingParams(ctx.db);
    const caches = newLayerCaches();

    const out = [];
    for (const m of rows) {
      const home = await team(m.homeTeamId);
      const away = await team(m.awayTeamId);
      if (!home || !away) continue;
      // Parámetros de liga: los de la liga del partido; en copas/UCL, los de la liga del local
      const candidates = [m.league, homeCompetition(home), homeCompetition(away)];
      let lg: Doc<"leagues"> | null = null;
      for (const code of candidates) {
        const d = await leagueDoc(code);
        if (d?.goalsPerTeam) {
          lg = d;
          break;
        }
      }
      const league = { goalsPerTeam: lg?.goalsPerTeam, homeAdvantage: lg?.homeAdvantage, goalRates: lg?.goalRates };
      // Capa de jugadores: perfil de cada jugador para ESTE partido y aporte de las bajas
      const hs = await buildTeamPlayerLayer(
        ctx.db,
        home._id,
        { date: m.date, isAway: false, opponentDefense: away.defenseRating ?? null, opponentStrength: teamStrength(away) },
        ratingParams,
        caches
      );
      const as = await buildTeamPlayerLayer(
        ctx.db,
        away._id,
        { date: m.date, isAway: true, opponentDefense: home.defenseRating ?? null, opponentStrength: teamStrength(home) },
        ratingParams,
        caches
      );
      // Parte del ataque del equipo que se pierde: xG de los lesionados / goles esperados del equipo
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
      const actual = played ? (m.homeGoals! > m.awayGoals! ? "home" : m.homeGoals === m.awayGoals ? "draw" : "away") : null;
      out.push({
        _id: m._id,
        date: m.date,
        competition: m.league,
        home: { _id: home._id, name: home.name, league: home.league },
        away: { _id: away._id, name: away.name, league: away.league },
        odds: m.odds ?? null,
        result: played ? { home: m.homeGoals!, away: m.awayGoals!, outcome: actual } : null,
        playersLogged: { home: hs.logged, away: as.logged },
        players: {
          home: { list: hs.players.slice(0, 8), absent: hs.absent, playersXg: hs.playersXg, absentXg: hs.absentXg, coverage: hs.coverage },
          away: { list: as.players.slice(0, 8), absent: as.absent, playersXg: as.playersXg, absentXg: as.absentXg, coverage: as.coverage },
        },
        ...analysis,
      });
    }
    out.sort((a, b) => b.studyScore - a.studyScore || (a.date < b.date ? -1 : 1));
    return out;
  },
});

/** Guarda (o borra, con valores vacíos) las cuotas 1-X-2 de un partido. */
export const setOdds = mutation({
  args: {
    matchId: v.id("matches"),
    home: v.optional(v.number()),
    draw: v.optional(v.number()),
    away: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const m = await ctx.db.get(args.matchId);
    if (!m) throw new Error("Partido no encontrado");
    for (const k of ["home", "draw", "away"] as const) {
      const x = args[k];
      if (x !== undefined && !(x > 1)) throw new Error("Las cuotas decimales deben ser mayores que 1 (p. ej. 2.10).");
    }
    const empty = args.home === undefined && args.draw === undefined && args.away === undefined;
    await ctx.db.patch(args.matchId, {
      odds: empty ? undefined : { home: args.home, draw: args.draw, away: args.away, updatedAt: Date.now() },
    });
    return args.matchId;
  },
});

/** Añade un partido al radar (programado, sin marcador) entre dos equipos cualesquiera. */
export const addRadarMatch = mutation({
  args: {
    homeTeamId: v.id("teams"),
    awayTeamId: v.id("teams"),
    date: v.string(),
    competition: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.homeTeamId === args.awayTeamId) throw new Error("Local y visitante deben ser distintos");
    const home = await ctx.db.get(args.homeTeamId);
    if (!home) throw new Error("Equipo local no encontrado");
    const existing = await findTeamMatch(ctx.db, args.homeTeamId, args.awayTeamId, args.date);
    if (existing) return existing._id;
    return await ctx.db.insert("matches", {
      homeTeamId: args.homeTeamId,
      awayTeamId: args.awayTeamId,
      date: args.date,
      league: args.competition || homeCompetition(home),
    });
  },
});
