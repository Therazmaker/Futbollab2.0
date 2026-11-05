import type { GenericDatabaseReader, GenericDatabaseWriter } from "convex/server";
import type { DataModel } from "../_generated/dataModel";
import { DEFAULT_RATING_PARAMS, fitRatingModel, RatingParams, RatingRow, teamStrength } from "./ratingModel";

type Reader = GenericDatabaseReader<DataModel>;
type Writer = GenericDatabaseWriter<DataModel>;

const NAME = "rating";

export async function loadRatingParams(db: Reader): Promise<RatingParams> {
  const doc = await db
    .query("modelParams")
    .withIndex("by_name", (q) => q.eq("name", NAME))
    .first();
  return (doc?.params as RatingParams) ?? DEFAULT_RATING_PARAMS;
}

/**
 * Re-aprende los efectos globales de la nota con TODOS los partidos con nota
 * de todos los jugadores. Se llama tras registrar/editar/borrar partidos y
 * cuando cambian los resultados (cambia la fuerza de los equipos).
 */
export async function refreshRatingModel(db: Writer) {
  const [logs, players, teams] = await Promise.all([
    db.query("playerMatchLogs").collect(),
    db.query("players").collect(),
    db.query("teams").collect(),
  ]);
  const teamOf = new Map(players.map((p) => [p._id as string, p.teamId as string]));
  const strength = new Map(teams.map((t) => [t._id as string, teamStrength(t)]));
  const byPlayer = new Map<string, typeof logs>();
  for (const l of logs) {
    const r = Number(l.rawStats?.rating);
    if (!Number.isFinite(r) || r <= 0 || r > 10) continue;
    if (!byPlayer.has(l.playerId)) byPlayer.set(l.playerId, []);
    byPlayer.get(l.playerId)!.push(l);
  }
  const rows: RatingRow[] = [];
  byPlayer.forEach((list, playerId) => {
    list.sort((a, b) => (a.matchDate < b.matchDate ? -1 : a.matchDate > b.matchDate ? 1 : a._creationTime - b._creationTime));
    list.forEach((l, i) =>
      rows.push({
        playerId,
        rating: Number(l.rawStats.rating),
        isAway: l.isAway,
        minutes: l.minutesPlayed,
        ownStrength: strength.get(teamOf.get(playerId) ?? "") ?? null,
        opponentStrength: l.opponentTeamId ? strength.get(l.opponentTeamId) ?? null : null,
        order: i,
        total: list.length,
      })
    );
  });
  const params = fitRatingModel(rows);
  const doc = await db
    .query("modelParams")
    .withIndex("by_name", (q) => q.eq("name", NAME))
    .first();
  if (doc) await db.patch(doc._id, { params, updatedAt: Date.now() });
  else await db.insert("modelParams", { name: NAME, params, updatedAt: Date.now() });
  return params;
}
