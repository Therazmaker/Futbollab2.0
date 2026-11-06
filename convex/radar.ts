import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { analyzeStoredMatch, newRadarContext } from "./lib/radarMatch";
import { upsertSnapshot } from "./lib/radarSnapshot";
import { evaluate } from "./lib/radarTraining";
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
    const rc = await newRadarContext(ctx.db);
    const out = [];
    for (const m of rows) {
      const a = await analyzeStoredMatch(ctx.db, m, rc);
      if (a) out.push(a);
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

/**
 * Toma/refresca la foto previa de los partidos SIN marcador de un rango.
 * La llama el Radar al abrirse, así la evaluación usa lo que el modelo decía
 * antes del partido (con las cuotas y bajas de ese momento).
 */
export const snapshotRange = mutation({
  args: { fromDate: v.string(), toDate: v.string() },
  handler: async (ctx, { fromDate, toDate }) => {
    const rows = (
      await ctx.db
        .query("matches")
        .withIndex("by_date", (q) => q.gte("date", fromDate).lte("date", toDate))
        .collect()
    )
      .filter((m) => m.homeGoals === undefined)
      .slice(0, 60);
    const rc = await newRadarContext(ctx.db);
    let n = 0;
    for (const m of rows) if (await upsertSnapshot(ctx.db, m._id, { rc })) n++;
    return n;
  },
});

/** Entrenamiento: puntúa las fotos previas de los partidos ya jugados. */
export const getTraining = query({
  args: { competition: v.optional(v.string()), fromDate: v.optional(v.string()) },
  handler: async (ctx, { competition, fromDate }) => {
    const snaps = await ctx.db.query("radarSnapshots").collect();
    const rows = [];
    for (const s of snaps) {
      if (competition && competition !== "all" && s.competition !== competition) continue;
      if (fromDate && s.date < fromDate) continue;
      const m = await ctx.db.get(s.matchId);
      if (!m || m.homeGoals === undefined || m.awayGoals === undefined) continue;
      const logs = await ctx.db
        .query("playerMatchLogs")
        .withIndex("by_match", (q) => q.eq("matchId", m._id))
        .collect();
      const num = (x: unknown) => (x === undefined || x === null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
      rows.push({
        snap: s as any,
        result: {
          homeGoals: m.homeGoals,
          awayGoals: m.awayGoals,
          playerLogs: logs.map((l) => ({ playerId: l.playerId as string, goals: num(l.rawStats?.goals), shots: num(l.rawStats?.totalShots ?? l.rawStats?.shots) })),
        },
      });
    }
    const pending = snaps.length - rows.length;
    return { ...evaluate(rows), pendingSnapshots: pending };
  },
});
