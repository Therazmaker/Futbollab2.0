/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { buildSeasonStory, eloProbs, runElo, xPoints, type StoryMatchIn } from "./lib/seasonStory";
import { parseFootballDataCsv } from "./lib/footballData";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");

const m = (id: string, date: string, h: string, a: string, hg: number, ag: number, extra: Partial<StoryMatchIn> = {}): StoryMatchIn => ({
  _id: id,
  date,
  league: "laliga",
  homeTeamId: h,
  awayTeamId: a,
  homeGoals: hg,
  awayGoals: ag,
  ...extra,
});
const extras = (names: Record<string, string> = {}) => ({ names: new Map(Object.entries(names)), otherComps: [], narratives: new Map(), absences: new Map() });

describe("anatomía de la temporada: piezas", () => {
  test("xPts: dominar en xG vale casi 3 puntos; igualdad ~1,3", () => {
    expect(xPoints(3, 0.3)).toBeGreaterThan(2.6);
    expect(xPoints(0.3, 3)).toBeLessThan(0.2);
    const even = xPoints(1.3, 1.3);
    expect(even).toBeGreaterThan(1.2);
    expect(even).toBeLessThan(1.45);
  });

  test("Elo: ganar sube, perder baja, y suma cero", () => {
    const { rating } = runElo([m("1", "2025-08-20", "A", "B", 2, 0), m("2", "2025-08-27", "B", "C", 1, 1)]);
    expect(rating.get("A")!).toBeGreaterThan(1500);
    expect(rating.get("B")!).toBeLessThan(1500);
    const total = Array.from(rating.values()).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(4500, 6);
  });

  test("1X2 por Elo suma 1 y favorece al más fuerte", () => {
    const p = eloProbs(1700, 1400);
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 6);
    expect(p.home).toBeGreaterThan(0.6);
  });

  test("real − esperado = rendimiento + suerte, y perder con un grande cuesta menos", () => {
    // B es muy fuerte (le gana a todos la temporada anterior), C muy débil
    const prev: StoryMatchIn[] = [];
    let k = 0;
    for (let i = 0; i < 6; i++) {
      prev.push(m(`p${k++}`, `2024-09-${String(i + 1).padStart(2, "0")}`, "B", "C", 4, 0));
      prev.push(m(`p${k++}`, `2024-10-${String(i + 1).padStart(2, "0")}`, "B", "D", 3, 0));
      prev.push(m(`p${k++}`, `2024-11-${String(i + 1).padStart(2, "0")}`, "D", "C", 2, 0));
    }
    const stats = (hxg: number, axg: number) => ({ hs: 10, as: 10, hst: 4, ast: 4, hxg, axg });
    const season = [
      // A pierde en casa del grande B: esperado bajo (sin cuotas → Elo)
      m("s1", "2025-08-20", "B", "A", 1, 0, { stats: stats(1.5, 0.8) }),
      // A pierde en casa con el débil C teniendo 2,5 xG contra 0,4: mala suerte
      m("s2", "2025-08-27", "A", "C", 0, 1, { stats: stats(2.5, 0.4), closingOdds: { home: 1.4, draw: 4.8, away: 8 }, halfTime: { home: 0, away: 0 } }),
      m("s3", "2025-09-03", "A", "D", 2, 1, { stats: stats(1.2, 1.1), halfTime: { home: 0, away: 1 }, cards: { hy: 1, ay: 2, hr: 0, ar: 1 } }),
      m("s4", "2025-09-03", "B", "C", 3, 0),
    ];
    const s = buildSeasonStory("A", "2025-26", [...prev, ...season], extras({ A: "Equipo A", B: "Grande", C: "Colista", D: "Medio" }));
    expect(s.played).toBe(3);
    expect(s.points).toBe(3);
    const [g1, g2, g3] = s.matches;
    expect(g1.tier).toBe("big");
    expect(g2.tier).toBe("weak");
    expect(g2.expectedSource).toBe("mercado");
    // Perder con el débil en casa cuesta mucho más que perder con el grande fuera
    expect(g2.expected - g2.points).toBeGreaterThan(1.8);
    expect(g1.expected - g1.points).toBeLessThan(1);
    for (const x of s.matches) expect(x.performance! + x.luck!).toBeCloseTo(x.points - x.expected, 6);
    expect(g2.causes.map((c) => c.key)).toContain("wasteful");
    expect(g2.causes.map((c) => c.key)).not.toContain("collapse"); // 0-0 al descanso no es "se dejó remontar"
    expect(g3.causes.map((c) => c.key)).toEqual(expect.arrayContaining(["comeback", "oppRed"]));
    expect(s.performance! + s.luck!).toBeCloseTo(s.points - s.expected, 6);
    expect(s.summary[0]).toContain("Equipo A suma 3 pts en 3 partidos");
    expect(s.keyMatches[0]).toContain("Colista");
    const weak = s.causes.find((c) => c.key === "vsWeak")!;
    expect(weak.matchIds).toEqual(["s2"]);
  });

  test("las tarjetas se leen del CSV de football-data", () => {
    const csv = [
      "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,HTHG,HTAG,HS,AS,HST,AST,HY,AY,HR,AR",
      "SP1,16/08/2026,Sevilla,Alaves,1,0,0,0,12,8,5,2,3,4,0,1",
    ].join("\n");
    const { rows } = parseFootballDataCsv(csv, "SP1", "2627");
    expect(rows).toHaveLength(1);
    expect(rows[0].cards).toEqual({ hy: 3, ay: 4, hr: 0, ar: 1 });
  });
});

