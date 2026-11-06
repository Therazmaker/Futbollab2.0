/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { matchPlayerName, narrativeMinutes, normalizeAnalysis, roleFor, teamTrends, TrendRow } from "./lib/narrative";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");

const team = (o: Record<string, unknown> = {}) => ({
  clearChances: 2,
  dominance: 50,
  finishing: "normal",
  defending: "normal",
  afterLeading: "never_led",
  afterTrailing: "never_trailed",
  intensity: "medium",
  keyPlayers: [],
  notes: "",
  ...o,
});
const analysis = (home: Record<string, unknown>, away: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  summary: "Partido",
  periods: [{ range: "0-15", dominant: "home", note: "" }],
  home: team(home),
  away: team(away),
  scoreFairness: "fair",
  events: [],
  ...extra,
});

describe("narraciones", () => {
  test("normaliza basura de la IA a valores seguros", () => {
    const a = normalizeAnalysis({
      summary: 42,
      home: { dominance: 140, finishing: "épico", clearChances: "3" },
      away: null,
      events: [{ minute: "12", team: "visitante", type: "goal", player: "X" }],
    });
    expect(a.summary).toBe("");
    expect(a.home.dominance).toBe(100);
    expect(a.home.finishing).toBe("normal");
    expect(a.home.clearChances).toBe(3);
    expect(a.away.afterLeading).toBe("never_led");
    expect(a.events[0]).toMatchObject({ minute: 12, team: "home", type: "goal" });
    expect(() => normalizeAnalysis("hola")).toThrow();
  });

  test("papel por cuotas y por fuerza", () => {
    expect(roleFor("home", { home: 1.5, away: 6 }, null, null)).toBe("favorite");
    expect(roleFor("away", { home: 1.5, away: 6 }, null, null)).toBe("underdog");
    expect(roleFor("home", undefined, 0.05, 0.0)).toBe("even");
    expect(roleFor("away", undefined, 0.8, -0.2)).toBe("underdog");
  });

  test("detecta al favorito que va sobrado y al underdog que compite", () => {
    const fav: TrendRow[] = [1, 2, 3].map(() => ({
      side: "home",
      role: "favorite",
      goalsFor: 1,
      goalsAgainst: 0,
      analysis: normalizeAnalysis(analysis({ afterLeading: "eased_off", dominance: 55 }, { dominance: 45 })),
    }));
    const t = teamTrends(fav);
    expect(t.asFavorite).toMatchObject({ matches: 3, easedOff: 3 });
    expect(t.insights.some((s) => s.includes("sobrado"))).toBe(true);

    const dog: TrendRow[] = [1, 2].map(() => ({
      side: "away",
      role: "underdog",
      goalsFor: 1,
      goalsAgainst: 1,
      analysis: normalizeAnalysis(analysis({}, { finishing: "clinical" })),
    }));
    const u = teamTrends(dog);
    expect(u.asUnderdog.competitive).toBe(2);
    expect(u.insights.some((s) => s.includes("underdog compite"))).toBe(true);
    // Un solo partido no basta para afirmar un patrón
    expect(teamTrends(dog.slice(0, 1)).insights).toHaveLength(0);
  });

  test("guarda la narración, calcula tendencias y la borra con el partido", async () => {
    const t = convexTest(schema, modules);
    const home = await t.mutation(api.teams.createTeam, { name: "Local FC", league: "laliga" });
    const away = await t.mutation(api.teams.createTeam, { name: "Visitante CF", league: "laliga" });
    const matchId = await t.mutation(api.teams.addMatchResult, {
      homeTeamId: home,
      awayTeamId: away,
      homeGoals: 1,
      awayGoals: 0,
      date: "2026-09-20",
    });
    const ctx = await t.query(api.narratives.matchContext, { matchId });
    expect(ctx).toMatchObject({ home: "Local FC", away: "Visitante CF", homeGoals: 1 });

    await t.mutation(api.narratives.saveNarrative, {
      matchId,
      text: "min 1...",
      provider: "gemini",
      model: "gemini-2.5-flash",
      analysis: analysis({ clearChances: 4, afterLeading: "eased_off" }, { clearChances: 1 }),
    });
    const trends = await t.query(api.narratives.getTeamTrends, { teamId: home });
    expect(trends.trends.matches).toBe(1);
    expect(trends.trends.avgClearChancesFor).toBe(4);
    expect(trends.trends.easedOff).toEqual({ count: 1, of: 1 });
    const other = await t.query(api.narratives.getTeamTrends, { teamId: away });
    expect(other.trends.avgClearChancesFor).toBe(1);
    // Antes de la fecha del partido no cuenta (sin fuga de información en el Radar)
    expect((await t.query(api.narratives.getTeamTrends, { teamId: home, beforeDate: "2026-09-20" })).trends.matches).toBe(0);

    await t.mutation(api.teams.deleteMatchResult, { matchId });
    expect(await t.run((c) => c.db.query("matchNarratives").collect())).toHaveLength(0);
  });

  test("ajustes de IA: Gemini por defecto y se puede cambiar a Claude", async () => {
    const t = convexTest(schema, modules);
    expect((await t.query(api.narratives.getAiSettings, {})).provider).toBe("gemini");
    await t.mutation(api.narratives.setAiSettings, { provider: "claude", claudeModel: "claude-haiku-5-5" });
    const s = await t.query(api.narratives.getAiSettings, {});
    expect(s).toMatchObject({ provider: "claude", claudeModel: "claude-haiku-5-5", geminiModel: "gemini-2.5-flash" });
    await expect(t.mutation(api.narratives.setAiSettings, { claudeModel: "gpt-4" })).rejects.toThrow();
  });
});

