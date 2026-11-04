import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { forecast, STATS, STAT_LABELS, summarizeWalkForward } from "./lib/engine";
import { buildReport, loadPlayerModelInput, syncPlayerWeights } from "./lib/playerModel";
import { findOrCreateTeamMatch } from "./lib/teamMatches";

const round = (x: number, d = 2) => +x.toFixed(d);

/**
 * Predicción del PRÓXIMO partido del jugador.
 * Ajusta el perfil bayesiano con todos sus partidos y devuelve, por stat,
 * media + intervalo 80% + probabilidades. Nada de "confianza 99%":
 * `confidence` = % de la predicción que sale de datos propios (vs. tasa base de su posición).
 */
export const calculateAndPredict = mutation({
  args: {
    playerId: v.id("players"),
    opponent: v.string(),
    isAway: v.boolean(),
    opponentTeamId: v.optional(v.id("teams")),
    tacticalRole: v.optional(v.string()),
    contextFeatures: v.optional(v.array(v.string())),
    expectedMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const synced = await syncPlayerWeights(ctx.db, args.playerId);
    if (!synced) throw new Error("Jugador no encontrado");
    const { state, input } = synced;
    const opponentDefense = await input.defenseOf(args.opponentTeamId);
    const fc = forecast(
      state,
      { isAway: args.isAway, contextFeatures: args.contextFeatures, opponentDefense },
      args.expectedMinutes
    );

    const dist = Object.fromEntries(
      STATS.map((s) => [
        s,
        {
          mean: round(fc.stats[s].mean),
          sd: round(fc.stats[s].sd),
          low: round(fc.stats[s].low),
          high: round(fc.stats[s].high),
          pAtLeast: Object.fromEntries(Object.entries(fc.stats[s].pAtLeast).map(([k, p]) => [k, round(p, 3)])),
        },
      ])
    );

    const predictedMetrics = {
      totalShots: round(fc.stats.totalShots.mean),
      shotsPredicted: round(fc.stats.totalShots.mean),
      xG: round(fc.stats.xG.mean),
      keyPasses: round(fc.stats.keyPasses.mean),
      keyPassesPredicted: round(fc.stats.keyPasses.mean),
      groundDuelsWon: round(fc.stats.groundDuelsWon.mean),
      distribution: dist,
      expectedMinutes: Math.round(fc.minutes),
      contextMultiplier: round(fc.multiplier, 3),
      predictiveForm: round(Math.min(10, Math.max(1, fc.rating))),
      confidence: round(fc.dataShare * 100, 1),
      opponent: args.opponent,
      opponentDefense: opponentDefense ? round(opponentDefense, 3) : null,
      isAway: args.isAway,
      tacticalRole: args.tacticalRole ?? input.player.position,
      appliedContexts: fc.contributions.map((c) => ({ feature: c.feature, impact: round(c.impact, 4) })),
      matchesUsed: state.matches,
    };

    const predictionId = await ctx.db.insert("playerPredictions", {
      playerId: args.playerId,
      predictedMetrics,
      kind: "forecast",
      appliedAt: Date.now(),
    });

    return { predictionId, predictedMetrics };
  },
});

/**
 * Registra un partido jugado y recalibra.
 * El error se mide contra la predicción que el modelo habría hecho ANTES del
 * partido (solo con los partidos anteriores), así la curva de aprendizaje es honesta.
 */
