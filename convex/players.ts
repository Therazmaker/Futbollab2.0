import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

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

    await ctx.db.patch(args.matchLogId, patch);
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
    const log1 = await ctx.db.insert("playerMatchLogs", {
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

    const log2 = await ctx.db.insert("playerMatchLogs", {
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

    const log3 = await ctx.db.insert("playerMatchLogs", {
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

    // 4. Initial Contextual Weights
    await ctx.db.insert("playerWeights", {
      playerId,
      featureName: "is_away",
      weightValue: -0.12,
      confidenceScore: 0.85,
      updatedAt: Date.now(),
    });

    await ctx.db.insert("playerWeights", {
      playerId,
      featureName: "opponent_low_block",
      weightValue: -0.08,
      confidenceScore: 0.72,
      updatedAt: Date.now(),
    });

    await ctx.db.insert("playerWeights", {
      playerId,
      featureName: "missing_key_partner",
      weightValue: 0.06,
      confidenceScore: 0.65,
      updatedAt: Date.now(),
    });

    await ctx.db.insert("playerWeights", {
      playerId,
      featureName: "home_pitch_bias",
      weightValue: 0.084,
      confidenceScore: 0.9,
      updatedAt: Date.now(),
    });

    // 5. Initial Prediction for next fixture
    await ctx.db.insert("playerPredictions", {
      playerId,
      matchLogId: log1,
      predictedMetrics: {
        totalShots: 2.1,
        shotsPredicted: 2.4,
        xG: 0.35,
        keyPasses: 2.8,
        keyPassesPredicted: 3.1,
        aerialDuelWinPct: 68.4,
        xtThreat: 0.84,
        predictiveForm: 9.42,
        confidence: 99.4,
      },
      actualMetrics: {
        totalShots: 2.1,
        xG: 0.31,
        keyPasses: 2.8,
      },
      deltas: {
        totalShots: -0.3,
        xG: -0.04,
        keyPasses: -0.3,
      },
      appliedAt: Date.now(),
    });

    return { playerId, seeded: true };
  },
});
