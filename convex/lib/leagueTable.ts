import type { GenericDatabaseWriter } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";
import { fitTeamRatings, standings } from "./teamRatings";
import { currentSeason, previousSeason, seasonOf } from "./season";
import { recomputeChampions } from "./competitionTable";
import { leagueGoalRates } from "./markets";

type Db = GenericDatabaseWriter<DataModel>;

/**
 * Recalcula la tabla de una liga (puntos, DG, forma, V-E-D) y la fuerza
 * ataque/defensa de cada equipo a partir de la tabla `matches`.
 * También guarda en la liga la ventaja de local y los goles medios, que usa
 * el simulador de partidos.
 */
export async function recomputeLeague(db: Db, league: string, opts: { season?: string } = {}) {
  // La Champions no es una liga doméstica: su clasificación sale de sus partidos
  if (league === "ucl") return recomputeChampions(db, league, opts.season);
  const rows = await db
    .query("matches")
    .withIndex("by_league_and_date", (q) => q.eq("league", league))
    .collect();
  if (!rows.length) return 0;
  // Solo cuentan partidos con marcador entre equipos de esta liga
  // (una "liga" como "ucl" o "copa" no tiene equipos propios: no hay tabla).
  const leagueTeams = await db
    .query("teams")
    .withIndex("by_league", (q) => q.eq("league", league))
    .collect();
  const members = new Set(leagueTeams.map((t) => t._id as string));
  if (!members.size) return 0;
  // Un mismo partido no puede contar dos veces (pasaba con los equipos duplicados)
  const seen = new Set<string>();
  const unique: Array<(typeof rows)[number] & { homeGoals: number; awayGoals: number }> = [];
  for (const r of rows) {
    if (r.homeGoals === undefined || r.awayGoals === undefined) continue;
    if (!members.has(r.homeTeamId) || !members.has(r.awayTeamId)) continue;
    const key = `${r.homeTeamId}|${r.awayTeamId}|${r.date}`;
    if (seen.has(key)) continue; // duplicado: no se cuenta dos veces
    seen.add(key);
    unique.push(r as (typeof unique)[number]);
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
      goalRates: leagueGoalRates(results) ?? undefined,
      currentSeason: opts.season ?? currentSeason(),
    });
  }
  // Tabla = SOLO temporada actual. La fuerza usa todo (con más peso a lo reciente).
  const season = opts.season ?? currentSeason();
  const prev = previousSeason(season);
  const current = standings(results.filter((r) => seasonOf(r.date) === season));
  const last = standings(results.filter((r) => seasonOf(r.date) === prev));
  const currentByTeam = new Map(current.map((row) => [row.team, row]));
  const lastByTeam = new Map(last.map((row) => [row.team, row]));
  for (const t of leagueTeams) {
    const row = currentByTeam.get(t._id);
    const prevRow = lastByTeam.get(t._id);
    const rating = ratings.get(t._id);
    await db.patch(t._id, {
      season,
      rank: row?.rank,
      points: row?.points,
      played: row?.played,
      wins: row?.w,
      draws: row?.d,
      losses: row?.l,
      goalsFor: row?.gf,
      goalsAgainst: row?.ga,
      goalDifference: row ? row.gf - row.ga : undefined,
      form: row?.form,
      lastSeason: prevRow
        ? { season: prev, rank: prevRow.rank, points: prevRow.points, played: prevRow.played, goalsFor: prevRow.gf, goalsAgainst: prevRow.ga }
        : undefined,
      attackRating: rating ? +rating.attack.toFixed(3) : t.attackRating,
      defenseRating: rating ? +rating.defense.toFixed(3) : t.defenseRating,
    });
  }
  return unique.length;
}
