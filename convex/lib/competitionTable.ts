import type { GenericDatabaseWriter } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";
import { standings } from "./teamRatings";
import { currentSeason, seasonOf } from "./season";

type Db = GenericDatabaseWriter<DataModel>;

/**
 * Clasificación de la Champions (fase liga) calculada con los partidos REALES
 * de la temporada actual (tabla `matches`, league = "ucl", con marcador).
 * Rellena los campos ucl* de cada equipo y lo inscribe en la competición si
 * jugó algún partido. Borra los ucl* de equipos sin partidos esta temporada
 * (así desaparecen los datos de ejemplo que se habían sembrado a mano).
 * Fases: 1–8 octavos directo, 9–24 playoff, 25+ eliminado.
 */
export async function recomputeChampions(db: Db, code = "ucl", season = currentSeason()) {
  const rows = (
    await db
      .query("matches")
      .withIndex("by_league_and_date", (q) => q.eq("league", code))
      .collect()
  ).filter((m) => seasonOf(m.date) === season);

  // Inscribir en la competición a todo equipo que haya jugado (aunque no tenga marcador)
  const playedTeams = new Set<string>();
  rows.forEach((m) => {
    playedTeams.add(m.homeTeamId);
    playedTeams.add(m.awayTeamId);
  });
  for (const id of Array.from(playedTeams)) {
    const t = await db.get(id as Id<"teams">);
    if (t && !(t.competitions ?? []).includes(code)) {
      await db.patch(t._id, { competitions: [...(t.competitions ?? [t.league]), code] });
    }
  }

  const scored = rows.filter((m) => m.homeGoals !== undefined && m.awayGoals !== undefined);
  const table = standings(
    scored.map((m) => ({
      home: m.homeTeamId as string,
      away: m.awayTeamId as string,
      homeGoals: m.homeGoals!,
      awayGoals: m.awayGoals!,
      date: m.date,
    }))
  );
  const byTeam = new Map(table.map((r) => [r.team, r]));

  if (code === "ucl") {
    const teams = await db.query("teams").collect();
    for (const t of teams) {
      const r = byTeam.get(t._id);
      if (r) {
        await db.patch(t._id, {
          uclRank: r.rank,
          uclPoints: r.points,
          uclPlayed: r.played,
          uclWins: r.w,
          uclDraws: r.d,
          uclLosses: r.l,
          uclGoalsFor: r.gf,
          uclGoalsAgainst: r.ga,
          uclGoalDifference: r.gf - r.ga,
          uclForm: r.form,
          uclPhase: r.rank <= 8 ? "direct_round_16" : r.rank <= 24 ? "qualification_playoff" : "eliminated",
        });
      } else if (t.uclRank !== undefined || t.uclPlayed !== undefined) {
        await db.patch(t._id, {
          uclRank: undefined,
          uclPoints: undefined,
          uclPlayed: undefined,
          uclWins: undefined,
          uclDraws: undefined,
          uclLosses: undefined,
          uclGoalsFor: undefined,
          uclGoalsAgainst: undefined,
          uclGoalDifference: undefined,
          uclForm: undefined,
          uclPhase: undefined,
        });
      }
    }
  }

  const leagueDocs = await db
    .query("leagues")
    .withIndex("by_code", (q) => q.eq("code", code))
    .collect();
  for (const d of leagueDocs) await db.patch(d._id, { currentSeason: season, matchesPlayed: scored.length });
  return scored.length;
}
