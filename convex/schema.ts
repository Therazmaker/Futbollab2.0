import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  teams: defineTable({
    name: v.string(),
    league: v.string(),
    crestUrl: v.optional(v.string()),
  }),

  players: defineTable({
    teamId: v.id("teams"),
    name: v.string(),
    position: v.string(),
    photoUrl: v.optional(v.string()),
  }).index("by_team", ["teamId"]),

  playerMatchLogs: defineTable({
    playerId: v.id("players"),
    matchDate: v.string(),
    opponent: v.string(),
    isAway: v.boolean(),
    tacticalRole: v.optional(v.string()),
    minutesPlayed: v.number(),
    rawStats: v.any(), // Flexible container for Sofascore/FotMob OCR ingested metrics (50+ fields)
  })
    .index("by_player", ["playerId"])
    .index("by_player_and_date", ["playerId", "matchDate"]),

  playerWeights: defineTable({
    playerId: v.id("players"),
    featureName: v.string(), // e.g. 'is_away', 'opponent_low_block', 'missing_key_partner'
    weightValue: v.number(), // default 0.0
    confidenceScore: v.number(), // default 0.1
    updatedAt: v.number(),
  }).index("by_player_and_feature", ["playerId", "featureName"]),

  playerPredictions: defineTable({
    playerId: v.id("players"),
    matchLogId: v.optional(v.id("playerMatchLogs")),
    predictedMetrics: v.any(), // e.g. { totalShots: 2.8, xG: 0.35, keyPasses: 1.5 }
    actualMetrics: v.optional(v.any()),
    deltas: v.optional(v.any()),
    appliedAt: v.number(),
  }).index("by_player", ["playerId"]),
});
