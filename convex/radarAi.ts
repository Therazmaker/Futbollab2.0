import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { analyzeStoredMatch, newRadarContext } from "./lib/radarMatch";
import { evaluatePick, isValidPick, marketProbOfPick, pickLabel, probOfPick, ProbSource } from "./lib/picks";
import { normalizePreview, compareWithData, PREVIEW_SIGNAL_TESTS } from "./lib/preview";
import { HistoryRow, summarizeHistory } from "./lib/pickHistory";
import { computeTeamTrends } from "./lib/teamTrends";
import { fairProbabilities } from "./lib/markets";
import { wilson } from "./lib/radarTraining";

const scored = (m: Doc<"matches">) => m.homeGoals !== undefined && m.awayGoals !== undefined;

// ---------- Análisis previo ("Radar Analysis Editor") ----------

export const getPreview = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const p = await ctx.db
      .query("matchPreviews")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .unique();
    if (!p) return null;
    const m = await ctx.db.get(matchId);
    let comparison = null;
    if (m) {
      const a = await analyzeStoredMatch(ctx.db, m, await newRadarContext(ctx.db));
      if (a) comparison = compareWithData(normalizePreview(p.analysis), a.markets.probabilities);
    }
    return { ...p, comparison };
  },
});

export const savePreview = mutation({
  args: { matchId: v.id("matches"), text: v.string(), provider: v.string(), model: v.string(), analysis: v.any() },
  handler: async (ctx, args) => {
    const m = await ctx.db.get(args.matchId);
    if (!m) throw new Error("Partido no encontrado");
    if (scored(m)) throw new Error("El partido ya tiene marcador: la previa tiene que guardarse antes de jugarse.");
    const analysis = normalizePreview(args.analysis);
    const row = { text: args.text.slice(0, 100_000), provider: args.provider, model: args.model, analysis, createdAt: Date.now() };
    const ex = await ctx.db
      .query("matchPreviews")
      .withIndex("by_match", (q) => q.eq("matchId", args.matchId))
      .unique();
    if (ex) await ctx.db.patch(ex._id, row);
    else await ctx.db.insert("matchPreviews", { matchId: args.matchId, ...row });
    return analysis;
  },
});

export const deletePreview = mutation({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const ex = await ctx.db
      .query("matchPreviews")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .unique();
    if (ex) await ctx.db.delete(ex._id);
  },
});

// ---------- Predicciones (IA y "Mi pronóstico") ----------

function probSourceOf(a: NonNullable<Awaited<ReturnType<typeof analyzeStoredMatch>>>): ProbSource {
  const mk = a.markets;
  return {
    ...mk.probabilities,
    over15: mk.over15,
    over25: mk.over25,
    btts: mk.btts,
    homeCleanSheet: mk.homeCleanSheet,
    awayCleanSheet: mk.awayCleanSheet,
    htHome: mk.halfTime.home,
    htDraw: mk.halfTime.draw,
    htAway: mk.halfTime.away,
    htGoalless: mk.halfTime.goalless,
  };
}

export const getPicks = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const m = await ctx.db.get(matchId);
    if (!m) return [];
    const [home, away] = [await ctx.db.get(m.homeTeamId), await ctx.db.get(m.awayTeamId)];
    const picks = await ctx.db
      .query("radarPicks")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
    return picks.map((p) => ({
      ...p,
      label: pickLabel(p.market, p.pick, home?.name, away?.name),
      verdict: evaluatePick(p.market, p.pick, m),
    }));
  },
});