describe("resultados en bloque", () => {
  test("revisa, guarda, no duplica y avisa de equipos desconocidos", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.teams.createTeam, { name: "Valencia", league: "laliga" });
    await t.mutation(api.teams.createTeam, { name: "Real Madrid CF", league: "laliga" });
    await t.mutation(api.teams.createTeam, { name: "Real Betis", league: "laliga" });
    const rows = [
      { date: "2026-11-07", home: "Valencia", away: "Real Madrid", homeGoals: 1, awayGoals: 2 },
      { date: "2026-11-08", home: "Betis", away: "Sevilla", homeGoals: 2, awayGoals: 2 },
    ];
    const pre = await t.mutation(api.results.addResultsBulk, { competition: "laliga", preview: true, rows });
    expect(pre.recognized).toBe(1);
    expect(pre.unmatched).toEqual(["Sevilla"]);
    expect(await t.run((c) => c.db.query("matches").collect())).toHaveLength(0);

    const r1 = await t.mutation(api.results.addResultsBulk, { competition: "laliga", rows });
    expect(r1.added).toBe(1);
    const r2 = await t.mutation(api.results.addResultsBulk, { competition: "laliga", rows });
    expect(r2).toMatchObject({ added: 0, unchanged: 1 });
    const valencia = (await t.run((c) => c.db.query("teams").collect())).find((x) => x.name === "Valencia")!;
    expect(valencia.attackRating).toBeGreaterThan(0);
  });
});

const np = (o: Record<string, unknown>) => ({
  name: "Xavi",
  team: "home",
  position: "FW",
  started: "unknown",
  minuteIn: -1,
  minuteOut: -1,
  goals: 0,
  assists: 0,
  yellowCards: 0,
  redCards: 0,
  bigChancesMissed: 0,
  injured: false,
  note: "",
  ...o,
});

