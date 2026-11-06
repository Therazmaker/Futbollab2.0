/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { normalizeAnalysis, roleFor, teamTrends, TrendRow } from "./lib/narrative";

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
