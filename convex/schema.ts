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
    currentSeason: v.optional(v.string()), // "2026-27"
    // Frecuencias reales de goles (para +1.5/+2.5/+3.5 y ambos marcan)
    goalRates: v.optional(
      v.object({
        over15: v.number(),
        over25: v.number(),
        over35: v.number(),
        btts: v.number(),
        homeWin: v.optional(v.number()),
        draw: v.optional(v.number()),
        awayWin: v.optional(v.number()),
        homeCleanSheet: v.optional(v.number()),
        awayCleanSheet: v.optional(v.number()),
      })
    ),
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
    season: v.optional(v.string()), // temporada a la que corresponden rank/points/played…
    // Equipo sin liga (league = "intl"): temporada en la que está inscrito en su competición
    competitionSeason: v.optional(v.string()),
    played: v.optional(v.number()),
    wins: v.optional(v.number()),
    draws: v.optional(v.number()),
    losses: v.optional(v.number()),
    goalsFor: v.optional(v.number()),
    goalsAgainst: v.optional(v.number()),
    lastSeason: v.optional(
      v.object({
        season: v.string(),
        rank: v.number(),
        points: v.number(),
        played: v.number(),
        goalsFor: v.number(),
        goalsAgainst: v.number(),
      })
    ),
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
  // Partido de equipo. Lo crean los resultados, la importación o el registro
  // del partido de un jugador. `league` = competición del partido (una liga
  // doméstica o "ucl", "copa"...); solo cuentan para la tabla los partidos de
  // liga entre equipos de esa liga y con marcador.
  matches: defineTable({
    legacyId: v.optional(v.string()),
    league: v.string(),
    date: v.string(), // YYYY-MM-DD
    homeTeamId: v.id("teams"),
    awayTeamId: v.id("teams"),
    homeGoals: v.optional(v.number()), // sin marcador todavía = undefined
    awayGoals: v.optional(v.number()),
    // Estadísticas de equipo (football-data): tiros, a puerta y xG (si lo hay)
    stats: v.optional(
      v.object({
        hs: v.number(),
        as: v.number(),
        hst: v.number(),
        ast: v.number(),
        hxg: v.optional(v.number()),
        axg: v.optional(v.number()),
      })
    ),
    // Marcador al descanso (football-data)
    halfTime: v.optional(v.object({ home: v.number(), away: v.number() })),
    // Cuotas medias de cierre del mercado (para medir CLV)
    closingOdds: v.optional(
      v.object({
        home: v.number(),
        draw: v.number(),
        away: v.number(),
        over25: v.optional(v.number()),
        under25: v.optional(v.number()),
      })
    ),
    // Cuotas decimales que mete el usuario (Radar): 1-X-2
    odds: v.optional(
      v.object({
        home: v.optional(v.number()),
        draw: v.optional(v.number()),
        away: v.optional(v.number()),
        updatedAt: v.optional(v.number()),
        source: v.optional(v.string()), // "football-data" (cuota media) o ausente (las pusiste tú)
      })
    ),
  })
    .index("by_league_and_date", ["league", "date"])
    .index("by_date", ["date"])
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
    matchId: v.optional(v.id("matches")), // partido del equipo al que pertenece
    injuredOff: v.optional(v.boolean()), // salió lesionado en este partido
    // "narrative": sacado de la narración (goles, tarjetas, minutos aprox.), sin stats
    // completas; no entra en los modelos de tiros/xG/nota hasta que se pegan sus stats
    source: v.optional(v.string()),
  })
    .index("by_player", ["playerId"])
    .index("by_player_and_date", ["playerId", "matchDate"])
    .index("by_match", ["matchId"]),

  // Foto del Radar ANTES del partido: con ella se puntúa el modelo cuando llega el resultado
  radarSnapshots: defineTable({
    matchId: v.id("matches"),
    date: v.string(),
    competition: v.string(),
    takenAt: v.number(),
    late: v.boolean(), // tomada al guardar el marcador (sin que nadie abriera el Radar antes)
    probs: v.any(), // home, draw, away, over15, over25, over35, btts, homeCleanSheet, awayCleanSheet
    modelProbs: v.optional(v.any()), // 1X2 del modelo (con cuotas, probs = mercado + tus correcciones)
    source: v.optional(v.string()), // "market" | "model"
    base: v.any(), // frecuencias de la liga en ese momento (referencia)
    baseProbs: v.optional(v.any()), // 1X2 sin el ajuste por bajas (si lo hubo)
    expectedGoals: v.any(),
    attackFactor: v.any(),
    odds: v.optional(v.any()),
    fair: v.optional(v.any()),
    flags: v.array(v.string()),
    favorite: v.string(),
    bestEdge: v.optional(v.any()),
    players: v.any(), // [{ playerId, teamId, pScore, pShot1, pShot2, xG, minutes, rating }]
    studyScore: v.number(),
    bold: v.optional(v.any()), // foto del Radar Audaz: probs, pick, craziness, level, fuentes
  }).index("by_match", ["matchId"]),

  // Lesiones de jugadores (la abierta = sin endDate)
  injuries: defineTable({
    playerId: v.id("players"),
    startDate: v.string(), // YYYY-MM-DD
    expectedReturn: v.optional(v.string()),
    endDate: v.optional(v.string()), // vuelve a jugar o se marca recuperado
    note: v.optional(v.string()),
    fromLogId: v.optional(v.id("playerMatchLogs")), // partido en que se lesionó
  }).index("by_player", ["playerId"]),

  // Parámetros globales aprendidos con todos los jugadores (p. ej. el modelo de nota)
  modelParams: defineTable({
    name: v.string(),
    params: v.any(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),

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

  // Narración del partido (texto pegado) + lo que la IA extrajo de ella
  matchNarratives: defineTable({
    matchId: v.id("matches"),
    text: v.string(),
    provider: v.string(), // "gemini" | "claude"
    model: v.string(),
    analysis: v.any(), // ver src/lib/narrative.ts (NarrativeAnalysis)
    createdAt: v.number(),
  }).index("by_match", ["matchId"]),

  // Ajustes de la app (proveedor de IA, modelos…)
  appSettings: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),

  // Predicciones guardadas ANTES del partido: de la IA o tuyas ("Mi pronóstico").
  // Se resuelven solas cuando llega el marcador (y el del descanso para los mercados de 1ª parte).
  radarPicks: defineTable({
    matchId: v.id("matches"),
    matchDate: v.string(),
    competition: v.string(),
    source: v.string(), // "ai" | "user"
    market: v.string(), // result | doubleChance | btts | over15 | over25 | cleanSheet | htGoalless | htResult
    pick: v.string(), // home | draw | away | home_draw | away_draw | home_away | yes | no | none
    confidence: v.optional(v.number()), // 0–1
    reasoning: v.optional(v.string()),
    odds: v.optional(v.number()), // cuota a la que lo cogerías (para ROI/CLV)
    systemProb: v.optional(v.number()), // probabilidad que el Radar daba a ese pick en ese momento
    marketProb: v.optional(v.number()), // probabilidad del mercado (tus cuotas sin margen), si la hay
    model: v.optional(v.string()), // modelo de IA que lo generó
    createdAt: v.number(),
  })
    .index("by_match", ["matchId"])
    .index("by_source_and_date", ["source", "matchDate"]),

  // "Radar Analysis Editor": la previa/noticias pegadas y lo que la IA sacó de ellas
  matchPreviews: defineTable({
    matchId: v.id("matches"),
    text: v.string(),
    provider: v.string(),
    model: v.string(),
    analysis: v.any(), // ver convex/lib/preview.ts
    createdAt: v.number(),
  }).index("by_match", ["matchId"]),

  // Detector: reglas que dictas tú (la IA las traduce a datos) y su prueba en el histórico
  radarRules: defineTable({
    name: v.string(),
    text: v.string(), // tu regla, con tus palabras
    teamId: v.optional(v.id("teams")), // regla de un equipo concreto
    conditions: v.array(v.object({ feature: v.string(), op: v.string(), value: v.number() })),
    target: v.string(),
    manualChecks: v.array(v.string()), // lo que no se puede medir con datos: se revisa a mano
    active: v.boolean(),
    originMatchId: v.optional(v.id("matches")), // partido que la inspiró ("¿qué me faltó mirar?")
    origin: v.optional(v.string()), // "manual" | "thesis" (de una tesis tuya) | "learned" (la IA aprendiendo de tus tesis)
    thesisId: v.optional(v.id("radarTheses")),
    backtest: v.optional(v.any()),
    createdAt: v.number(),
  }),

  // "Mi tesis" (Radar Audaz): lo que ves en un partido y lo que crees que pasará, antes de jugarse
  radarTheses: defineTable({
    matchId: v.id("matches"),
    matchDate: v.string(),
    text: v.string(),
    market: v.string(),
    pick: v.string(),
    confidence: v.optional(v.number()),
    reasons: v.array(v.string()),
    feedback: v.string(), // lo que la IA ve a favor y en contra
    ruleId: v.optional(v.id("radarRules")), // regla general propuesta a partir de la tesis
    model: v.string(),
    createdAt: v.number(),
  })
    .index("by_match", ["matchId"])
    .index("by_date", ["matchDate"]),
});