describe("jugadores desde la narración", () => {
  test("empareja nombres y estima minutos", () => {
    const squad = [{ name: "Isaac Romero" }, { name: "Vinícius Júnior" }, { name: "Dani Carvajal" }, { name: "Dani Ceballos" }];
    expect(matchPlayerName("Isaac Romero", squad)?.name).toBe("Isaac Romero");
    expect(matchPlayerName("I. Romero", squad)?.name).toBe("Isaac Romero");
    expect(matchPlayerName("Romero", squad)?.name).toBe("Isaac Romero");
    expect(matchPlayerName("Vinicius", squad)?.name).toBe("Vinícius Júnior");
    expect(matchPlayerName("Dani", squad)).toBeNull(); // ambiguo
    expect(matchPlayerName("Juan Romero", squad)).toBeNull(); // otra inicial

    const p = (o: Record<string, unknown>) => normalizeAnalysis({ players: [np(o)] }).players[0];
    expect(narrativeMinutes(p({ started: "no", minuteIn: 63 }))).toEqual({ minutes: 27, estimated: true });
    expect(narrativeMinutes(p({ started: "yes", minuteOut: 70 }))).toEqual({ minutes: 70, estimated: false });
    expect(narrativeMinutes(p({ started: "yes" }))).toEqual({ minutes: 90, estimated: false });
    expect(narrativeMinutes(p({}))).toEqual({ minutes: 90, estimated: true });
  });

  test("crea jugadores, apunta el partido, no duplica y las stats completas lo sustituyen", async () => {
    const t = convexTest(schema, modules);
    const home = await t.mutation(api.teams.createTeam, { name: "Sevilla", league: "laliga" });
    const away = await t.mutation(api.teams.createTeam, { name: "Alavés", league: "laliga" });
    const existing = await t.mutation(api.players.createPlayer, { teamId: home, name: "Isaac Romero", position: "FW" });
    const matchId = await t.mutation(api.teams.addMatchResult, { homeTeamId: home, awayTeamId: away, homeGoals: 1, awayGoals: 1, date: "2026-11-06" });
    await t.mutation(api.narratives.saveNarrative, {
      matchId,
      text: "…",
      provider: "gemini",
      model: "m",
      analysis: {
        ...analysis({}, {}),
        players: [
          np({ name: "I. Romero", goals: 1, started: "yes", minuteOut: 54, injured: true }),
          np({ name: "Lucas Stassin", minuteIn: 63, started: "no", position: "FW" }),
          np({ name: "Carlos Vicente", team: "away", goals: 1, yellowCards: 1, position: "MF" }),
        ],
      },
    });
    const pre = await t.mutation(api.narratives.registerNarrativePlayers, { matchId, preview: true });
    expect(pre.plan.map((p) => p.existingId)).toEqual([existing, null, null]);
    expect(await t.run((c) => c.db.query("playerMatchLogs").collect())).toHaveLength(0);

    const r = await t.mutation(api.narratives.registerNarrativePlayers, { matchId });
    expect(r).toMatchObject({ created: 2, logged: 3 });
    const again = await t.mutation(api.narratives.registerNarrativePlayers, { matchId });
    expect(again.logged).toBe(0);

    const logs = await t.run((c) => c.db.query("playerMatchLogs").collect());
    const romero = logs.find((l) => l.playerId === existing)!;
    expect(romero).toMatchObject({ source: "narrative", minutesPlayed: 54, injuredOff: true, isAway: false });
    expect(romero.rawStats.goals).toBe(1);
    const injuries = await t.run((c) => c.db.query("injuries").collect());
    expect(injuries).toHaveLength(1);
    // Partido de narración: aparece en el perfil pero no en el modelo
    const report = await t.query(api.predictions.getModelReport, { playerId: existing });
    expect(report!.points ?? []).toHaveLength(0);

    // Al registrar sus stats completas de ese partido, sustituyen al de narración
    await t.mutation(api.predictions.recordMatchAndCalibrate, {
      playerId: existing,
      matchId,
      matchDate: "2026-11-06",
      opponent: "Alavés",
      isAway: false,
      minutesPlayed: 54,
      rawStats: { totalShots: 3, xG: 0.6, keyPasses: 1, groundDuelsWon: 2, rating: 7.4, goals: 1 },
    });
    const mine = (await t.run((c) => c.db.query("playerMatchLogs").collect())).filter((l) => l.playerId === existing);
    expect(mine).toHaveLength(1);
    expect(mine[0].source).toBeUndefined();
    expect(mine[0].injuredOff).toBe(true);
    expect(await t.run((c) => c.db.query("injuries").collect())).toHaveLength(1);
  });
});