export const savePicks = mutation({
  args: {
    matchId: v.id("matches"),
    source: v.union(v.literal("ai"), v.literal("user")),
    model: v.optional(v.string()),
    picks: v.array(
      v.object({
        market: v.string(),
        pick: v.string(),
        confidence: v.optional(v.number()),
        reasoning: v.optional(v.string()),
        odds: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, { matchId, source, picks, model }) => {
    const m = await ctx.db.get(matchId);
    if (!m) throw new Error("Partido no encontrado");
    if (scored(m)) throw new Error("El partido ya tiene marcador: las predicciones se guardan antes de jugarse.");
    for (const p of picks) {
      if (!isValidPick(p.market, p.pick)) throw new Error(`Pick no válido: ${p.market} ${p.pick}`);
      if (p.odds !== undefined && !(p.odds > 1)) throw new Error("Las cuotas deben ser mayores que 1");
    }
    const a = await analyzeStoredMatch(ctx.db, m, await newRadarContext(ctx.db));
    const probs = a ? probSourceOf(a) : null;
    const fair = a?.fair ?? null;
    // Se reemplazan las predicciones anteriores de esa fuente para el partido
    const old = await ctx.db
      .query("radarPicks")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
    for (const o of old) if (o.source === source) await ctx.db.delete(o._id);
    const now = Date.now();
    for (const p of picks) {
      const defaultOdds = p.market === "result" && m.odds ? m.odds[p.pick as "home" | "draw" | "away"] : undefined;
      const sp = probs ? probOfPick(probs, p.market, p.pick) : null;
      const mp = marketProbOfPick(fair, p.market, p.pick);
      await ctx.db.insert("radarPicks", {
        matchId,
        matchDate: m.date,
        competition: m.league,
        source,
        market: p.market,
        pick: p.pick,
        confidence: p.confidence,
        reasoning: p.reasoning,
        odds: p.odds ?? defaultOdds,
        systemProb: sp === null ? undefined : +sp.toFixed(3),
        marketProb: mp === null ? undefined : +mp.toFixed(3),
        model,
        createdAt: now,
      });
    }
    return picks.length;
  },
});

export const deletePicks = mutation({
  args: { matchId: v.id("matches"), source: v.union(v.literal("ai"), v.literal("user")) },
  handler: async (ctx, { matchId, source }) => {
    const m = await ctx.db.get(matchId);
    if (m && scored(m)) throw new Error("El partido ya se jugó: sus predicciones quedan en el histórico.");
    const rows = await ctx.db
      .query("radarPicks")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
    for (const r of rows) if (r.source === source) await ctx.db.delete(r._id);
  },
});

/** Todo lo que la IA necesita para predecir un partido (lo usa /api/radar-ai). */
export const aiContext = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const m = await ctx.db.get(matchId);
    if (!m) return null;
    const a = await analyzeStoredMatch(ctx.db, m, await newRadarContext(ctx.db));
    if (!a) return null;
    const preview = await ctx.db
      .query("matchPreviews")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .unique();
    const [th, ta] = await Promise.all([
      computeTeamTrends(ctx.db, m.homeTeamId as Id<"teams">, m.date),
      computeTeamTrends(ctx.db, m.awayTeamId as Id<"teams">, m.date),
    ]);
    const pa = preview ? normalizePreview(preview.analysis) : null;
    return {
      scored: scored(m),
      home: a.home.name,
      away: a.away.name,
      date: m.date,
      competition: m.league,
      probs: probSourceOf(a) as unknown as Record<string, number>,
      modelProbs: a.modelProbabilities,
      fair: a.fair ? { home: a.fair.home, draw: a.fair.draw, away: a.fair.away } : null,
      odds: m.odds ?? null,
      expectedGoals: a.markets.expectedGoals,
      reading: [a.reading.headline, ...a.reading.lines],
      absences: { home: a.players.home.absent.map((x) => x.name), away: a.players.away.absent.map((x) => x.name) },
      preview: pa ? { summary: pa.summary, signals: pa.signals as unknown as Record<string, string>, structured: pa.structured as unknown as Record<string, string> } : null,
      trends: {
        home: th.trends.matches ? th.trends.insights : [],
        away: ta.trends.matches ? ta.trends.insights : [],
      },
    };
  },
});

// ---------- Histórico del Radar ----------

