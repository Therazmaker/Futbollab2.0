import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  leagues: defineTable({
    code: v.string(), // "ucl", "laliga", "seriea", "premier", "bundesliga"
    name: v.string(), // "Champions League", "Serie A", "LaLiga"
    country: v.string(), // "Europa", "Italia", "España"
    isTournament: v.boolean(), // true for UCL/copas, false for domestic
    crestUrl: v.optional(v.string()),
  }).index("by_code", ["code"]),

  teams: defineTable({
    name: v.string(),
    shortName: v.optional(v.string()),
    league: v.string(), // Domestic league code, e.g. "seriea", "laliga"
    competitions: v.optional(v.array(v.string())), // e.g. ["seriea", "ucl"] -> Links without duplicating!
    crestUrl: v.optional(v.string()),
    rank: v.optional(v.number()),
    points: v.optional(v.number()),
    goalDifference: v.optional(v.number()),
    formation: v.optional(v.string()),
    meanXg: v.optional(v.number()),
    ppda: v.optional(v.number()),
    tempo: v.optional(v.string()),
    form: v.optional(v.array(v.string())),
    density: v.optional(v.number()),
    predAccuracy: v.optional(v.number()),
  }).index("by_league", ["league"]),

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
    opponentTeamId: v.optional(v.id("teams")), // Link to existing opponent team
    competition: v.optional(v.string()), // "ucl", "laliga", "copa_del_rey"
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
