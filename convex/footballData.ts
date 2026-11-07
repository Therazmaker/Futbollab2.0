import { action, internalAction, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { currentSeason } from "./lib/season";
import { DIVS, parseFootballDataCsv, parseFixturesCsv } from "./lib/footballData";

/**
 * Actualiza la temporada actual desde football-data.co.uk: resultados nuevos,
 * tiros, xG y cuotas medias de cierre (para el CLV) de las 5 ligas.
 *
 * Usa el mismo esquema de ids que scripts/legacy/build_footballdata.py, así que
 * un partido ya importado solo recibe lo que le falte, y un partido que
 * programaste a mano (mismo cruce, ±1 día) recibe su marcador sin duplicarse.
 * football-data suele publicar la jornada 1–3 días después.
 */

export const refreshCurrentSeason = action({
  args: {},
  handler: async (ctx) => refresh(ctx),
});

/** Lo mismo, lanzado por la tarea programada (convex/crons.ts). */
export const refreshScheduled = internalAction({
  args: {},
  handler: async (ctx) => refresh(ctx),
});

async function refresh(ctx: ActionCtx) {
  {
    const season = currentSeason(); // "2026-27"
    const code = season.slice(2, 4) + season.slice(5, 7); // "2627"
    const report = { season, inserted: 0, enriched: 0, rows: 0, unknownTeams: [] as string[], errors: [] as string[], leagues: [] as string[] };
    const unknown = new Set<string>();
    for (const div of Object.keys(DIVS)) {
      let text: string;
      try {
        const res = await fetch(`https://football-data.co.uk/mmz4281/${code}/${div}.csv`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        text = await res.text();
      } catch (e: any) {
        report.errors.push(`${DIVS[div]}: ${e?.message ?? e}`);
        continue;
      }
      const { rows, unknown: u } = parseFootballDataCsv(text, div, code);
      u.forEach((x) => unknown.add(`${x} (${DIVS[div]})`));
      report.rows += rows.length;
      let changed = 0;
      for (let i = 0; i < rows.length; i += 200) {
        const r = await ctx.runMutation(internal.legacy.importMatchesChunk, { matches: rows.slice(i, i + 200) });
        report.inserted += r.inserted;
        report.enriched += r.enriched;
        changed += r.inserted + r.enriched;
      }
      if (changed) {
        await ctx.runMutation(internal.legacy.recomputeTeamStrengthInternal, { league: DIVS[div] });
        report.leagues.push(DIVS[div]);
      }
    }
    if (report.leagues.length) await ctx.runMutation(internal.legacy.refreshRatingModelInternal, {});
    // Próximos partidos de la semana, con cuota media de apertura
    const fixtures = { created: 0, updated: 0, read: 0 };
    try {
      const res = await fetch("https://football-data.co.uk/fixtures.csv");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { rows, unknown: u } = parseFixturesCsv(await res.text());
      u.forEach((x) => unknown.add(x));
      fixtures.read = rows.length;
      for (let i = 0; i < rows.length; i += 25) {
        const r = await ctx.runMutation(internal.legacy.scheduleFixturesChunk, { fixtures: rows.slice(i, i + 25) });
        fixtures.created += r.created;
        fixtures.updated += r.updated;
      }
    } catch (e: any) {
      report.errors.push(`próximos partidos: ${e?.message ?? e}`);
    }
    report.unknownTeams = Array.from(unknown);
    return { ...report, fixtures };
  }
}
