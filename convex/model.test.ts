/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { fitProfile, walkForward, summarizeWalkForward, ModelLog } from "./lib/engine";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");

// Generador determinista para simular un jugador con firma conocida
function rng(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
function poisson(l: number, r: () => number) {
  const L = Math.exp(-l);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > L);
  return k - 1;
}
function simulatedPlayer(seed: number, n = 30): ModelLog[] {
  const r = rng(seed);
  const logs: ModelLog[] = [];
  for (let k = 0; k < n; k++) {
    const isAway = k % 2 === 1;
    const mult = isAway ? 0.85 : 1;
    const day = String(1 + k).padStart(2, "0");
    logs.push({
      matchDate: `2025-${k < 28 ? "09" : "10"}-${day}`,
      isAway,
      minutesPlayed: 90,
      rawStats: {
        totalShots: poisson(2.8 * mult, r),
        xG: +(poisson(2.8 * mult, r) * 0.11).toFixed(2),
        keyPasses: poisson(1.6 * mult, r),
        groundDuelsWon: poisson(3.6, r),
        rating: 7.2,
      },
    });
  }
  return logs;
}

describe("motor de perfil", () => {
  test("sin partidos, predice la tasa base de su posición", () => {
    const st = fitProfile([], { position: "FW" });
    expect(st.rates.totalShots.rate).toBeCloseTo(2.6, 5);
    expect(st.rates.totalShots.dataShare).toBe(0);
  });

  test("los minutos importan: 20' con 0 tiros pesa mucho menos que 90'", () => {
    const base: ModelLog = { matchDate: "2025-01-01", isAway: false, minutesPlayed: 90, rawStats: { totalShots: 4 } };
    const a = fitProfile([base, { ...base, matchDate: "2025-01-08", minutesPlayed: 20, rawStats: { totalShots: 0 } }], { position: "FW" });
    const b = fitProfile([base, { ...base, matchDate: "2025-01-08", minutesPlayed: 90, rawStats: { totalShots: 0 } }], { position: "FW" });
    expect(a.rates.totalShots.rate).toBeGreaterThan(b.rates.totalShots.rate);
  });

  test("una stat que falta no se rellena con un valor inventado", () => {
    const st = fitProfile([{ matchDate: "2025-01-01", isAway: false, minutesPlayed: 90, rawStats: { totalShots: 5 } }], { position: "MF" });
    expect(st.rates.keyPasses.dataShare).toBe(0);
  });

  test("le gana al método ingenuo y el error baja con los partidos", () => {
    let model = 0;
    let naive = 0;
    let early = 0;
    let late = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const pts = walkForward(simulatedPlayer(seed), { position: "FW" });
      const s = summarizeWalkForward(pts);
      model += s.modelError!;
      naive += s.naiveError!;
      early += pts.slice(0, 6).reduce((a, p) => a + p.modelError, 0) / 6;
      late += pts.slice(-6).reduce((a, p) => a + p.modelError, 0) / 6;
    }
    expect(model).toBeLessThan(naive);
    expect(late).toBeLessThan(early);
  });

  test("aprende el efecto visitante sin pasarse (real −15%)", () => {
    const effects = Array.from({ length: 40 }, (_, i) => Math.exp(fitProfile(simulatedPlayer(i + 1), { position: "FW" }).beta.is_away.mean) - 1);
    const mean = effects.reduce((a, b) => a + b, 0) / effects.length;
    expect(mean).toBeLessThan(-0.08);
    expect(mean).toBeGreaterThan(-0.2);
  });
});

