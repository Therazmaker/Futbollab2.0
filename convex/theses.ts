import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { analyzeStoredMatch, newRadarContext } from "./lib/radarMatch";
import { evaluatePick, isValidPick, marketProbOfPick, pickLabel, probOfPick } from "./lib/picks";
import { Condition, TARGETS, validateRule } from "./lib/features";

/**
 * "Mi tesis" (Radar Audaz): lo que ves en un partido y lo que crees que pasará,
 * escrito ANTES de jugarse. La IA lo convierte en tu pronóstico (se mide en el
 * Histórico), te da su opinión y lo generaliza en una regla del Detector (que
 * se prueba con el histórico y activas tú). Con varias tesis resueltas, la IA
 * propone reglas mejores combinando lo que se repite en tus aciertos.
 */

const condV = v.object({ feature: v.string(), op: v.string(), value: v.number() });

export const getTheses = query({
  args: { matchId: v.optional(v.id("matches")) },
  handler: async (ctx, { matchId }) => {
    const rows = matchId
      ? await ctx.db.query("radarTheses").withIndex("by_match", (q) => q.eq("matchId", matchId)).collect()
      : await ctx.db.query("radarTheses").collect();
    const out = [];
    for (const t of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      const m = await ctx.db.get(t.matchId);
      if (!m) continue;
      const [h, a] = [await ctx.db.get(m.homeTeamId), await ctx.db.get(m.awayTeamId)];
      const rule = t.ruleId ? await ctx.db.get(t.ruleId) : null;
      out.push({
        ...t,
        home: h?.name ?? "?",
        away: a?.name ?? "?",
        label: pickLabel(t.market, t.pick, h?.name, a?.name),
        verdict: evaluatePick(t.market, t.pick, m),
        score: m.homeGoals !== undefined ? `${m.homeGoals}-${m.awayGoals}` : null,
        rule: rule
          ? { _id: rule._id, name: rule.name, active: rule.active, conditions: rule.conditions, target: rule.target, targetLabel: (TARGETS as Record<string, string>)[rule.target] ?? rule.target, manualChecks: rule.manualChecks, backtest: rule.backtest ?? null }
          : null,
      });
    }
    return out;
  },
});

export const saveThesis = mutation({
  args: {
    matchId: v.id("matches"),
    text: v.string(),
    market: v.string(),
    pick: v.string(),
    confidence: v.optional(v.number()),
    reasons: v.array(v.string()),
    feedback: v.string(),
    model: v.string(),
    rule: v.optional(
      v.object({ name: v.string(), teamId: v.optional(v.id("teams")), conditions: v.array(condV), target: v.string(), manualChecks: v.array(v.string()) })
    ),
  },
  handler: async (ctx, a) => {
    const m = await ctx.db.get(a.matchId);
    if (!m) throw new Error("Partido no encontrado");
    if (m.homeGoals !== undefined) throw new Error("El partido ya tiene marcador: la tesis se escribe antes de jugarse.");
    if (!isValidPick(a.market, a.pick)) throw new Error(`Pronóstico no válido: ${a.market} ${a.pick}`);
    // Una tesis por partido: la nueva sustituye a la anterior (y a su regla propuesta si no la activaste)
    for (const old of await ctx.db.query("radarTheses").withIndex("by_match", (q) => q.eq("matchId", a.matchId)).collect()) {
      if (old.ruleId) {
        const r = await ctx.db.get(old.ruleId);
        if (r && !r.active) await ctx.db.delete(r._id);
      }
      await ctx.db.delete(old._id);
    }
    // Tu pronóstico (se mide en el Histórico): reemplaza el que tuvieras en ese mismo mercado
    const an = await analyzeStoredMatch(ctx.db, m, await newRadarContext(ctx.db));
    for (const p of await ctx.db.query("radarPicks").withIndex("by_match", (q) => q.eq("matchId", a.matchId)).collect()) {
      if (p.source === "user" && p.market === a.market) await ctx.db.delete(p._id);
    }
    const mk = an?.markets;
    const sp = mk
      ? probOfPick(
          { ...mk.probabilities, over15: mk.over15, over25: mk.over25, btts: mk.btts, homeCleanSheet: mk.homeCleanSheet, awayCleanSheet: mk.awayCleanSheet, htHome: mk.halfTime.home, htDraw: mk.halfTime.draw, htAway: mk.halfTime.away, htGoalless: mk.halfTime.goalless },
          a.market,
          a.pick
        )
      : null;
    const mp = marketProbOfPick(an?.fair ?? null, a.market, a.pick);
    await ctx.db.insert("radarPicks", {
      matchId: a.matchId,
      matchDate: m.date,
      competition: m.league,
      source: "user",
      market: a.market,
      pick: a.pick,
      confidence: a.confidence,
      reasoning: `Tesis: ${a.text.slice(0, 300)}`,
      odds: a.market === "result" && m.odds ? m.odds[a.pick as "home" | "draw" | "away"] : undefined,
      systemProb: sp === null ? undefined : +sp.toFixed(3),
      marketProb: mp === null ? undefined : +mp.toFixed(3),
      createdAt: Date.now(),
    });
    const thesisId = await ctx.db.insert("radarTheses", {
      matchId: a.matchId,
      matchDate: m.date,
      text: a.text.slice(0, 3000),
      market: a.market,
      pick: a.pick,
      confidence: a.confidence,
      reasons: a.reasons.slice(0, 8),
      feedback: a.feedback.slice(0, 1500),
      model: a.model,
      createdAt: Date.now(),
    });
    // Regla general propuesta (inactiva hasta que la actives)
    let ruleId: Id<"radarRules"> | null = null;
    if (a.rule && a.rule.conditions.length) {
      const errors = validateRule({ conditions: a.rule.conditions as Condition[], target: a.rule.target, teamScoped: !!a.rule.teamId });
      if (!errors.length) {
        ruleId = await ctx.db.insert("radarRules", {
          name: a.rule.name.slice(0, 80),
          text: a.text.slice(0, 2000),
          teamId: a.rule.teamId,
          conditions: a.rule.conditions,
          target: a.rule.target,
          manualChecks: a.rule.manualChecks.slice(0, 6),
          active: false,
          origin: "thesis",
          thesisId,
          originMatchId: a.matchId,
          createdAt: Date.now(),
        });
        await ctx.db.patch(thesisId, { ruleId });
      }
    }
    return { thesisId, ruleId };
  },
});

