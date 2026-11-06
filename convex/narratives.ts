import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { computeTeamTrends } from "./lib/teamTrends";
import { AI_DEFAULTS, CLAUDE_MODELS, matchPlayerName, narrativeMinutes, normalizeAnalysis, roleFor, teamTrends, TrendRow } from "./lib/narrative";
import { teamStrength } from "./lib/ratingModel";

// ---------- Ajustes de IA ----------

export const getAiSettings = query({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "ai"))
      .unique();
    return { ...AI_DEFAULTS, ...(doc?.value ?? {}) } as typeof AI_DEFAULTS;
  },
});

export const setAiSettings = mutation({
  args: {
    provider: v.optional(v.union(v.literal("gemini"), v.literal("claude"))),
    geminiModel: v.optional(v.string()),
    claudeModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.claudeModel && !CLAUDE_MODELS.includes(args.claudeModel)) throw new Error("Modelo de Claude no válido");
    if (args.geminiModel !== undefined && !/^[a-z0-9.\-]{3,60}$/i.test(args.geminiModel)) throw new Error("Nombre de modelo de Gemini no válido");
    const doc = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "ai"))
      .unique();
    const clean = Object.fromEntries(Object.entries(args).filter(([, x]) => x !== undefined));
    const value = { ...AI_DEFAULTS, ...(doc?.value ?? {}), ...clean };
    if (doc) await ctx.db.patch(doc._id, { value });
    else await ctx.db.insert("appSettings", { key: "ai", value });
    return value;
  },
});

// ---------- Narraciones ----------

/** Datos del partido que necesita el prompt (equipos, marcador…). */
export const matchContext = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const m = await ctx.db.get(matchId);
    if (!m) return null;
    const home = await ctx.db.get(m.homeTeamId);
    const away = await ctx.db.get(m.awayTeamId);
    return {
      home: home?.name ?? "Local",
      away: away?.name ?? "Visitante",
      homeGoals: m.homeGoals,
      awayGoals: m.awayGoals,
      date: m.date,
      competition: m.league,
    };
  },
});

export const saveNarrative = mutation({
  args: {
    matchId: v.id("matches"),
    text: v.string(),
    provider: v.string(),
    model: v.string(),
    analysis: v.any(),
  },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.matchId))) throw new Error("Partido no encontrado");
    const analysis = normalizeAnalysis(args.analysis);
    const row = { text: args.text.slice(0, 200_000), provider: args.provider, model: args.model, analysis, createdAt: Date.now() };
    const existing = await ctx.db
      .query("matchNarratives")
      .withIndex("by_match", (q) => q.eq("matchId", args.matchId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("matchNarratives", { matchId: args.matchId, ...row });
    return analysis;
  },
});

export const getNarrative = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) =>
    await ctx.db
      .query("matchNarratives")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .unique(),
});

export const deleteNarrative = mutation({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const doc = await ctx.db
      .query("matchNarratives")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .unique();
    if (doc) await ctx.db.delete(doc._id);
  },
});

/** Tendencias de un equipo a partir de todas sus narraciones analizadas. */
export const getTeamTrends = query({
  args: { teamId: v.id("teams"), beforeDate: v.optional(v.string()) },
  handler: async (ctx, { teamId, beforeDate }) => computeTeamTrends(ctx.db, teamId, beforeDate),
});

// ---------- Jugadores de la narración ----------

/**
 * Registra a los jugadores que salen en la narración: crea los que no existen
 * y les apunta ese partido con lo que hicieron. Con `preview` solo enseña el plan.
 */
export const registerNarrativePlayers = mutation({
  args: { matchId: v.id("matches"), preview: v.optional(v.boolean()), include: v.optional(v.array(v.number())) },
  handler: async (ctx, { matchId, preview, include }) => {
    const m = await ctx.db.get(matchId);
    if (!m) throw new Error("Partido no encontrado");
    const n = await ctx.db
      .query("matchNarratives")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .unique();
    if (!n) throw new Error("Este partido no tiene narración analizada");
    const analysis = normalizeAnalysis(n.analysis);
    const teams = { home: await ctx.db.get(m.homeTeamId), away: await ctx.db.get(m.awayTeamId) };
    const squads = {
      home: await ctx.db.query("players").withIndex("by_team", (q) => q.eq("teamId", m.homeTeamId)).collect(),
      away: await ctx.db.query("players").withIndex("by_team", (q) => q.eq("teamId", m.awayTeamId)).collect(),
    };
    const logs = await ctx.db
      .query("playerMatchLogs")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
    const logged = new Set(logs.map((l) => l.playerId as string));

    const plan = analysis.players.map((p, idx) => {
      const existing = matchPlayerName(p.name, squads[p.team]);
      const { minutes, estimated } = narrativeMinutes(p);
      return {
        idx,
        name: p.name,
        side: p.team,
        teamName: teams[p.team]?.name ?? "?",
        position: p.position,
        existingId: existing?._id ?? null,
        existingName: existing?.name ?? null,
        alreadyLogged: existing ? logged.has(existing._id) : false,
        minutes,
        minutesEstimated: estimated,
        goals: p.goals,
        assists: p.assists,
        yellowCards: p.yellowCards,
        redCards: p.redCards,
        bigChancesMissed: p.bigChancesMissed,
        injured: p.injured,
        note: p.note,
      };
    });
    if (preview) return { plan, created: 0, logged: 0 };

    const wanted = include ? new Set(include) : null;
    let created = 0;
    let loggedCount = 0;
    for (const row of plan) {
      if (wanted && !wanted.has(row.idx)) continue;
      if (row.alreadyLogged) continue;
      const team = teams[row.side];
      if (!team) continue;
      let playerId = row.existingId;
      if (!playerId) {
        playerId = await ctx.db.insert("players", {
          teamId: team._id,
          name: row.name,
          position: row.position === "?" ? "MF" : row.position,
        });
        squads[row.side].push((await ctx.db.get(playerId))!);
        created++;
      }
      if (logged.has(playerId)) continue;
      const isAway = row.side === "away";
      const rival = isAway ? teams.home : teams.away;
      const rawStats: Record<string, number | boolean> = { goals: row.goals, assists: row.assists };
      if (row.yellowCards) rawStats.yellowCards = row.yellowCards;
      if (row.redCards) rawStats.redCards = row.redCards;
      if (row.bigChancesMissed) rawStats.bigChancesMissed = row.bigChancesMissed;
      if (row.minutesEstimated) rawStats.minutesEstimated = true;
      const logId = await ctx.db.insert("playerMatchLogs", {
        playerId,
        matchDate: m.date,
        opponent: rival?.name ?? "?",
        opponentTeamId: rival?._id,
        competition: m.league,
        isAway,
        minutesPlayed: row.minutes,
        rawStats,
        matchId,
        injuredOff: row.injured || undefined,
        source: "narrative",
      });
      logged.add(playerId);
      loggedCount++;
      if (row.injured) {
        await ctx.db.insert("injuries", { playerId, startDate: m.date, note: row.note || "Lesión según la narración", fromLogId: logId });
      }
    }
    return { plan, created, logged: loggedCount };
  },
});
