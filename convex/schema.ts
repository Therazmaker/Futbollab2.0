import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  leagues: defineTable({
    code: v.string(), // "ucl", "laliga", "seriea", "premier", "bundesliga"
    name: v.string(), // "Champions League", "Serie A", "LaLiga"
    country: v.string(), // "Europa", "Italia", "España"
    isTournament: v.boolean(), // true for UCL/copas, false for domestic
    crestUrl: v.optional(v.string()),
    // Calculado con los resultados (ver lib/leagueTable.ts)
    homeAdvantage: v.optional(v.number()),
    goalsPerTeam: v.optional(v.number()),
    matchesPlayed: v.optional(v.number()),
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
    // Calculado a partir de los partidos reales (tabla `matches`)
    legacyId: v.optional(v.string()),
    played: v.optional(v.number()),
    wins: v.optional(v.number()),
    draws: v.optional(v.number()),
    losses: v.optional(v.number()),
    goalsFor: v.optional(v.number()),
    goalsAgainst: v.optional(v.number()),
    attackRating: v.optional(v.number()), // 1 = media de la liga
    defenseRating: v.optional(v.number()), // >1 = concede más que la media
    // Estadísticas oficiales UEFA Champions League (Fase de Liga 36 clubes - Ronda 4)
    uclRank: v.optional(v.number()),
    uclPoints: v.optional(v.number()),
    uclPlayed: v.optional(v.number()),
    uclWins: v.optional(v.number()),
    uclDraws: v.optional(v.number()),
    uclLosses: v.optional(v.number()),
    uclGoalsFor: v.optional(v.number()),
    uclGoalsAgainst: v.optional(v.number()),
    uclGoalDifference: v.optional(v.number()),
    uclForm: v.optional(v.array(v.string())),
    uclPhase: v.optional(v.string()), // "direct_round_16" | "qualification_playoff" | "eliminated"
  })
    .index("by_league", ["league"])
    .index("by_legacyId", ["legacyId"]),

  // Resultados de partidos de equipos (importados del FutbolLab viejo o nuevos)
  matches: defineTable({
    legacyId: v.optional(v.string()),
    league: v.string(),
    date: v.string(), // YYYY-MM-DD
    homeTeamId: v.id("teams"),
    awayTeamId: v.id("teams"),
    homeGoals: v.number(),
    awayGoals: v.number(),
  })
    .index("by_league_and_date", ["league", "date"])
    .index("by_home_and_date", ["homeTeamId", "date"])
    .index("by_away_and_date", ["awayTeamId", "date"])
    .index("by_legacyId", ["legacyId"]),

  players: defineTable({
    teamId: v.id("teams"),
    name: v.string(),
    position: v.string(),
    photoUrl: v.optional(v.string()),
    legacyId: v.optional(v.string()),
    age: v.optional(v.number()),
    number: v.optional(v.number()),
    // Totales de temporada (del histórico): se usan como tasa base del perfil
    seasonStats: v.optional(
      v.object({
        appearances: v.optional(v.number()),
        minutes: v.optional(v.number()),
        goals: v.optional(v.number()),
        assists: v.optional(v.number()),
        yellowCards: v.optional(v.number()),
        redCards: v.optional(v.number()),
      })
    ),
  })
    .index("by_team", ["teamId"])
    .index("by_legacyId", ["legacyId"])
    .searchIndex("search_name", { searchField: "name" }),

  playerMatchLogs: defineTable({
    playerId: v.id("players"),
    matchDate: v.string(),
    opponent: v.string(),
    opponentTeamId: v.optional(v.id("teams")), // Link to existing opponent team
    competition: v.optional(v.string()), // "ucl", "laliga", "copa_del_rey"
    isAway: v.boolean(),
    tacticalRole: v.optional(v.string()),
    minutesPlayed: v.number(),
    contextFeatures: v.optional(v.array(v.string())), // p.ej. ["opponent_low_block"]
    rawStats: v.any(), // Flexible container for Sofascore/FotMob OCR ingested metrics (50+ fields)
  })
    .index("by_player", ["playerId"])
    .index("by_player_and_date", ["playerId", "matchDate"]),

  playerWeights: defineTable({
    playerId: v.id("players"),
    featureName: v.string(), // e.g. 'is_away', 'opponent_defense', 'opponent_low_block'
    weightValue: v.number(), // multiplicador - 1 (−0.10 = −10% de producción)
    confidenceScore: v.number(), // fracción de la información que viene de datos propios (0–1)
    sd: v.optional(v.number()), // incertidumbre del efecto (escala log)
    matches: v.optional(v.number()), // partidos en los que estuvo activo
    updatedAt: v.number(),
  }).index("by_player_and_feature", ["playerId", "featureName"]),

  playerPredictions: defineTable({
    playerId: v.id("players"),
    matchLogId: v.optional(v.id("playerMatchLogs")),
    predictedMetrics: v.any(), // e.g. { totalShots: 2.8, xG: 0.35, keyPasses: 1.5 }
    actualMetrics: v.optional(v.any()),
    deltas: v.optional(v.any()),
    kind: v.optional(v.string()), // "forecast" (próximo partido)
    appliedAt: v.number(),
  }).index("by_player", ["playerId"]),
});
