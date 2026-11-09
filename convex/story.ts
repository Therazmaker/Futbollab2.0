import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { currentSeason, previousSeason, seasonOf } from "./lib/season";
import { isNoLeague } from "./lib/noLeague";
import { buildSeasonStory, type StoryNarrative } from "./lib/seasonStory";

const start = (season: string) => `${season.slice(0, 4)}-07-01`;
const end = (season: string) => `${Number(season.slice(0, 4)) + 1}-07-01`;

/**
 * Anatomía de la temporada de un equipo (ver convex/lib/seasonStory.ts):
 * puntos reales vs esperados (mercado) vs merecidos (xG), Elo partido a partido
 * y las causas que explican cada punto ganado o perdido.
 */
export const getSeasonStory = query({
  args: { teamId: v.id("teams"), season: v.optional(v.string()) },
  handler: async (ctx, { teamId, season }) => {
    const team = await ctx.db.get(teamId);
    if (!team) return null;
    if (isNoLeague(team)) return { available: false as const, reason: "Este equipo no tiene liga registrada: el estudio necesita sus partidos de liga." };
    const league = team.league;

    const [h, a] = await Promise.all([
      ctx.db.query("matches").withIndex("by_home_and_date", (q) => q.eq("homeTeamId", teamId)).collect(),
      ctx.db.query("matches").withIndex("by_away_and_date", (q) => q.eq("awayTeamId", teamId)).collect(),
    ]);
    const own = [...h, ...a].filter((m) => m.homeGoals !== undefined && m.awayGoals !== undefined);
    const seasons = Array.from(new Set(own.filter((m) => m.league === league).map((m) => seasonOf(m.date))))
      .sort()
      .reverse();
    if (!seasons.length) return { available: false as const, reason: "Todavía no hay partidos de liga con marcador para este equipo." };
    const chosen = season && seasons.includes(season) ? season : seasons.includes(currentSeason()) ? currentSeason() : seasons[0];

    // Toda la liga: la temporada elegida y la anterior (para que el Elo arranque con historia)
    const leagueMatches = await ctx.db
      .query("matches")
      .withIndex("by_league_and_date", (q) => q.eq("league", league).gte("date", start(previousSeason(chosen))).lt("date", end(chosen)))
      .collect();

    const teamMatches = leagueMatches.filter((m) => seasonOf(m.date) === chosen && (m.homeTeamId === teamId || m.awayTeamId === teamId) && m.homeGoals !== undefined);
    const names = new Map<string, string>([[teamId, team.name]]);
    for (const m of teamMatches) {
      const opp = m.homeTeamId === teamId ? m.awayTeamId : m.homeTeamId;
      if (!names.has(opp)) names.set(opp, (await ctx.db.get(opp))?.name ?? "?");
    }

    // Otras competiciones (para el cansancio)
    const otherComps = own
      .filter((m) => m.league !== league && m.date >= start(chosen) && m.date < end(chosen))
      .map((m) => ({ date: m.date, league: m.league }));

    // Narraciones: rojas, lesiones y resumen
    const narratives = new Map<string, StoryNarrative>();
    for (const m of teamMatches) {
      const n = await ctx.db
        .query("matchNarratives")
        .withIndex("by_match", (q) => q.eq("matchId", m._id))
        .order("desc")
        .first();
      const an: any = n?.analysis;
      if (!an) continue;
      const side = m.homeTeamId === teamId ? "home" : "away";
      const ev: any[] = Array.isArray(an.events) ? an.events : [];
      const pl: any[] = Array.isArray(an.players) ? an.players : [];
      const reds = (s: string) =>
        Math.max(
          ev.filter((e) => e.type === "red_card" && e.team === s).length,
          pl.filter((p) => p.team === s).reduce((t, p) => t + (p.redCards ?? 0), 0)
        );
      narratives.set(m._id, {
        ownRed: reds(side),
        oppRed: reds(side === "home" ? "away" : "home"),
        ownInjuries: Array.from(
          new Set([
            ...ev.filter((e) => e.type === "injury" && e.team === side).map((e) => e.player || "alguien"),
            ...pl.filter((p) => p.team === side && p.injured).map((p) => p.name),
          ])
        ),
        summary: typeof an.summary === "string" ? an.summary : undefined,
      });
    }

    // Bajas importantes: lesionados con muchos minutos (temporada o partidos registrados)
    const absences = new Map<string, string[]>();
    const players = await ctx.db
      .query("players")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .collect();
    for (const p of players) {
      const injuries = await ctx.db
        .query("injuries")
        .withIndex("by_player", (q) => q.eq("playerId", p._id))
        .collect();
      if (!injuries.length) continue;
      let important = (p.seasonStats?.minutes ?? 0) >= 900;
      if (!important) {
        const logs = await ctx.db
          .query("playerMatchLogs")
          .withIndex("by_player", (q) => q.eq("playerId", p._id))
          .collect();
        important = logs.filter((l) => l.minutesPlayed >= 45).length >= 3;
      }
      if (!important) continue;
      for (const m of teamMatches) {
        const out = injuries.some((i) => i.startDate < m.date && (i.endDate ?? i.expectedReturn ?? "9999-12-31") > m.date);
        if (out) absences.set(m._id, [...(absences.get(m._id) ?? []), p.name]);
      }
    }

    const story = buildSeasonStory(
      teamId,
      chosen,
      leagueMatches.map((m) => ({ ...m, _id: m._id as string, homeTeamId: m.homeTeamId as string, awayTeamId: m.awayTeamId as string })),
      { names, otherComps, narratives, absences }
    );
    return {
      available: true as const,
      seasons,
      story: { ...story, matches: story.matches.map((m) => ({ ...m, _id: m._id as Id<"matches">, opponentId: m.opponentId as Id<"teams"> })) },
    };
  },
});