describe("diagnóstico de la importación", () => {
  test("dice cuántos partidos faltan y qué equipos no encuentra", async () => {
    const t = convexTest(schema, modules);
    const s = await t.query(api.legacy.legacyStatus, {});
    expect(s.needsImport).toBe(true);
    expect(s.missingMatches).toBe(s.availableMatches);
    expect(s.missingTeams.length).toBeGreaterThan(0);
    expect(s.missingSample.length).toBe(3);
    expect(s.statsPending).toBe(0);
  });
});

import { evaluate } from "./lib/radarTraining";
import { parseFootballDataCsv } from "./lib/footballData";
import fdMatchesData from "../data/legacy/fd_matches.json";

describe("CLV", () => {
  const snap = (o: Record<string, unknown> = {}) => ({
    probs: { home: 0.45, draw: 0.27, away: 0.28 },
    base: null,
    expectedGoals: { home: 1.4, away: 1.1 },
    attackFactor: { home: 1, away: 1 },
    odds: { home: 1.92, draw: 3.4, away: 4.25 },
    fair: { home: 0.5, draw: 0.28, away: 0.22 },
    flags: ["VALOR"],
    favorite: "home" as const,
    bestEdge: { outcome: "away" as const, odds: 4.25, model: 0.28, fair: 0.22 },
    players: [],
    late: false,
    ...o,
  });
  test("CLV positivo si la cuota cerró más baja y el mercado se movió hacia el modelo", () => {
    // Cierre: el visitante bajó a 3.40 → tu 4.25 era mejor que el cierre
    const r = evaluate([{ snap: snap(), result: { homeGoals: 1, awayGoals: 1, closingOdds: { home: 2.1, draw: 3.4, away: 3.4 }, playerLogs: [] } }]);
    expect(r.clv!.n).toBe(1);
    expect(r.clv!.mean).toBeGreaterThan(0.1);
    expect(r.clv!.beatRate).toBe(1);
    expect(r.towardModel).toMatchObject({ n: 1, rate: 1 });
    expect(r.vsClosing!.n).toBe(1);
  });
  test("CLV negativo si el mercado se movió en contra", () => {
    const r = evaluate([{ snap: snap(), result: { homeGoals: 2, awayGoals: 0, closingOdds: { home: 1.7, draw: 3.6, away: 5.5 }, playerLogs: [] } }]);
    expect(r.clv!.mean).toBeLessThan(0);
    expect(r.towardModel!.rate).toBe(0);
  });
  test("sin cuota de cierre no hay CLV", () => {
    const r = evaluate([{ snap: snap(), result: { homeGoals: 2, awayGoals: 0, playerLogs: [] } }]);
    expect(r.clv).toBeNull();
    expect(r.vsClosing).toBeNull();
    expect(r.clvBacktest.n).toBeGreaterThan(1000);
  });

  test("lee el CSV de football-data con los mismos ids que el histórico", () => {
    const csv = [
      "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HxG,AxG,HS,AS,HST,AST,AvgCH,AvgCD,AvgCA,AvgC>2.5,AvgC<2.5",
      "SP1,15/08/2026,18:30,Alaves,Getafe,3,0,H,1.93,0.24,18,6,8,2,2.4,2.9,3.6,2.1,1.75",
      "SP1,16/08/2026,18:30,Equipo Nuevo,Getafe,1,1,D,,,10,9,3,3,,,,,",
      "SP1,17/08/2026,18:30,Sevilla,Betis,,,,,,,,,,,,,,",
    ].join("\n");
    const { rows, unknown } = parseFootballDataCsv(csv, "SP1", "2627");
    expect(unknown).toEqual(["Equipo Nuevo"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      legacyId: "sp1_2627_2026-08-15_alaves_getafe",
      league: "laliga",
      homeLegacyId: "sp_alaves",
      stats: { hs: 18, hst: 8, hxg: 1.93 },
      closingOdds: { home: 2.4, draw: 2.9, away: 3.6, over25: 2.1 },
    });
    expect((fdMatchesData as any[]).some((m) => m.legacyId === rows[0].legacyId)).toBe(true);
  });

  test("Convex: cuota de cierre → CLV en Entrenamiento", async () => {
    const t = convexTest(schema, modules);
    const home = await t.mutation(api.teams.createTeam, { name: "Sevilla", league: "laliga" });
    const away = await t.mutation(api.teams.createTeam, { name: "Alavés", league: "laliga" });
    await t.mutation(api.teams.addMatchResult, { homeTeamId: home, awayTeamId: away, homeGoals: 0, awayGoals: 2, date: "2026-09-01" });
    const matchId = await t.mutation(api.radar.addRadarMatch, { homeTeamId: home, awayTeamId: away, date: "2026-11-06", competition: "laliga" });
    await t.mutation(api.radar.setOdds, { matchId, home: 1.3, draw: 5, away: 9 });
    await t.mutation(api.radar.snapshotRange, { fromDate: "2026-11-06", toDate: "2026-11-06" });
    await expect(t.mutation(api.radar.setClosingOdds, { matchId, home: 1.5 })).rejects.toThrow(/tres cuotas/);
    await t.mutation(api.radar.setClosingOdds, { matchId, home: 1.6, draw: 4, away: 6 });
    await t.mutation(api.teams.setMatchScore, { matchId, homeGoals: 1, awayGoals: 1 });
    const tr = await t.query(api.radar.getTraining, {});
    expect(tr.vsClosing!.n).toBe(1);
    const radar = await t.query(api.radar.getRadar, { fromDate: "2026-11-06", toDate: "2026-11-06" });
    expect(radar[0].closingOdds).toMatchObject({ home: 1.6 });
  });
});

