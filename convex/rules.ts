import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  computeFeatures, Condition, fairOf, matchesConditions, targetOutcome, teamGame, TeamGame, TARGETS, validateRule, verdictOf,
} from "./lib/features";
import { backtestRules, M } from "./lib/ruleBacktest";
import { normalizeName } from "./lib/teamMatches";

const condV = v.object({ feature: v.string(), op: v.string(), value: v.number() });

export const listRules = query({
  args: {},
  handler: async (ctx) => {
    const rules = await ctx.db.query("radarRules").collect();
    const out = [];
    for (const r of rules.sort((a, b) => b.createdAt - a.createdAt)) {
      const team = r.teamId ? await ctx.db.get(r.teamId) : null;
      out.push({ ...r, teamName: team?.name ?? null, targetLabel: (TARGETS as Record<string, string>)[r.target] ?? r.target });
    }
    return out;
  },
});

export const resolveTeam = query({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const key = normalizeName(name);
    if (!key) return null;
    const all = await ctx.db.query("teams").collect();
    const exact = all.filter((t) => normalizeName(t.name) === key);
    const pick = exact.length === 1 ? exact : all.filter((t) => { const n = normalizeName(t.name); return n.startsWith(key + " ") || key.startsWith(n + " ") || n.endsWith(" " + key); });
    return pick.length === 1 ? { _id: pick[0]._id, name: pick[0].name } : null;
  },
});

export const saveRule = mutation({
  args: {
    ruleId: v.optional(v.id("radarRules")),
    name: v.string(),
    text: v.string(),
    teamId: v.optional(v.id("teams")),
    conditions: v.array(condV),
    target: v.string(),
    manualChecks: v.array(v.string()),
    originMatchId: v.optional(v.id("matches")),
  },
  handler: async (ctx, a) => {
    const errors = validateRule({ conditions: a.conditions as Condition[], target: a.target, teamScoped: !!a.teamId });
    if (!a.conditions.length && !a.manualChecks.length) errors.push("La regla necesita al menos una condición o algo que revisar a mano.");
    if (errors.length) throw new Error(errors.join(" "));
    const row = {
      name: a.name.trim().slice(0, 80) || "Regla",
      text: a.text.slice(0, 2000),
      teamId: a.teamId,
      conditions: a.conditions,
      target: a.target,
      manualChecks: a.manualChecks.map((x) => x.trim()).filter(Boolean).slice(0, 8),
      originMatchId: a.originMatchId,
    };
    if (a.ruleId) {
      await ctx.db.patch(a.ruleId, { ...row, backtest: undefined });
      return a.ruleId;
    }
    return await ctx.db.insert("radarRules", { ...row, active: true, createdAt: Date.now() });
  },
});

export const setActive = mutation({
  args: { ruleId: v.id("radarRules"), active: v.boolean() },
  handler: async (ctx, { ruleId, active }) => ctx.db.patch(ruleId, { active }),
});

export const deleteRule = mutation({
  args: { ruleId: v.id("radarRules") },
  handler: async (ctx, { ruleId }) => ctx.db.delete(ruleId),
});

// ---------- Prueba en el histórico ----------

export const matchesPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("matches").withIndex("by_date").paginate({ cursor, numItems: 1500 });
    return {
      done: page.isDone,
      cursor: page.continueCursor,
      rows: page.page.map((m) => ({
        _id: m._id, date: m.date, league: m.league, homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId,
        homeGoals: m.homeGoals, awayGoals: m.awayGoals, stats: m.stats, odds: m.odds, closingOdds: m.closingOdds,
      })),
    };
  },
});

export const setBacktest = internalMutation({
  args: { ruleId: v.id("radarRules"), backtest: v.any() },
  handler: async (ctx, { ruleId, backtest }) => {
    if (await ctx.db.get(ruleId)) await ctx.db.patch(ruleId, { backtest });
  },
});

export const getRule = internalQuery({
  args: { ruleId: v.id("radarRules") },
  handler: async (ctx, { ruleId }) => ctx.db.get(ruleId),
});

export const activeRules = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("radarRules").collect()).filter((r) => r.active),
});

async function loadAll(ctx: any): Promise<M[]> {
  const all: M[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { done: boolean; cursor: string; rows: M[] } = await ctx.runQuery(internal.rules.matchesPage, { cursor });
    all.push(...page.rows);
    if (page.done) break;
    cursor = page.cursor;
  }
  return all;
}

/** Prueba una regla (o todas las activas) en todo el histórico y guarda el resultado. */
export const runBacktest = action({
  args: { ruleId: v.optional(v.id("radarRules")) },
  handler: async (ctx, { ruleId }) => backtestAndSave(ctx, ruleId),
});

/** Lo mismo, tras cada actualización automática (para el "desde que la creaste"). */
export const runBacktestInternal = internalAction({
  args: {},
  handler: async (ctx) => backtestAndSave(ctx),
});

