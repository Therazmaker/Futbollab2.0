/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { test, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/!(*.*.*)*.*s");
test("el Radar aguanta 60 partidos con plantillas grandes (límites de Convex)", async () => {
  const t = convexTest(schema, modules);
  const teams: any[] = [];
  await t.run(async (c) => {
    for (let i = 0; i < 100; i++) {
      const id = await c.db.insert("teams", { name: `T${i}`, league: "premier", attackRating: 1, defenseRating: 1 });
      teams.push(id);
      for (let j = 0; j < 25; j++) await c.db.insert("players", { teamId: id, name: `P${i}_${j}`, position: "MF" });
    }
    for (let k = 0; k < 60; k++) await c.db.insert("matches", { league: "premier", date: "2026-11-10", homeTeamId: teams[2 * (k % 50)], awayTeamId: teams[2 * (k % 50) + 1], odds: { home: 2, draw: 3.4, away: 3.8 } });
  });
  const inj = await t.mutation(api.players.createPlayer, { teamId: teams[0], name: "Lesionado", position: "FW" });
  await t.mutation(api.players.reportInjury, { playerId: inj, startDate: "2026-11-01" });
  const t0 = Date.now();
  const r = await t.query(api.radar.getRadar, { fromDate: "2026-11-10", toDate: "2026-11-10" });
  expect(r).toHaveLength(60);
  expect(Date.now() - t0).toBeLessThan(3000); // antes: ~4,8 s → Convex cortaba la consulta
  expect(r.find((m) => m.home.name === "T0")!.flags.some((f) => f.code === "BAJAS_LOCAL")).toBe(true);
});