export const recordMatchAndCalibrate = mutation({
  args: {
    playerId: v.id("players"),
    matchDate: v.string(),
    opponent: v.string(),
    opponentTeamId: v.optional(v.id("teams")),
    competition: v.optional(v.string()),
    isAway: v.boolean(),
    minutesPlayed: v.number(),
    rawStats: v.any(),
    tacticalRole: v.optional(v.string()),
    contextFeatures: v.optional(v.array(v.string())),
    // Partido del equipo ya existente (otro jugador ya lo registró)
    matchId: v.optional(v.id("matches")),
    // Marcador desde el punto de vista del equipo del jugador (opcional)
    teamGoals: v.optional(v.number()),
    opponentGoals: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(args.minutesPlayed > 0)) throw new Error("minutesPlayed debe ser > 0");
    const player = await ctx.db.get(args.playerId);
    if (!player) throw new Error("Jugador no encontrado");
    const team = await ctx.db.get(player.teamId);

    let { matchDate, opponent, opponentTeamId, isAway, competition } = args;
    let matchId = args.matchId;
    if (matchId) {
      // Se toma todo del partido del equipo: fecha, rival, casa/fuera, competición
      const m = await ctx.db.get(matchId);
      if (!m) throw new Error("Partido del equipo no encontrado");
      if (m.homeTeamId !== player.teamId && m.awayTeamId !== player.teamId) {
        throw new Error("Ese partido no es del equipo del jugador");
      }
      isAway = m.awayTeamId === player.teamId;
      opponentTeamId = isAway ? m.homeTeamId : m.awayTeamId;
      opponent = (await ctx.db.get(opponentTeamId))?.name ?? opponent;
      matchDate = m.date;
      competition = m.league;
      if (args.teamGoals !== undefined && args.opponentGoals !== undefined) {
        await findOrCreateTeamMatch(ctx.db, {
          teamId: player.teamId, opponentTeamId, isAway, date: matchDate,
          teamGoals: args.teamGoals, opponentGoals: args.opponentGoals,
        });
      }
    } else if (opponentTeamId) {
      matchId =
        (await findOrCreateTeamMatch(ctx.db, {
          teamId: player.teamId,
          opponentTeamId,
          isAway,
          date: matchDate,
          competition: competition || team?.league,
          teamGoals: args.teamGoals,
          opponentGoals: args.opponentGoals,
        })) ?? undefined;
    }
    if (matchId) {
      const dup = await ctx.db
        .query("playerMatchLogs")
        .withIndex("by_match", (q) => q.eq("matchId", matchId))
        .collect();
      if (dup.some((l) => l.playerId === args.playerId)) {
        throw new Error("Este jugador ya tiene registrado ese partido. Edítalo desde su historial.");
      }
    }

    const matchLogId = await ctx.db.insert("playerMatchLogs", {
      playerId: args.playerId,
      matchDate,
      opponent,
      opponentTeamId,
      competition: competition || team?.league || "laliga",
      isAway,
      tacticalRole: args.tacticalRole,
      minutesPlayed: args.minutesPlayed,
      contextFeatures: args.contextFeatures,
      rawStats: args.rawStats,
      matchId,
    });

    const synced = await syncPlayerWeights(ctx.db, args.playerId);
    if (!synced) throw new Error("Jugador no encontrado");
    const { points } = buildReport(synced.input);
    const point = points.find((p) => p.logId === matchLogId);

    const predictedBefore: Record<string, number> = {};
    const actualMetrics: Record<string, number> = {};
    const deltas: Record<string, number> = {};
    for (const s of STATS) {
      const st = point?.stats[s];
      if (!st) continue;
      predictedBefore[s] = round(st.predicted);
      actualMetrics[s] = st.actual;
      deltas[s] = round(st.actual - st.predicted);
    }

    const venue = synced.state.beta.is_away;
    return {
      matchLogId,
      teamMatchId: matchId ?? null,
      predictedBefore,
      actualMetrics,
      deltas,
      error: point
        ? { model: round(point.modelError, 3), naive: round(point.naiveError, 3), noiseFloor: round(point.noiseFloor, 3) }
        : null,
      calibratedWeight: venue
        ? { featureName: "is_away", newValue: round(Math.exp(venue.mean) - 1, 4), confidence: round(venue.dataShare, 3) }
        : null,
    };
  },
});

/**
 * Informe del modelo para la UI: validación partido a partido (alimenta el
 * radar y la curva de aprendizaje), resumen de error y perfil actual.
 */
export const getModelReport = query({
  args: { playerId: v.optional(v.id("players")) },
  handler: async (ctx, args) => {
    const playerId = args.playerId ?? (await ctx.db.query("players").first())?._id;
    if (!playerId) return null;
    const input = await loadPlayerModelInput(ctx.db, playerId);
    if (!input) return null;
    const { points, state } = buildReport(input);
    return {
      playerId,
      points: points.map((p) => ({
        ...p,
        modelError: round(p.modelError, 4),
        naiveError: round(p.naiveError, 4),
        noiseFloor: round(p.noiseFloor, 4),
        dataShare: round(p.dataShare, 3),
        stats: Object.fromEntries(
          Object.entries(p.stats).map(([k, s]) => [
            k,
            {
              predicted: round(s!.predicted),
              sd: round(s!.sd),
              actual: s!.actual,
              naive: round(s!.naive),
              noiseFloor: round(s!.noiseFloor),
            },
          ])
        ),
      })),
      summary: summarizeWalkForward(points),
      profile: {
        matches: state.matches,
        expectedMinutes: Math.round(state.expectedMinutes),
        rating: round(state.rating.mean),
        per90: Object.fromEntries(
          STATS.map((s) => [
            s,
            {
              label: STAT_LABELS[s],
              rate: round(state.rates[s].rate),
              prior: round(state.rates[s].prior),
              dataShare: round(state.rates[s].dataShare, 3),
            },
          ])
        ),
        effects: Object.entries(state.beta).map(([f, b]) => ({
          feature: f,
          label: b.prior.label,
          impact: round(Math.exp(b.mean) - 1, 4),
          low: round(Math.exp(b.mean - 1.2816 * b.sd) - 1, 4),
          high: round(Math.exp(b.mean + 1.2816 * b.sd) - 1, 4),
          dataShare: round(b.dataShare, 3),
          matches: b.matches,
        })),
      },
    };
  },
});
