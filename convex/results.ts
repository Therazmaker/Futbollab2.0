import { mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { normalizeName, findTeamMatch } from "./lib/teamMatches";
import { activeIn } from "./lib/noLeague";
import { recomputeLeague } from "./lib/leagueTable";
import { refreshRatingModel } from "./lib/ratingStore";
import { ensureSnapshotBeforeScore, upsertSnapshot } from "./lib/radarSnapshot";

/**
 * Resultados en bloque: se pega una lista (una jornada, la temporada…) y entra
 * de golpe. Con `preview: true` solo dice qué equipos reconoce, sin guardar nada.
 * Los partidos que ya existen (mismo cruce y fecha) solo reciben el marcador.
 */
export const addResultsBulk = mutation({
  args: {
    competition: v.string(),
    preview: v.optional(v.boolean()),
    rows: v.array(
      v.object({
        date: v.string(),
        home: v.string(),
        away: v.string(),
        homeGoals: v.number(),
        awayGoals: v.number(),
      })
    ),
  },
  handler: async (ctx, { competition, preview, rows }) => {
    if (rows.length > 600) throw new Error("Máximo 600 partidos por vez.");
    const all = await ctx.db.query("teams").collect();
    const inComp = all.filter((t) => activeIn(t, competition) || t.league === competition);
    const resolve = (name: string): Doc<"teams"> | null => {
      const key = normalizeName(name);
      if (!key) return null;
      for (const pool of [inComp, all]) {
        const exact = pool.filter((t) => normalizeName(t.name) === key);
        if (exact.length === 1) return exact[0];
        const prefix = pool.filter((t) => {
          const n = normalizeName(t.name);
          // "Betis" → "Real Betis", "Atlético" → "Atlético de Madrid", "Real Madrid" → "Real Madrid CF"
          return n.startsWith(key + " ") || key.startsWith(n + " ") || n.endsWith(" " + key);
        });
        if (prefix.length === 1) return prefix[0];
      }
      return null;
    };

    const unmatched = new Set<string>();
    const resolved: Array<{ row: (typeof rows)[number]; home: Doc<"teams">; away: Doc<"teams"> }> = [];
    for (const row of rows) {
      const home = resolve(row.home);
      const away = resolve(row.away);
      if (!home) unmatched.add(row.home);
      if (!away) unmatched.add(row.away);
      if (home && away && home._id !== away._id) resolved.push({ row, home, away });
    }
    const out = {
      recognized: resolved.length,
      unmatched: Array.from(unmatched),
      added: 0,
      updated: 0,
      unchanged: 0,
      rows: resolved.map(({ row, home, away }) => ({ ...row, homeName: home.name, awayName: away.name })),
    };
    if (preview) return out;

    for (const { row, home, away } of resolved) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || row.homeGoals < 0 || row.awayGoals < 0) continue;
      const existing = await findTeamMatch(ctx.db, home._id as Id<"teams">, away._id as Id<"teams">, row.date);
      if (existing) {
        if (existing.homeGoals === row.homeGoals && existing.awayGoals === row.awayGoals) {
          out.unchanged++;
          continue;
        }
        if (existing.homeGoals === undefined) await ensureSnapshotBeforeScore(ctx.db, existing._id);
        await ctx.db.patch(existing._id, { homeGoals: row.homeGoals, awayGoals: row.awayGoals });
        out.updated++;
        continue;
      }
      const id = await ctx.db.insert("matches", { homeTeamId: home._id, awayTeamId: away._id, date: row.date, league: competition });
      await ensureSnapshotBeforeScore(ctx.db, id);
      await ctx.db.patch(id, { homeGoals: row.homeGoals, awayGoals: row.awayGoals });
      out.added++;
    }
    if (out.added || out.updated) {
      await recomputeLeague(ctx.db, competition);
      await refreshRatingModel(ctx.db);
    }
    return out;
  },
});

/** Próximos partidos en bloque (p. ej. la Champions, que football-data no trae). */
export const addFixturesBulk = mutation({
  args: {
    competition: v.string(),
    preview: v.optional(v.boolean()),
    rows: v.array(v.object({ date: v.string(), home: v.string(), away: v.string() })),
  },
  handler: async (ctx, { competition, preview, rows }) => {
    if (rows.length > 300) throw new Error("Máximo 300 partidos por vez.");
    const all = await ctx.db.query("teams").collect();
    const inComp = all.filter((t) => activeIn(t, competition) || t.league === competition);
    const resolve = (name: string): Doc<"teams"> | null => {
      const key = normalizeName(name);
      if (!key) return null;
      for (const pool of [inComp, all]) {
        const exact = pool.filter((t) => normalizeName(t.name) === key);
        if (exact.length === 1) return exact[0];
        const prefix = pool.filter((t) => {
          const n = normalizeName(t.name);
          return n.startsWith(key + " ") || key.startsWith(n + " ") || n.endsWith(" " + key);
        });
        if (prefix.length === 1) return prefix[0];
      }
      return null;
    };
    const unmatched = new Set<string>();
    const ok: Array<{ date: string; home: Doc<"teams">; away: Doc<"teams"> }> = [];
    for (const r of rows) {
      const h = resolve(r.home), a = resolve(r.away);
      if (!h) unmatched.add(r.home);
      if (!a) unmatched.add(r.away);
      if (h && a && h._id !== a._id && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) ok.push({ date: r.date, home: h, away: a });
    }
    const out = {
      recognized: ok.length,
      unmatched: Array.from(unmatched),
      added: 0,
      existing: 0,
      rows: ok.map((r) => ({ date: r.date, homeName: r.home.name, awayName: r.away.name })),
    };
    if (preview) return out;
    for (const r of ok) {
      if (await findTeamMatch(ctx.db, r.home._id as Id<"teams">, r.away._id as Id<"teams">, r.date)) {
        out.existing++;
        continue;
      }
      const id = await ctx.db.insert("matches", { homeTeamId: r.home._id, awayTeamId: r.away._id, date: r.date, league: competition });
      await upsertSnapshot(ctx.db, id);
      out.added++;
    }
    return out;
  },
});
