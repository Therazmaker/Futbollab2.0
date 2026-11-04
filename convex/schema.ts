import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  leagues: defineTable({
    code: v.string(),
    name: v.string(),
    country: v.string(),
    teamsCount: v.number(),
    icon: v.string(),
  }).index("by_code", ["code"]),

  clubs: defineTable({
    name: v.string(),
    shortName: v.string(),
    leagueCode: v.string(),
    rank: v.number(),
    points: v.number(),
    goalDifference: v.number(),
    winRate: v.number(),
    meanXg: v.number(),
    ppda: v.number(),
    tempo: v.string(),
    form: v.array(v.string()), // ['W', 'W', 'W', 'D', 'W']
    formation: v.string(),
    badgeUrl: v.string(),
    activeStatus: v.string(),
    lastUpdated: v.number(),
  })
    .index("by_league", ["leagueCode"])
    .index("by_rank", ["rank"]),

  players: defineTable({
    name: v.string(),
    clubName: v.string(),
    number: number(),
    nationality: v.string(),
    position: v.string(),
    role: v.string(),
    age: v.number(),
    height: v.number(),
    photoUrl: v.string(),
    predictiveForm: v.number(),
    pitchBiasDelta: v.number(),
    confidence: v.number(),
    metrics: v.object({
      shotsObserved: v.number(),
      shotsPredicted: v.number(),
      keyPassesObserved: v.number(),
      keyPassesPredicted: v.number(),
      aerialDuelWinPct: v.number(),
      xtThreat: v.number(),
    }),
  }).index("by_club", ["clubName"]),

  tacticalSimulations: defineTable({
    teamName: v.string(),
    opponentName: v.string(),
    matchVenue: v.string(),
    matchTime: v.string(),
    winProbability: v.number(),
    drawProbability: v.number(),
    lossProbability: v.number(),
    formation: v.string(),
    highPressIntensity: v.number(),
    tempoMultiplier: v.number(),
    updatedAt: v.number(),
  }).index("by_team", ["teamName"]),
});

function number() {
  return v.number();
}
