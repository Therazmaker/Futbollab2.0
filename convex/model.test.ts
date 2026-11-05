/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { fitProfile, walkForward, summarizeWalkForward, ModelLog } from "./lib/engine";
import { currentSeason, seasonOf } from "./lib/season";

// Fechas dentro de la temporada actual (para que los tests no caduquen)
const SEASON_YEAR = Number(currentSeason().slice(0, 4));
const inSeason = (mmdd: string) => `${Number(mmdd.slice(0, 2)) >= 7 ? SEASON_YEAR : SEASON_YEAR + 1}-${mmdd}`;

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
    // El histórico (2025-26) no cuenta para la tabla actual, pero queda como referencia
    expect(city[0].played).toBeUndefined();
    expect(city[0].lastSeason!.played).toBeGreaterThan(20);
    expect(city[0].attackRating).toBeGreaterThan(0);
    const rated = teams.filter((x) => x.defenseRating);
    const meanDef = rated.reduce((a, x) => a + x.defenseRating!, 0) / rated.length;
    expect(meanDef).toBeGreaterThan(0.85);
    expect(meanDef).toBeLessThan(1.15);
    const status = await t.query(api.legacy.legacyStatus, {});
    expect(status.importedMatches).toBe(status.availableMatches);
    expect(status.needsImport).toBe(false);
    const villa = teams.filter((x) => x.name === "Aston Villa");
    expect(villa.length).toBe(1);
    expect(villa[0].lastSeason!.points).toBeGreaterThan(30);
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
    expect(profile!.record.total.played).toBe(0); // temporada actual: aún sin partidos
    expect(arsenal.lastSeason!.played).toBeGreaterThan(30);
    expect(profile!.squad.length).toBeGreaterThan(10);
    expect(profile!.table.length).toBe(0);
    expect(profile!.lastTable.length).toBe(20);
    expect(profile!.results[0].date >= profile!.results[profile!.results.length - 1].date).toBe(true);

    const sim = await t.query(api.teams.predictMatch, { homeTeamId: arsenal._id, awayTeamId: chelsea._id });
    const sum = sim!.probabilities.home + sim!.probabilities.draw + sim!.probabilities.away;
    expect(sum).toBeCloseTo(1, 2);
    expect(sim!.expectedGoals.home).toBeGreaterThan(0);

    const before = arsenal.points ?? 0;
    const matchId = await t.mutation(api.teams.addMatchResult, {
      homeTeamId: arsenal._id,
      awayTeamId: chelsea._id,
      homeGoals: 3,
      awayGoals: 0,
      date: inSeason("09-30"),
    });
    expect((await t.run((ctx) => ctx.db.get(arsenal._id)))!.points).toBe(before + 3);
    await t.mutation(api.teams.deleteMatchResult, { matchId });
    expect((await t.run((ctx) => ctx.db.get(arsenal._id)))!.points ?? 0).toBe(before);

    const playerId = await t.mutation(api.players.createPlayer, { teamId: arsenal._id, name: "Nuevo Nueve", position: "FW" });
    await t.mutation(api.predictions.recordMatchAndCalibrate, {
      playerId,
      matchDate: inSeason("09-30"),
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

describe("Convex: partidos de equipo ↔ partidos de jugador", () => {
  test("registrar, reutilizar, marcador, detalle, UCL, vincular y limpiar", async () => {
    const t = convexTest(schema, modules);
    await t.action(api.legacy.importLegacyData, {});
    const teams = await t.run((ctx) => ctx.db.query("teams").collect());
    const arsenal = teams.find((x) => x.name === "Arsenal")!;
    const chelsea = teams.find((x) => x.name === "Chelsea")!;
    const inter = teams.find((x) => x.name === "Inter")!;
    const pA = await t.mutation(api.players.createPlayer, { teamId: arsenal._id, name: "Jugador A", position: "FW" });
    const pB = await t.mutation(api.players.createPlayer, { teamId: arsenal._id, name: "Jugador B", position: "MF" });
    const pointsBefore = arsenal.points ?? 0;

    // 1) A registra vs Chelsea con marcador → crea el partido del equipo y cuenta en la tabla
    const r1 = await t.mutation(api.predictions.recordMatchAndCalibrate, {
      playerId: pA, matchDate: inSeason("09-01"), opponent: "Chelsea", opponentTeamId: chelsea._id,
      isAway: false, minutesPlayed: 90, rawStats: { totalShots: 3, xG: 0.5, rating: 7.5 }, teamGoals: 2, opponentGoals: 1,
    });
    expect(r1.teamMatchId).not.toBeNull();
    expect((await t.run((ctx) => ctx.db.get(arsenal._id)))!.points).toBe(pointsBefore + 3);

    // 2) B lo elige de la lista → mismo partido, sin duplicar
    const recent = await t.query(api.teams.recentMatches, { teamId: arsenal._id, playerId: pB });
    const picked = recent.find((m) => m._id === r1.teamMatchId)!;
    expect(picked.playersLogged).toBe(1);
    expect(picked.loggedByPlayer).toBe(false);
    const r2 = await t.mutation(api.predictions.recordMatchAndCalibrate, {
      playerId: pB, matchDate: "x", opponent: "x", isAway: true, matchId: picked._id,
      minutesPlayed: 70, rawStats: { totalShots: 1, xG: 0.2, rating: 6.5 },
    });
    expect(r2.teamMatchId).toBe(r1.teamMatchId);
    const logB = await t.run((ctx) => ctx.db.get(r2.matchLogId));
    expect(logB!.isAway).toBe(false); // se toma del partido, no del formulario
    expect(logB!.matchDate).toBe(inSeason("09-01"));
    expect(logB!.opponentTeamId).toBe(chelsea._id);

    // 3) A no puede registrar el mismo partido dos veces
    await expect(
      t.mutation(api.predictions.recordMatchAndCalibrate, {
        playerId: pA, matchDate: inSeason("09-01"), opponent: "Chelsea", isAway: false, matchId: r1.teamMatchId!,
        minutesPlayed: 90, rawStats: { totalShots: 1 },
      })
    ).rejects.toThrow(/ya tiene registrado/);

    // 4) Detalle: 2 jugadores de Arsenal, totales sumados, nota media
    const detail = await t.query(api.teams.getMatchDetail, { matchId: r1.teamMatchId! });
    expect(detail!.home.players.length).toBe(2);
    expect(detail!.home.totals.totalShots).toBe(4);
    expect(detail!.home.totals.xG).toBeCloseTo(0.7, 5);
    expect(detail!.home.ratingAvg).toBe(7);
    expect(detail!.home.totals.rating).toBeUndefined();

    // 5) Sin marcador: no cuenta en la tabla hasta que se pone
    const pts = (await t.run((ctx) => ctx.db.get(arsenal._id)))!.points ?? 0;
    const r3 = await t.mutation(api.predictions.recordMatchAndCalibrate, {
      playerId: pA, matchDate: inSeason("09-08"), opponent: "Chelsea", opponentTeamId: chelsea._id,
      isAway: true, minutesPlayed: 90, rawStats: { totalShots: 2 },
    });
    expect((await t.run((ctx) => ctx.db.get(arsenal._id)))!.points ?? 0).toBe(pts);
    await t.mutation(api.teams.setMatchScore, { matchId: r3.teamMatchId!, homeGoals: 0, awayGoals: 1 });
    expect((await t.run((ctx) => ctx.db.get(arsenal._id)))!.points).toBe(pts + 3);

    // 6) UCL: aparece en el perfil pero no toca la tabla de liga
    const ptsBeforeUcl = (await t.run((ctx) => ctx.db.get(arsenal._id)))!.points ?? 0;
    const r4 = await t.mutation(api.predictions.recordMatchAndCalibrate, {
      playerId: pA, matchDate: inSeason("09-15"), opponent: "Inter", opponentTeamId: inter._id, competition: "ucl",
      isAway: false, minutesPlayed: 90, rawStats: { totalShots: 4 }, teamGoals: 3, opponentGoals: 0,
    });
    expect((await t.run((ctx) => ctx.db.get(arsenal._id)))!.points).toBe(ptsBeforeUcl);
    const profile = await t.query(api.teams.getTeamProfile, { teamId: arsenal._id });
    const ucl = profile!.results.find((r) => r._id === r4.teamMatchId)!;
    expect(ucl.competition).toBe("ucl");
    expect(ucl.result).toBe("W");

    // 7) Partidos viejos sin vincular → se vinculan por nombre del rival y fecha
    const oldLog = await t.run((ctx) =>
      ctx.db.insert("playerMatchLogs", {
        playerId: pB, matchDate: inSeason("09-08"), opponent: "Chelsea", isAway: true, minutesPlayed: 80, rawStats: { totalShots: 1 },
      })
    );
    expect(await t.query(api.players.unlinkedLogsCount, {})).toBeGreaterThanOrEqual(1);
    await t.mutation(api.players.linkUnlinkedLogs, {});
    expect((await t.run((ctx) => ctx.db.get(oldLog)))!.matchId).toBe(r3.teamMatchId);

    // 8) Borrar el único jugador de un partido sin marcador elimina el partido vacío
    const r5 = await t.mutation(api.predictions.recordMatchAndCalibrate, {
      playerId: pA, matchDate: inSeason("09-22"), opponent: "Chelsea", opponentTeamId: chelsea._id,
      isAway: false, minutesPlayed: 90, rawStats: { totalShots: 2 },
    });
    await t.mutation(api.players.deleteMatchLog, { matchLogId: r5.matchLogId });
    expect(await t.run((ctx) => ctx.db.get(r5.teamMatchId!))).toBeNull();

    // 9) Editar la fecha re-vincula el partido
    await t.mutation(api.players.updateMatchLog, { matchLogId: r2.matchLogId, matchDate: inSeason("09-29") });
    const moved = await t.run((ctx) => ctx.db.get(r2.matchLogId));
    expect(moved!.matchId).not.toBe(r1.teamMatchId);
    const newMatch = await t.run((ctx) => ctx.db.get(moved!.matchId!));
    expect(newMatch!.date).toBe(inSeason("09-29"));
    expect(seasonOf(newMatch!.date)).toBe(currentSeason());
  }, 180_000);
});

describe("calibración del xG", () => {
  test("con xG por tiro realista, el error medio del xG ronda 0.8σ", () => {
    const r = rng(99);
    // xG de un tiro: lejano / medio / ocasión clara / penalti
    const shotXg = () => {
      const u = r();
      if (u < 0.7) return -Math.log(1 - r()) * 0.04;
      if (u < 0.9) return 0.1 + r() * 0.1;
      if (u < 0.98) return 0.3 + r() * 0.2;
      return 0.76;
    };
    const zs: number[] = [];
    for (let p = 0; p < 60; p++) {
      const logs: ModelLog[] = [];
      for (let k = 0; k < 20; k++) {
        const shots = poisson(2.4, r);
        let xg = 0;
        for (let j = 0; j < shots; j++) xg += shotXg();
        logs.push({
          matchDate: `2025-${String(1 + Math.floor(k / 4)).padStart(2, "0")}-${String(1 + (k % 4) * 7).padStart(2, "0")}`,
          isAway: false,
          minutesPlayed: 90,
          rawStats: { totalShots: shots, xG: +xg.toFixed(2) },
        });
      }
      for (const pt of walkForward(logs, { position: "AM" }).slice(5)) {
        const st = pt.stats.xG!;
        zs.push(Math.abs(st.actual - st.predicted) / st.sd);
      }
    }
    const meanZ = zs.reduce((a, b) => a + b, 0) / zs.length;
    expect(meanZ).toBeGreaterThan(0.6);
    expect(meanZ).toBeLessThan(1.0);
  });
});

import { fitRatingModel, forecastRating, RatingRow } from "./lib/ratingModel";

describe("modelo de nota", () => {
  test("aprende de todos los jugadores los efectos de rival, casa y minutos", () => {
    const r = rng(3);
    const g = () => Math.sqrt(-2 * Math.log(r())) * Math.cos(2 * Math.PI * r());
    const TRUE = { home: 0.12, strengthDiff: 0.5, shortMinutes: -0.3 };
    const rows: RatingRow[] = [];
    const byPlayer = new Map<string, RatingRow[]>();
    for (let p = 0; p < 40; p++) {
      const level = 6.9 + 0.4 * g();
      const own = 0.3 * g();
      const list: RatingRow[] = [];
      for (let k = 0; k < 15; k++) {
        const isAway = r() < 0.5;
        const opp = 0.35 * g();
        const minutes = r() < 0.15 ? 25 : 90;
        const rating =
          level + TRUE.home * (isAway ? 0 : 1) + TRUE.strengthDiff * (own - opp) + TRUE.shortMinutes * (minutes < 45 ? 1 : 0) + 0.6 * g();
        list.push({ playerId: `p${p}`, rating: +rating.toFixed(1), isAway, minutes, ownStrength: own, opponentStrength: opp, order: k, total: 15 });
      }
      rows.push(...list);
      byPlayer.set(`p${p}`, list);
    }
    const fit = fitRatingModel(rows);
    expect(fit.beta.strengthDiff).toBeGreaterThan(0.3);
    expect(fit.beta.strengthDiff).toBeLessThan(0.7);
    expect(fit.beta.shortMinutes).toBeLessThan(-0.1);
    expect(fit.sigma).toBeGreaterThan(0.5);
    expect(fit.sigma).toBeLessThan(0.75);
    let em = 0;
    let en = 0;
    byPlayer.forEach((h) => {
      for (let i = 3; i < h.length; i++) {
        const fc = forecastRating(fit, h.slice(0, i), h[i]);
        const naive = h.slice(0, i).reduce((a, x) => a + x.rating, 0) / i;
        em += Math.abs(h[i].rating - fc.mean);
        en += Math.abs(h[i].rating - naive);
      }
    });
    expect(em).toBeLessThan(en);
  });
});

describe("Convex: próximo partido y nota esperada", () => {
  test("programar partido, verlo como próximo y nota según el rival", async () => {
    const t = convexTest(schema, modules);
    await t.action(api.legacy.importLegacyData, {});
    const teams = await t.run((ctx) => ctx.db.query("teams").collect());
    const arsenal = teams.find((x) => x.name === "Arsenal")!;
    const rated = teams.filter((x) => x.league === "premier" && x._id !== arsenal._id && x.attackRating);
    const strengthOf = (x: any) => Math.log(x.attackRating) - Math.log(x.defenseRating);
    const strongest = rated.reduce((a, b) => (strengthOf(b) > strengthOf(a) ? b : a));
    const weakest = rated.reduce((a, b) => (strengthOf(b) < strengthOf(a) ? b : a));

    const playerId = await t.mutation(api.players.createPlayer, { teamId: arsenal._id, name: "Ocho", position: "MF" });
    for (let k = 0; k < 4; k++) {
      await t.mutation(api.predictions.recordMatchAndCalibrate, {
        playerId, matchDate: `2026-07-0${k + 1}`, opponent: weakest.name, opponentTeamId: weakest._id,
        isAway: k % 2 === 1, minutesPlayed: 90, rawStats: { totalShots: 1, rating: 7.2 + 0.1 * k },
      });
    }
    const params = await t.run((ctx) => ctx.db.query("modelParams").collect());
    expect(params[0].params.matches).toBe(4);

    await t.mutation(api.teams.scheduleMatch, {
      teamId: arsenal._id, opponentTeamId: strongest._id, isHome: false, date: "2099-01-10",
    });
    const upcoming = await t.query(api.teams.upcomingMatches, { teamId: arsenal._id, fromDate: "2099-01-01" });
    expect(upcoming.length).toBe(1);
    expect(upcoming[0].opponentId).toBe(strongest._id);
    expect(upcoming[0].isHome).toBe(false);

    const vsStrongAway = await t.query(api.predictions.previewForecast, { playerId, opponentTeamId: strongest._id, isAway: true });
    const vsWeakHome = await t.query(api.predictions.previewForecast, { playerId, opponentTeamId: weakest._id, isAway: false });
    const neutral = await t.query(api.predictions.previewForecast, { playerId, isAway: false });
    expect(vsStrongAway!.rating.mean).toBeLessThan(vsWeakHome!.rating.mean);
    expect(vsWeakHome!.rating.low).toBeLessThan(vsWeakHome!.rating.mean);
    expect(vsStrongAway!.rating.contributions.some((c) => c.feature === "strengthDiff")).toBe(true);
    expect(neutral!.rating.ownMatches).toBe(4);
    expect(vsStrongAway!.opponent).toBe(strongest.name);

    const report = await t.query(api.predictions.getModelReport, { playerId });
    const last = report!.points[report!.points.length - 1] as any;
    expect(last.stats.rating.actual).toBeCloseTo(7.5, 5);
    expect(last.stats.rating.predicted).toBeGreaterThan(6);
  }, 180_000);
});

describe("temporadas", () => {
  test("seasonOf usa julio como inicio", () => {
    expect(seasonOf("2026-11-05")).toBe("2026-27");
    expect(seasonOf("2026-06-30")).toBe("2025-26");
    expect(seasonOf("2026-07-01")).toBe("2026-27");
  });

  test("la tabla solo cuenta la temporada actual; la fuerza usa todo", async () => {
    const t = convexTest(schema, modules);
    await t.action(api.legacy.importLegacyData, {});
    const before = await t.run((ctx) => ctx.db.query("teams").collect());
    const arsenal = before.find((x) => x.name === "Arsenal")!;
    const chelsea = before.find((x) => x.name === "Chelsea")!;
    expect(arsenal.rank).toBeUndefined();
    expect(arsenal.lastSeason!.rank).toBeGreaterThan(0);
    await t.mutation(api.teams.addMatchResult, {
      homeTeamId: arsenal._id, awayTeamId: chelsea._id, homeGoals: 2, awayGoals: 0, date: inSeason("10-01"),
    });
    const a = (await t.run((ctx) => ctx.db.get(arsenal._id)))!;
    expect(a.played).toBe(1);
    expect(a.points).toBe(3);
    expect(a.rank).toBe(1);
    expect(a.season).toBe(currentSeason());
    expect(a.lastSeason!.played).toBeGreaterThan(30); // no se mezcla
    // La fuerza sigue entrenada con todo el histórico (+ el partido nuevo)
    expect(Math.abs(a.attackRating! - arsenal.attackRating!)).toBeLessThan(0.15);
    const status = await t.query(api.legacy.seasonStatus, {});
    expect(status.staleLeagues).toEqual([]);
  }, 120_000);
});