async function backtestAndSave(ctx: any, ruleId?: Id<"radarRules">) {
  {
    const rules = ruleId ? [await ctx.runQuery(internal.rules.getRule, { ruleId })].filter(Boolean) : await ctx.runQuery(internal.rules.activeRules, {});
    if (!rules.length) return [];
    const res = backtestRules(await loadAll(ctx), rules as any);
    for (const [i, r] of (rules as any[]).entries()) await ctx.runMutation(internal.rules.setBacktest, { ruleId: r._id, backtest: res[i] });
    return res;
  }
}

/** Las reglas de las que hablamos (probadas en el chat con 5.700 partidos), para empezar. */
export const seedStarterRules = mutation({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.db.query("radarRules").first()) !== null) return 0;
    const now = Date.now();
    const rows = [
      { name: "Underdog que empata mucho", text: "El no favorito empata mucho (4 o más de sus últimos 10) → empate", conditions: [{ feature: "dog_draws10", op: ">=", value: 4 }], target: "draw", manualChecks: [] },
      { name: "Favorito que recibe mucho", text: "El favorito recibe 1,5 o más por partido → no gana", conditions: [{ feature: "fav_prob", op: ">=", value: 0.5 }, { feature: "fav_ga10", op: ">=", value: 1.5 }], target: "fav_not_win", manualChecks: [] },
      { name: "Favorito aplastante vs coladero", text: "Favorito de 70 % o más contra un rival que recibe 2 o más por partido → gana el favorito (el PSG–Troyes)", conditions: [{ feature: "fav_prob", op: ">=", value: 0.7 }, { feature: "dog_ga10", op: ">=", value: 2 }], target: "fav_win", manualChecks: ["¿Rota el favorito? (si juega con suplentes, cuidado)"] },
      { name: "Underdog con línea creciendo", text: "El no favorito viene mejorando en xG en sus últimos 3 → el favorito no gana", conditions: [{ feature: "dog_trend3", op: ">=", value: 0.8 }], target: "fav_not_win", manualChecks: [] },
      { name: "Favorito cansado (Champions)", text: "El favorito jugó Champions u otra copa en los 4 días previos → no gana", conditions: [{ feature: "fav_midweek", op: "=", value: 1 }], target: "fav_not_win", manualChecks: ["¿Rota el favorito?"] },
    ];
    for (const r of rows) await ctx.db.insert("radarRules", { ...r, active: true, createdAt: now });
    return rows.length;
  },
});

// ---------- Reglas que cumple cada partido del Radar ----------

export const ruleHits = query({
  args: { fromDate: v.string(), toDate: v.string() },
  handler: async (ctx, { fromDate, toDate }) => {
    const rules = (await ctx.db.query("radarRules").collect()).filter((r) => r.active);
    if (!rules.length) return {};
    const matches = (await ctx.db.query("matches").withIndex("by_date", (q) => q.gte("date", fromDate).lte("date", toDate)).collect()).slice(0, 120);
    const cache = new Map<string, TeamGame[]>();
    const history = async (teamId: Id<"teams">, before: string) => {
      const key = `${teamId}|${before}`;
      if (cache.has(key)) return cache.get(key)!;
      const [h, a] = await Promise.all([
        ctx.db.query("matches").withIndex("by_home_and_date", (q) => q.eq("homeTeamId", teamId).lt("date", before)).order("desc").take(12),
        ctx.db.query("matches").withIndex("by_away_and_date", (q) => q.eq("awayTeamId", teamId).lt("date", before)).order("desc").take(12),
      ]);
      const games = [...h.map((m) => teamGame(m, true)), ...a.map((m) => teamGame(m, false))]
        .filter((g): g is TeamGame => !!g)
        .sort((x, y) => (x.date < y.date ? -1 : 1))
        .slice(-12);
      cache.set(key, games);
      return games;
    };
    const out: Record<string, Array<{ ruleId: string; name: string; targetLabel: string; verdict: string | null; rate: number | null; market: number | null; n: number; manualChecks: string[]; conditionsMet: boolean }>> = {};
    for (const m of matches) {
      const fair = fairOf(m.odds ?? m.closingOdds);
      const [hh, ah] = [await history(m.homeTeamId, m.date), await history(m.awayTeamId, m.date)];
      for (const r of rules) {
        let side: "home" | "away" | undefined;
        if (r.teamId) {
          if (r.teamId === m.homeTeamId) side = "home";
          else if (r.teamId === m.awayTeamId) side = "away";
          else continue;
        }
        let met = r.conditions.length === 0;
        if (r.conditions.length) {
          if (!fair) continue;
          const f = computeFeatures(m.date, m.league, fair, hh, ah, side);
          met = !!f && matchesConditions(f, r.conditions as Condition[]);
        }
        if (!met) continue;
        const bt = r.backtest as any;
        (out[m._id] ??= []).push({
          ruleId: r._id, name: r.name, targetLabel: (TARGETS as Record<string, string>)[r.target] ?? r.target,
          verdict: bt?.verdict ?? null, rate: bt?.rate ?? null, market: bt?.market ?? null, n: bt?.n ?? 0,
          manualChecks: r.manualChecks, conditionsMet: true,
        });
      }
    }
    return out;
  },
});