export const getHistory = query({
  args: { competition: v.optional(v.string()), source: v.optional(v.string()) },
  handler: async (ctx, { competition, source }) => {
    const picks = await ctx.db.query("radarPicks").collect();
    const matchCache = new Map<string, Doc<"matches"> | null>();
    const teamCache = new Map<string, string>();
    const match = async (id: Id<"matches">) => {
      if (!matchCache.has(id)) matchCache.set(id, await ctx.db.get(id));
      return matchCache.get(id)!;
    };
    const name = async (id: Id<"teams">) => {
      if (!teamCache.has(id)) teamCache.set(id, (await ctx.db.get(id))?.name ?? "?");
      return teamCache.get(id)!;
    };
    const rows: HistoryRow[] = [];
    for (const p of picks) {
      if (competition && competition !== "all" && p.competition !== competition) continue;
      if (source && source !== "all" && p.source !== source) continue;
      const m = await match(p.matchId);
      if (!m) continue;
      const [home, away] = [await name(m.homeTeamId), await name(m.awayTeamId)];
      const close = m.closingOdds ? fairProbabilities(m.closingOdds) : null;
      const cp = marketProbOfPick(close, p.market, p.pick);
      rows.push({
        id: p._id,
        matchId: p.matchId,
        date: m.date,
        competition: m.league,
        home,
        away,
        source: p.source as "ai" | "user",
        market: p.market,
        pick: p.pick,
        label: pickLabel(p.market, p.pick, home, away),
        confidence: p.confidence ?? null,
        odds: p.odds ?? null,
        systemProb: p.systemProb ?? null,
        marketProb: p.marketProb ?? null,
        closingProb: cp,
        verdict: evaluatePick(p.market, p.pick, m),
        score: scored(m) ? `${m.homeGoals}-${m.awayGoals}${m.halfTime ? ` (${m.halfTime.home}-${m.halfTime.away})` : ""}` : null,
      });
    }
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));

    // Poder predictivo de las señales de la previa (como el panel viejo, con intervalos)
    const previews = await ctx.db.query("matchPreviews").collect();
    const sig = PREVIEW_SIGNAL_TESTS.map((t) => ({ key: t.key, label: t.label, act: { n: 0, hits: 0, exp: 0, nExp: 0 }, rest: { n: 0, hits: 0 } }));
    for (const pv of previews) {
      const m = await match(pv.matchId);
      if (!m || !scored(m)) continue;
      if (competition && competition !== "all" && m.league !== competition) continue;
      const a = normalizePreview(pv.analysis);
      const fair = m.odds ? fairProbabilities(m.odds) : null;
      const hg = m.homeGoals!, ag = m.awayGoals!;
      const outcome = hg > ag ? "home" : hg === ag ? "draw" : "away";
      PREVIEW_SIGNAL_TESTS.forEach((t, i) => {
        let hit: boolean | null = null;
        let exp: number | null = null;
        if (t.event === "draw") { hit = outcome === "draw"; exp = fair?.draw ?? null; }
        else if (t.event === "home") { hit = outcome === "home"; exp = fair?.home ?? null; }
        else if (t.event === "away") { hit = outcome === "away"; exp = fair?.away ?? null; }
        else if (t.event === "over25") { hit = hg + ag > 2; }
        else if (t.event === "underdog_not_lose" && fair) {
          const dog = fair.home < fair.away ? "home" : "away";
          hit = outcome !== (dog === "home" ? "away" : "home");
          exp = fair[dog] + fair.draw;
        }
        if (hit === null) return;
        const g = t.active(a) ? sig[i].act : sig[i].rest;
        g.n++;
        if (hit) g.hits++;
        if (g === sig[i].act && exp !== null) { sig[i].act.exp += exp; sig[i].act.nExp++; }
      });
    }
    const previewSignals = sig
      .filter((s) => s.act.n + s.rest.n > 0)
      .map((s) => ({
        key: s.key,
        label: s.label,
        nActive: s.act.n,
        rateActive: s.act.n ? s.act.hits / s.act.n : null,
        ciActive: wilson(s.act.hits, s.act.n),
        marketActive: s.act.nExp ? s.act.exp / s.act.nExp : null,
        nRest: s.rest.n,
        rateRest: s.rest.n ? s.rest.hits / s.rest.n : null,
      }));

    return { rows: rows.slice(0, 300), summary: summarizeHistory(rows), previewSignals, previews: previews.length };
  },
});