describe("Convex: registro, informe e importación", () => {
  test("registrar partidos alimenta la curva con predicciones pre-partido", async () => {
    const t = convexTest(schema, modules);
    const { playerId } = await t.mutation(api.players.seedBellinghamDemo, {});
    const before = await t.query(api.predictions.getModelReport, { playerId });
    expect(before!.points.length).toBe(3);

    const res = await t.mutation(api.predictions.recordMatchAndCalibrate, {
      playerId,
      matchDate: "2024-11-02",
      opponent: "Valencia CF",
      isAway: true,
      minutesPlayed: 90,
      rawStats: { totalShots: 2, xG: 0.3, keyPasses: 2, groundDuelsWon: 5, rating: 7.6 },
    });
    expect(res.error).not.toBeNull();
    expect(res.predictedBefore.totalShots).toBeGreaterThan(0);

    const after = await t.query(api.predictions.getModelReport, { playerId });
    expect(after!.points.length).toBe(4);
    const weights = await t.run((ctx) => ctx.db.query("playerWeights").collect());
    expect(weights.map((w) => w.featureName).sort()).toEqual(["is_away", "opponent_defense"]);

    const fc = await t.mutation(api.predictions.calculateAndPredict, { playerId, opponent: "Sevilla", isAway: false });
    expect(fc.predictedMetrics.confidence).toBeLessThan(95);
    expect(fc.predictedMetrics.distribution.totalShots.high).toBeGreaterThanOrEqual(fc.predictedMetrics.distribution.totalShots.low);
  });

  test("importa el histórico sin duplicar y calcula la fuerza de los equipos", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.teams.seedInitialCompetitionsAndTeams, {});
    const r1 = await t.action(api.legacy.importLegacyData, {});
    expect(r1.matches).toBe(1324);
    expect(r1.teamsLinked).toBeGreaterThanOrEqual(2); // Manchester City e Inter ya existían
    const r2 = await t.action(api.legacy.importLegacyData, {});
    expect(r2.matches).toBe(0);
    expect(r2.players).toBe(0);

    const teams = await t.run((ctx) => ctx.db.query("teams").collect());
    const city = teams.filter((x) => x.name === "Manchester City");
    expect(city.length).toBe(1);
    expect(city[0].played).toBeGreaterThan(20);
    const rated = teams.filter((x) => x.defenseRating);
    const meanDef = rated.reduce((a, x) => a + x.defenseRating!, 0) / rated.length;
    expect(meanDef).toBeGreaterThan(0.85);
    expect(meanDef).toBeLessThan(1.15);
    const status = await t.query(api.legacy.legacyStatus, {});
    expect(status.importedMatches).toBe(status.availableMatches);
    expect(status.needsImport).toBe(false);
    const villa = teams.filter((x) => x.name === "Aston Villa");
    expect(villa.length).toBe(1);
    expect(villa[0].points).toBeGreaterThan(30);
    expect(teams.filter((x) => x.league === "premier").length).toBe(20);
  }, 120_000);

  test("repara equipos duplicados de una importación anterior", async () => {
    const t = convexTest(schema, modules);
    await t.action(api.legacy.importLegacyData, {});
    // Simula la importación vieja: un segundo "Aston Villa" con un partido propio
    await t.run(async (ctx) => {
      const keep = await ctx.db.query("teams").withIndex("by_legacyId", (q) => q.eq("legacyId", "tm_sd1ef75fw7n")).first();
      const rival = await ctx.db.query("teams").filter((q) => q.eq(q.field("name"), "Arsenal")).first();
      const dup = await ctx.db.insert("teams", { legacyId: "team_1772204890146_685085", name: "Aston Villa", league: "premier" });
      await ctx.db.insert("matches", { league: "premier", date: "2026-05-20", homeTeamId: dup, awayTeamId: rival!._id, homeGoals: 2, awayGoals: 0 });
      expect(keep).not.toBeNull();
    });
    const before = await t.query(api.legacy.legacyStatus, {});
    expect(before.duplicateTeams).toBe(1);
    expect(before.needsImport).toBe(true);
    const r = await t.action(api.legacy.importLegacyData, {});
    expect(r.teamsMerged).toBe(1);
    const villas = await t.run((ctx) => ctx.db.query("teams").filter((q) => q.eq(q.field("name"), "Aston Villa")).collect());
    expect(villas.length).toBe(1);
    const after = await t.query(api.legacy.legacyStatus, {});
    expect(after.needsImport).toBe(false);
  }, 120_000);
});