describe("anatomía de la temporada: consulta", () => {
  test("arma la historia con cuotas, narración y bajas", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (c) => {
      const mk = (name: string) => c.db.insert("teams", { name, league: "laliga", attackRating: 1, defenseRating: 1 });
      const a = await mk("Equipo A");
      const b = await mk("Equipo B");
      const cc = await mk("Equipo C");
      const star = await c.db.insert("players", { teamId: a, name: "Estrella", position: "FW", seasonStats: { minutes: 2500 } });
      await c.db.insert("injuries", { playerId: star, startDate: "2026-08-01", expectedReturn: "2026-09-15" });
      const m1 = await c.db.insert("matches", {
        league: "laliga", date: "2026-08-20", homeTeamId: a, awayTeamId: b, homeGoals: 0, awayGoals: 2,
        stats: { hs: 15, as: 6, hst: 6, ast: 2, hxg: 2.1, axg: 0.6 }, closingOdds: { home: 1.8, draw: 3.6, away: 4.5 }, halfTime: { home: 0, away: 0 },
      });
      await c.db.insert("matches", { league: "laliga", date: "2026-08-27", homeTeamId: cc, awayTeamId: a, homeGoals: 1, awayGoals: 3 });
      await c.db.insert("matches", { league: "ucl", date: "2026-08-24", homeTeamId: a, awayTeamId: b, homeGoals: 1, awayGoals: 1 });
      await c.db.insert("matchNarratives", {
        matchId: m1, text: "x", provider: "gemini", model: "x", createdAt: 1,
        analysis: { summary: "A lo intentó todo", events: [{ minute: 30, team: "home", type: "red_card", player: "Z", note: "" }], players: [] },
      });
      return { a, m1 };
    });
    const r: any = await t.query(api.story.getSeasonStory, { teamId: ids.a as Id<"teams">, season: "2026-27" });
    expect(r.available).toBe(true);
    const s = r.story;
    expect(s.played).toBe(2);
    expect(s.points).toBe(3);
    const first = s.matches[0];
    expect(first.expectedSource).toBe("mercado");
    expect(first.absences).toEqual(["Estrella"]);
    expect(first.narrative).toBe("A lo intentó todo");
    expect(first.causes.map((c: any) => c.key)).toEqual(expect.arrayContaining(["ownRed", "absences", "wasteful"]));
    // Jugó Champions 3 días antes del segundo partido de liga
    expect(s.matches[1].causes.map((c: any) => c.key)).toContain("tired");
    expect(s.matches[1].expectedSource).toBe("elo");
    expect(s.matches[1].absences).toEqual(["Estrella"]);
  });
});