describe("mercado + tus correcciones", () => {
  test("Entrenamiento mide si las correcciones por bajas mejoran al mercado", () => {
    const mk = (homeGoals: number, awayGoals: number) => ({
      snap: {
        probs: { home: 0.4, draw: 0.28, away: 0.32 },
        modelProbs: { home: 0.35, draw: 0.28, away: 0.37 },
        source: "market",
        base: null,
        expectedGoals: { home: 1.2, away: 1.2 },
        attackFactor: { home: 0.85, away: 1 },
        odds: { home: 2.2, draw: 3.4, away: 3.6 },
        fair: { home: 0.44, draw: 0.28, away: 0.28 },
        flags: [] as string[],
        favorite: "home" as const,
        players: [],
        late: false,
      },
      result: { homeGoals, awayGoals, playerLogs: [] },
    });
    // Ganó el visitante: la corrección (bajar al local) acertó
    const good = evaluate([mk(0, 1), mk(0, 2)]);
    expect(good.corrections!.n).toBe(2);
    expect(good.corrections!.delta).toBeLessThan(0);
    const bad = evaluate([mk(2, 0)]);
    expect(bad.corrections!.delta).toBeGreaterThan(0);
  });
});

import { buildReading } from "./lib/matchReading";

describe("lectura del partido", () => {
  test("Sevilla–Alavés: explica en palabras lo que dicen los números", () => {
    const t = (o: Record<string, unknown>) => ({ xgFor: 0, xgAgainst: 0, xgMatches: 0, ...o }) as any;
    const r = buildReading({
      home: t({ name: "Sevilla", played: 12, w: 5, d: 3, l: 4, gf: 17, ga: 19, form: ["L", "W", "L", "D", "L"], rank: 6, points: 18, xgFor: 16.8, xgAgainst: 14.4, xgMatches: 12 }),
      away: t({ name: "Alavés", played: 12, w: 3, d: 4, l: 5, gf: 15, ga: 17, form: ["L", "D", "L", "D", "D"], rank: 9, points: 13 }),
      probs: { home: 0.5, draw: 0.28, away: 0.22 },
      modelProbs: { home: 0.44, draw: 0.27, away: 0.28 },
      fair: { home: 0.5, draw: 0.28, away: 0.22 },
      expectedGoals: { home: 1.6, away: 1.2 },
      over25: 0.55,
      homeAdvantage: 1.2,
      goalsPerTeam: 1.35,
      absences: { home: [], away: [] },
      played: false,
    });
    console.log([r.headline, ...r.lines].join("\n"));
    expect(r.headline).toContain("no por mucho");
    expect(r.lines.some((l) => l.includes("casi iguales"))).toBe(true);
    expect(r.lines.some((l) => l.includes("juega mejor de lo que dice su marcador"))).toBe(true);
    expect(r.lines.some((l) => l.includes("suele acertar el mercado"))).toBe(true);
  });
});