describe("Convex: flujo equipo → jugador", () => {
  test("perfil de equipo, simulador, resultados y alta de jugador", async () => {
    const t = convexTest(schema, modules);
    await t.action(api.legacy.importLegacyData, {});
    const teams = await t.run((ctx) => ctx.db.query("teams").collect());
    const arsenal = teams.find((x) => x.name === "Arsenal")!;
    const chelsea = teams.find((x) => x.name === "Chelsea")!;

    const profile = await t.query(api.teams.getTeamProfile, { teamId: arsenal._id });
    expect(profile!.record.total.played).toBe(arsenal.played);
    expect(profile!.record.total.wins + profile!.record.total.draws + profile!.record.total.losses).toBe(arsenal.played);
    expect(profile!.squad.length).toBeGreaterThan(10);
    expect(profile!.table.length).toBe(20);
    expect(profile!.results[0].date >= profile!.results[profile!.results.length - 1].date).toBe(true);

    const sim = await t.query(api.teams.predictMatch, { homeTeamId: arsenal._id, awayTeamId: chelsea._id });
    const sum = sim!.probabilities.home + sim!.probabilities.draw + sim!.probabilities.away;
    expect(sum).toBeCloseTo(1, 2);
    expect(sim!.expectedGoals.home).toBeGreaterThan(0);

    const before = arsenal.points!;
    const matchId = await t.mutation(api.teams.addMatchResult, {
      homeTeamId: arsenal._id,
      awayTeamId: chelsea._id,
      homeGoals: 3,
      awayGoals: 0,
      date: "2026-05-30",
    });
    expect((await t.run((ctx) => ctx.db.get(arsenal._id)))!.points).toBe(before + 3);
    await t.mutation(api.teams.deleteMatchResult, { matchId });
    expect((await t.run((ctx) => ctx.db.get(arsenal._id)))!.points).toBe(before);

    const playerId = await t.mutation(api.players.createPlayer, { teamId: arsenal._id, name: "Nuevo Nueve", position: "FW" });
    await t.mutation(api.predictions.recordMatchAndCalibrate, {
      playerId,
      matchDate: "2026-05-30",
      opponent: "Chelsea",
      opponentTeamId: chelsea._id,
      isAway: false,
      minutesPlayed: 90,
      rawStats: { totalShots: 4, xG: 0.6 },
    });
    const after = await t.query(api.teams.getTeamProfile, { teamId: arsenal._id });
    expect(after!.squad.find((p) => p._id === playerId)!.loggedMatches).toBe(1);
  }, 120_000);
});

describe("Convex: editar un partido", () => {
  test("cambia la competición y vincula/desvincula el rival", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.teams.seedInitialCompetitionsAndTeams, {});
    const { playerId } = await t.mutation(api.players.seedBellinghamDemo, {});
    const inter = (await t.run((ctx) => ctx.db.query("teams").collect())).find((x) => x.name.startsWith("Inter"))!;
    const { matchLogId } = await t.mutation(api.predictions.recordMatchAndCalibrate, {
      playerId,
      matchDate: "2026-09-08",
      opponent: "Inter",
      competition: "laliga",
      isAway: false,
      minutesPlayed: 90,
      rawStats: { totalShots: 2, xG: 1.24 },
    });
    await t.mutation(api.players.updateMatchLog, { matchLogId, competition: "ucl", opponentTeamId: inter._id });
    let log = await t.run((ctx) => ctx.db.get(matchLogId));
    expect(log!.competition).toBe("ucl");
    expect(log!.opponentTeamId).toBe(inter._id);
    expect(log!.rawStats.xG).toBe(1.24);
    await t.mutation(api.players.updateMatchLog, { matchLogId, opponentTeamId: null });
    log = await t.run((ctx) => ctx.db.get(matchLogId));
    expect(log!.opponentTeamId).toBeUndefined();
    expect(log!.competition).toBe("ucl");
  });
});

describe("Convex: ficha del jugador", () => {
  test("cambiar la posición cambia la tasa base del perfil", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.teams.seedInitialCompetitionsAndTeams, {});
    const team = (await t.run((ctx) => ctx.db.query("teams").first()))!;
    const playerId = await t.mutation(api.players.createPlayer, { teamId: team._id, name: "Prueba", position: "MF" });
    const mf = await t.query(api.predictions.getModelReport, { playerId });
    expect(mf!.profile.per90.totalShots.prior).toBeCloseTo(1.2, 2);
    await t.mutation(api.players.updatePlayer, { playerId, position: "AM", number: 5 });
    const am = await t.query(api.predictions.getModelReport, { playerId });
    expect(am!.profile.per90.totalShots.prior).toBeCloseTo(2.2, 2);
    const p = await t.run((ctx) => ctx.db.get(playerId));
    expect(p!.number).toBe(5);
    await t.mutation(api.players.updatePlayer, { playerId, number: null });
    expect((await t.run((ctx) => ctx.db.get(playerId)))!.number).toBeUndefined();
  });
});
