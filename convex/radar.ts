import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { analyzeRadarMatch } from "./lib/radar";
import { availabilityOn } from "./lib/injuries";
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
    const squadCache = new Map<string, { logged: number; absences: string[] }>();
    const squadInfo = async (teamId: Id<"teams">, date: string) => {
      const key = `${teamId}|${date}`;
      if (!squadCache.has(key)) {
        const players = await ctx.db
          .query("players")
          .withIndex("by_team", (q) => q.eq("teamId", teamId))
          .collect();
        let logged = 0;
        const absences: string[] = [];
        for (const p of players) {
          const logs = await ctx.db
            .query("playerMatchLogs")
            .withIndex("by_player", (q) => q.eq("playerId", p._id))
            .collect();
          if (logs.length) logged++;
          const injuries = await ctx.db
            .query("injuries")
            .withIndex("by_player", (q) => q.eq("playerId", p._id))
            .collect();
          if (!injuries.length) continue;
          const av = availabilityOn(date, injuries, logs.filter((l) => l.minutesPlayed > 0).map((l) => l.matchDate).sort());
          if (av.status === "injured") absences.push(p.name);
        }
        squadCache.set(key, { logged, absences });
      }
      return squadCache.get(key)!;
    };

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
      const hs = await squadInfo(home._id, m.date);
      const as = await squadInfo(away._id, m.date);
      const analysis = analyzeRadarMatch({
        home: { ...home, name: home.name },
        away: { ...away, name: away.name },
        league: { goalsPerTeam: lg?.goalsPerTeam, homeAdvantage: lg?.homeAdvantage, goalRates: lg?.goalRates },
        odds: m.odds ?? null,
        playersLogged: { home: hs.logged, away: as.logged },
        absences: { home: hs.absences, away: as.absences },
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