import { evaluatePick, probOfPick } from "./lib/picks";
import { summarizeHistory } from "./lib/pickHistory";
import { normalizePreview, compareWithData } from "./lib/preview";
import { normalizeAiPicks } from "./lib/aiPredict";

describe("Entrenamiento / Histórico del Radar (del FutbolLab viejo)", () => {
  test("resuelve los 8 mercados, incluidos los del descanso", () => {
    const m = { homeGoals: 2, awayGoals: 1, halfTime: { home: 0, away: 0 } };
    expect(evaluatePick("result", "home", m)).toBe("won");
    expect(evaluatePick("doubleChance", "away_draw", m)).toBe("lost");
    expect(evaluatePick("btts", "yes", m)).toBe("won");
    expect(evaluatePick("over25", "yes", m)).toBe("won");
    expect(evaluatePick("cleanSheet", "none", m)).toBe("won");
    expect(evaluatePick("htGoalless", "yes", m)).toBe("won");
    expect(evaluatePick("htResult", "draw", m)).toBe("won");
    expect(evaluatePick("htResult", "draw", { homeGoals: 1, awayGoals: 0 })).toBeNull(); // sin descanso
    expect(evaluatePick("result", "home", {})).toBeNull();
    expect(probOfPick({ home: 0.5, draw: 0.3, away: 0.2 }, "doubleChance", "away_draw")).toBeCloseTo(0.5);
  });

  test("histórico: acierto, ROI, rachas, curva y barras", () => {
    const row = (i: number, verdict: "won" | "lost", source: "ai" | "user", odds: number | null) => ({
      id: `r${i}`, matchId: `m${i}`, date: `2026-10-0${i}`, competition: "laliga", home: "A", away: "B", source, market: "result", pick: "home",
      label: "Gana A", confidence: 0.6, odds, systemProb: 0.5, marketProb: 0.5, closingProb: 0.45, verdict, score: "1-0",
    });
    const s = summarizeHistory([row(1, "won", "ai", 2), row(2, "won", "ai", 2), row(3, "lost", "user", 2), row(4, "won", "user", null)]);
    expect(s).toMatchObject({ total: 4, n: 4, won: 3, staked: 3, profit: 1 });
    expect(s.streak).toEqual({ current: 1, type: "won", best: 2 });
    expect(s.curve.map((p) => [p.ai, p.user])).toEqual([[1, 0], [2, 0], [2, -1]]);
    expect(s.bySource.find((b) => b.key === "ai")!.rate).toBe(1);
    expect(s.expected).toBeCloseTo(0.5);
    expect(s.clv!.mean).toBeCloseTo(2 * 0.45 - 1);
  });

  test("previa e IA: se normaliza lo que devuelva el modelo", () => {
    const a = normalizePreview({ structured: { absences: "Sin Isco" }, signals: { narrativeFavours: "away", drawSignal: "high", upsetAlert: "x" }, absentPlayers: [{ name: "Isco", team: "home", status: "out" }], summary: "s" });
    expect(a.signals).toMatchObject({ narrativeFavours: "away", drawSignal: "high", upsetAlert: "low" });
    expect(a.structured.matchContext).toBe("");
    expect(compareWithData(a, { home: 0.5, away: 0.25 }).consistency).toBe("low");
    const p = normalizeAiPicks({ markets: { result: { pick: "draw", confidence: 34, reasoning: "r" }, btts: { pick: "maybe" } }, summary: "x" });
    expect(p.picks).toEqual([{ market: "result", pick: "draw", confidence: 0.34, reasoning: "r" }]);
  });

  test("Convex: pronóstico antes del partido → se resuelve solo → histórico", async () => {
    const t = convexTest(schema, modules);
    const home = await t.mutation(api.teams.createTeam, { name: "Sevilla", league: "laliga" });
    const away = await t.mutation(api.teams.createTeam, { name: "Alavés", league: "laliga" });
    await t.mutation(api.teams.addMatchResult, { homeTeamId: home, awayTeamId: away, homeGoals: 1, awayGoals: 1, date: "2026-09-01" });
    const matchId = await t.mutation(api.radar.addRadarMatch, { homeTeamId: home, awayTeamId: away, date: "2026-11-06", competition: "laliga" });
    await t.mutation(api.radar.setOdds, { matchId, home: 1.92, draw: 3.4, away: 4.25 });
    await expect(t.mutation(api.radarAi.savePicks, { matchId, source: "user", picks: [{ market: "result", pick: "x" }] })).rejects.toThrow(/no válido/);
    await t.mutation(api.radarAi.savePicks, {
      matchId,
      source: "user",
      picks: [
        { market: "doubleChance", pick: "away_draw", odds: 1.9, confidence: 0.6 },
        { market: "result", pick: "draw" },
        { market: "htGoalless", pick: "yes" },
      ],
    });
    let picks = await t.query(api.radarAi.getPicks, { matchId });
    expect(picks).toHaveLength(3);
    const res = picks.find((p) => p.market === "result")!;
    expect(res.odds).toBe(3.4); // usa la cuota del Radar
    expect(res.systemProb).toBeGreaterThan(0.1);
    expect(res.marketProb).toBeGreaterThan(0.2);
    expect(picks.every((p) => p.verdict === null)).toBe(true);
    await t.mutation(api.radarAi.savePreview, {
      matchId, text: "previa", provider: "gemini", model: "m",
      analysis: { structured: {}, signals: { drawSignal: "high", narrativeFavours: "away" }, absentPlayers: [], summary: "Partido cerrado" },
    });

    await t.mutation(api.teams.setMatchScore, { matchId, homeGoals: 1, awayGoals: 1 });
    await t.run((c) => c.db.patch(matchId, { halfTime: { home: 0, away: 0 } }));
    picks = await t.query(api.radarAi.getPicks, { matchId });
    expect(picks.map((p) => p.verdict).sort()).toEqual(["won", "won", "won"]);
    // Después del partido ya no se puede tocar
    await expect(t.mutation(api.radarAi.savePicks, { matchId, source: "user", picks: [] })).rejects.toThrow(/antes de jugarse/);
    await expect(t.mutation(api.radarAi.deletePicks, { matchId, source: "user" })).rejects.toThrow(/histórico/);

    const h = await t.query(api.radarAi.getHistory, {});
    expect(h.summary).toMatchObject({ total: 3, won: 3, pending: 0 });
    expect(h.summary.roi).toBeGreaterThan(0);
    expect(h.previewSignals.find((s) => s.key === "draw_high")).toMatchObject({ nActive: 1, rateActive: 1 });
    expect(h.rows[0].score).toBe("1-1 (0-0)");
  });
});
