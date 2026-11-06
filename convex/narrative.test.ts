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
