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
    expect(r1.matches).toBe(1330);
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
  }, 120_000);
});
