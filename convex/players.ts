import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { syncPlayerWeights } from "./lib/playerModel";

/**
 * Retrieves full player profile: identity, team, match history (descending),
 * active contextual weights, and latest prediction model output.
 */
export const getPlayerProfile = query({
  args: {
    playerId: v.optional(v.id("players")),
  },
  handler: async (ctx, args) => {
    let player = null;

    if (args.playerId) {
      player = await ctx.db.get(args.playerId);
    } else {
      // Default to the primary demo player (e.g., Bellingham)
      player = await ctx.db.query("players").first();
    }

    if (!player) {
      return null;
    }

    // Resolve team
    const team = await ctx.db.get(player.teamId);

    // Resolve match logs sorted by matchDate descending
    const matchLogs = await ctx.db
      .query("playerMatchLogs")
      .withIndex("by_player", (q: any) => q.eq("playerId", player!._id))
      .collect();

    // Sort descending by date
    matchLogs.sort((a: any, b: any) => (a.matchDate < b.matchDate ? 1 : -1));

    // Resolve active weights
    const weights = await ctx.db
      .query("playerWeights")
      .withIndex("by_player_and_feature", (q: any) => q.eq("playerId", player!._id))
      .collect();

    // Resolve latest prediction
    const predictions = await ctx.db
      .query("playerPredictions")
      .withIndex("by_player", (q: any) => q.eq("playerId", player!._id))
      .collect();

    predictions.sort((a: any, b: any) => b.appliedAt - a.appliedAt);
    const latestPrediction = predictions[0] || null;

    return {
      player,
      team,
      matchLogs,
      weights,
      latestPrediction,
    };
  },
});

/**
 * Retrieves single match log details with player context.
 */
export const getMatchLogDetails = query({
  args: {
    matchLogId: v.id("playerMatchLogs"),
  },
  handler: async (ctx, args) => {
    const matchLog = await ctx.db.get(args.matchLogId);
    if (!matchLog) return null;

    const player = await ctx.db.get(matchLog.playerId);
    const team = player ? await ctx.db.get(player.teamId) : null;

    return {
      matchLog,
      player,
      team,
    };
  },
});

/**
 * Updates match log details and recalibrates raw stats.
 */
export const updateMatchLog = mutation({
  args: {
    matchLogId: v.id("playerMatchLogs"),
    opponent: v.optional(v.string()),
    matchDate: v.optional(v.string()),
    isAway: v.optional(v.boolean()),
    minutesPlayed: v.optional(v.number()),
    tacticalRole: v.optional(v.string()),
    contextFeatures: v.optional(v.array(v.string())),
    // null = quitar el vínculo con el equipo rival (rival escrito a mano)
    opponentTeamId: v.optional(v.union(v.id("teams"), v.null())),
    competition: v.optional(v.string()),
    rawStats: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.matchLogId);
    if (!existing) {
      throw new Error("Match log not found");
    }

    const patch: any = {};
    if (args.opponent !== undefined) patch.opponent = args.opponent;
    if (args.matchDate !== undefined) patch.matchDate = args.matchDate;
    if (args.isAway !== undefined) patch.isAway = args.isAway;
    if (args.minutesPlayed !== undefined) patch.minutesPlayed = args.minutesPlayed;
    if (args.tacticalRole !== undefined) patch.tacticalRole = args.tacticalRole;
    if (args.rawStats !== undefined) patch.rawStats = args.rawStats;
    if (args.contextFeatures !== undefined) patch.contextFeatures = args.contextFeatures;
    if (args.opponentTeamId !== undefined) patch.opponentTeamId = args.opponentTeamId ?? undefined;
    if (args.competition !== undefined) patch.competition = args.competition;

    await ctx.db.patch(args.matchLogId, patch);
    // El perfil se recalcula con todos los partidos: editar corrige los pesos.
    await syncPlayerWeights(ctx.db, existing.playerId);
    return { success: true, matchLogId: args.matchLogId };
  },
});

/**
 * Deletes a match log record.
 */
export const deleteMatchLog = mutation({
  args: {
    matchLogId: v.id("playerMatchLogs"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.matchLogId);
    if (!existing) {
      throw new Error("Match log not found");
    }

    await ctx.db.delete(args.matchLogId);
    await syncPlayerWeights(ctx.db, existing.playerId);
    return { success: true, deletedId: args.matchLogId };
  },
});

/**
 * Populates initial sample data for Jude Bellingham if database is empty.
 */