/** Tesis resueltas, para que la IA aprenda de ellas. */
export const thesesForLearning = query({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const t of await ctx.db.query("radarTheses").collect()) {
      const m = await ctx.db.get(t.matchId);
      if (!m) continue;
      const verdict = evaluatePick(t.market, t.pick, m);
      if (!verdict) continue;
      const [h, a] = [await ctx.db.get(m.homeTeamId), await ctx.db.get(m.awayTeamId)];
      out.push({
        match: `${h?.name} vs ${a?.name} (${m.date}, ${m.league}) → ${m.homeGoals}-${m.awayGoals}`,
        thesis: t.text,
        prediction: pickLabel(t.market, t.pick, h?.name, a?.name),
        reasons: t.reasons,
        verdict,
      });
    }
    return out;
  },
});

/** Reglas que propone la IA aprendiendo de tus tesis (inactivas: las activas tú tras ver su histórico). */
export const saveLearnedRules = mutation({
  args: {
    rules: v.array(v.object({ name: v.string(), text: v.string(), teamId: v.optional(v.id("teams")), conditions: v.array(condV), target: v.string(), manualChecks: v.array(v.string()) })),
  },
  handler: async (ctx, { rules }) => {
    const ids: Id<"radarRules">[] = [];
    for (const r of rules.slice(0, 5)) {
      if (!r.conditions.length) continue;
      if (validateRule({ conditions: r.conditions as Condition[], target: r.target, teamScoped: !!r.teamId }).length) continue;
      ids.push(
        await ctx.db.insert("radarRules", {
          name: r.name.slice(0, 80),
          text: r.text.slice(0, 2000),
          teamId: r.teamId,
          conditions: r.conditions,
          target: r.target,
          manualChecks: r.manualChecks.slice(0, 6),
          active: false,
          origin: "learned",
          createdAt: Date.now(),
        })
      );
    }
    return ids;
  },
});

export const deleteThesis = mutation({
  args: { thesisId: v.id("radarTheses") },
  handler: async (ctx, { thesisId }) => {
    const t = await ctx.db.get(thesisId);
    if (!t) return;
    const m: Doc<"matches"> | null = await ctx.db.get(t.matchId);
    if (m && m.homeGoals !== undefined) throw new Error("El partido ya se jugó: la tesis queda para aprender de ella.");
    if (t.ruleId) {
      const r = await ctx.db.get(t.ruleId);
      if (r && !r.active) await ctx.db.delete(r._id);
    }
    await ctx.db.delete(thesisId);
  },
});
