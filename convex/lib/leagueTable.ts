import type { GenericDatabaseWriter } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";
import { fitTeamRatings, standings } from "./teamRatings";

type Db = GenericDatabaseWriter<DataModel>;

/**
 * Recalcula la tabla de una liga (puntos, DG, forma, V-E-D) y la fuerza
 * ataque/defensa de cada equipo a partir de la tabla `matches`.
 * También guarda en la liga la ventaja de local y los goles medios, que usa
 * el simulador de partidos.
 */
export async function recomputeLeague(db: Db, league: string) {
  const rows = await db
    .query("matches")
    .withIndex("by_league_and_date", (q) => q.eq("league", league))
    .collect();
  if (!rows.length) return 0;
  // Un mismo partido no puede contar dos veces (pasaba con los equipos duplicados)
  const seen = new Set<string>();
  const unique = [];
  for (const r of rows) {
    const key = `${r.homeTeamId}|${r.awayTeamId}|${r.date}`;
    if (seen.has(key)) {
      await db.delete(r._id);
      continue;
    }
    seen.add(key);
    unique.push(r);
  }
  const results = unique.map((r) => ({
    home: r.homeTeamId as string,
    away: r.awayTeamId as string,
    homeGoals: r.homeGoals,
    awayGoals: r.awayGoals,
    date: r.date,
  }));
  const { ratings, homeAdvantage, goalsPerTeam } = fitTeamRatings(results);
  const leagueDoc = await db
    .query("leagues")
    .withIndex("by_code", (q) => q.eq("code", league))
    .first();
  if (leagueDoc) {
    await db.patch(leagueDoc._id, {
      homeAdvantage: +homeAdvantage.toFixed(3),
      goalsPerTeam: +goalsPerTeam.toFixed(3),
      matchesPlayed: unique.length,
    });
  }
  for (const row of standings(results)) {
    const rating = ratings.get(row.team);
    await db.patch(row.team as Id<"teams">, {
      rank: row.rank,
      points: row.points,
      played: row.played,
      wins: row.w,
      draws: row.d,
      losses: row.l,
      goalsFor: row.gf,
      goalsAgainst: row.ga,
      goalDifference: row.gf - row.ga,
      form: row.form,
      attackRating: rating ? +rating.attack.toFixed(3) : undefined,
      defenseRating: rating ? +rating.defense.toFixed(3) : undefined,
    });
  }
  return unique.length;
}