export const seedBellinghamDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const existingPlayer = await ctx.db.query("players").first();
    if (existingPlayer) {
      return { playerId: existingPlayer._id, seeded: false };
    }

    // 1. Create Real Madrid team
    const teamId = await ctx.db.insert("teams", {
      name: "Real Madrid CF",
      league: "LaLiga",
      crestUrl:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuDIfxcvoBCPvtYy-GIQmSp-Dow-fMvM-g40ZpzX4LW3EprnYvecexSz2jZ1hVGp28kmIVJkIHlBM8OvL0j4qY9Cs-0CFUC6tQwDHoNE2IO7l6B71Slde3MdVfdsLdy4XJkQk7XfmRYoDdnLXb5m2gNvNOS5nxVqDMcu-xA0AzEU2_zM5a_jlavqxMZ5EsSn1iQHslWNjVLOP1Zm1OjeO5XGNT9eCQNvBNY1Qln8xFrU",
    });

    // 2. Create Jude Bellingham player
    const playerId = await ctx.db.insert("players", {
      teamId,
      name: "Jude Bellingham",
      position: "AM / Box-to-Box",
      photoUrl:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuBmp3UT4x6eeOZBQ4lYVC34e4635kRT-n3a4j0Ryu3pmTIYhyJtPE3wMs8Wunqbnq7Ry6pUYGdJ4DjtsMoQoumh71lGAJHc8xGKQ3TgiLKYB4h67dqKVWqTFKPmjkTJGWilcQhUjgS-9oFprvSUqs2XogenY2Y9q6bnjtWQATXbmTh0pwIPfojZDOTq4J-3TKrA3qn6zEKFHsoACuO0-SRr7tfmPk3XcpXmf_QL7ETm",
    });

    // 3. Initial Match Logs (Historical matches)
    await ctx.db.insert("playerMatchLogs", {
      playerId,
      matchDate: "2024-10-26",
      opponent: "FC Barcelona",
      isAway: false,
      tacticalRole: "Shadow Striker",
      minutesPlayed: 90,
      rawStats: {
        totalShots: 3,
        shotsOnTarget: 2,
        xG: 0.48,
        keyPasses: 3,
        accuratePassesPct: 88,
        touches: 76,
        dribblesCompleted: 3,
        groundDuelsWon: 7,
        aerialDuelsWon: 2,
        recoveries: 5,
        rating: 8.6,
      },
    });

    await ctx.db.insert("playerMatchLogs", {
      playerId,
      matchDate: "2024-10-19",
      opponent: "Celta de Vigo",
      isAway: true,
      tacticalRole: "Central Attacking Midfielder",
      minutesPlayed: 90,
      rawStats: {
        totalShots: 2,
        shotsOnTarget: 1,
        xG: 0.25,
        keyPasses: 2,
        accuratePassesPct: 84,
        touches: 65,
        dribblesCompleted: 2,
        groundDuelsWon: 5,
        aerialDuelsWon: 1,
        recoveries: 4,
        rating: 7.9,
      },
    });

    await ctx.db.insert("playerMatchLogs", {
      playerId,
      matchDate: "2024-10-05",
      opponent: "Villarreal CF",
      isAway: false,
      tacticalRole: "Box-to-Box Midfielder",
      minutesPlayed: 85,
      rawStats: {
        totalShots: 2,
        shotsOnTarget: 1,
        xG: 0.32,
        keyPasses: 4,
        accuratePassesPct: 91,
        touches: 82,
        dribblesCompleted: 4,
        groundDuelsWon: 8,
        aerialDuelsWon: 3,
        recoveries: 6,
        rating: 8.4,
      },
    });

    // 4. Los pesos de contexto se calculan con los partidos (no se inventan)
    await syncPlayerWeights(ctx.db, playerId);

    return { playerId, seeded: true };
  },
});

/**
 * Lista/busca jugadores para el selector del Lab (incluye los importados).
 */
export const listPlayers = query({
  args: { search: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(50, args.limit ?? 25);
    const term = args.search?.trim();
    const rows = term
      ? await ctx.db
          .query("players")
          .withSearchIndex("search_name", (q) => q.search("name", term))
          .take(limit)
      : await ctx.db.query("players").take(limit);
    const out = [];
    for (const p of rows) {
      const team = await ctx.db.get(p.teamId);
      const firstLog = await ctx.db
        .query("playerMatchLogs")
        .withIndex("by_player", (q) => q.eq("playerId", p._id))
        .first();
      out.push({
        _id: p._id,
        name: p.name,
        position: p.position,
        teamName: team?.name ?? "",
        teamId: p.teamId,
        hasMatches: firstLog !== null,
      });
    }
    return out;
  },
});

/** Alta de un jugador en la plantilla de un equipo. */
export const createPlayer = mutation({
  args: {
    teamId: v.id("teams"),
    name: v.string(),
    position: v.string(),
    number: v.optional(v.number()),
    age: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw new Error("El nombre es obligatorio");
    if (!(await ctx.db.get(args.teamId))) throw new Error("Equipo no encontrado");
    const playerId = await ctx.db.insert("players", { ...args, name });
    await syncPlayerWeights(ctx.db, playerId);
    return playerId;
  },
});

/**
 * Edita la ficha del jugador. Cambiar la posición cambia su tasa base
 * (prior), así que el perfil y los efectos se recalculan al momento.
 */
export const updatePlayer = mutation({
  args: {
    playerId: v.id("players"),
    name: v.optional(v.string()),
    position: v.optional(v.string()),
    number: v.optional(v.union(v.number(), v.null())),
    age: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const player = await ctx.db.get(args.playerId);
    if (!player) throw new Error("Jugador no encontrado");
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new Error("El nombre es obligatorio");
      patch.name = name;
    }
    if (args.position !== undefined) patch.position = args.position;
    if (args.number !== undefined) patch.number = args.number ?? undefined;
    if (args.age !== undefined) patch.age = args.age ?? undefined;
    await ctx.db.patch(args.playerId, patch);
    await syncPlayerWeights(ctx.db, args.playerId);
    return { success: true };
  },
});
