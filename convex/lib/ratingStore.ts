import type { GenericDatabaseReader, GenericDatabaseWriter } from "convex/server";
import type { DataModel } from "../_generated/dataModel";
import { DEFAULT_RATING_PARAMS, fitRatingModel, RatingParams, RatingRow, teamStrength } from "./ratingModel";
import { postInjuryFlags } from "./injuries";

type Reader = GenericDatabaseReader<DataModel>;
type Writer = GenericDatabaseWriter<DataModel>;

const NAME = "rating";

export async function loadRatingParams(db: Reader): Promise<RatingParams> {
  const doc = await db
    .query("modelParams")
    .withIndex("by_name", (q) => q.eq("name", NAME))
    .first();
  const stored = doc?.params as RatingParams | undefined;
  if (!stored) return DEFAULT_RATING_PARAMS;
  // Parámetros guardados por una versión anterior pueden no tener los efectos nuevos
  return {
    ...DEFAULT_RATING_PARAMS,
    ...stored,
    beta: { ...DEFAULT_RATING_PARAMS.beta, ...stored.beta },
    betaSd: { ...DEFAULT_RATING_PARAMS.betaSd, ...stored.betaSd },
  };
}

/**
 * Re-aprende los efectos globales de la nota con TODOS los partidos con nota
 * de todos los jugadores. Se llama tras registrar/editar/borrar partidos y
 * cuando cambian los resultados (cambia la fuerza de los equipos).
 */
export async function refreshRatingModel(db: Writer) {
  const [logs, players, teams, injuries] = await Promise.all([
    db.query("playerMatchLogs").collect(),
    db.query("players").collect(),
    db.query("teams").collect(),
    db.query("injuries").collect(),
  ]);
  const injuriesOf = new Map<string, typeof injuries>();
  for (const inj of injuries) {
    if (!injuriesOf.has(inj.playerId)) injuriesOf.set(inj.playerId, []);
    injuriesOf.get(inj.playerId)!.push(inj);
  }
  const teamOf = new Map(players.map((p) => [p._id as string, p.teamId as string]));
  const strength = new Map(teams.map((t) => [t._id as string, teamStrength(t)]));
  // Vuelta de lesión: se cuenta sobre TODOS los partidos jugados de cada jugador
  const postInjuryById = new Map<string, boolean>();
  const playedByPlayer = new Map<string, typeof logs>();
  for (const l of logs) {
    if (!(l.minutesPlayed > 0)) continue;
    if (!playedByPlayer.has(l.playerId)) playedByPlayer.set(l.playerId, []);
    playedByPlayer.get(l.playerId)!.push(l);
  }
  playedByPlayer.forEach((list, playerId) => {
    list.sort((a, b) => (a.matchDate < b.matchDate ? -1 : a.matchDate > b.matchDate ? 1 : a._creationTime - b._creationTime));
    const flags = postInjuryFlags(list.map((l) => l.matchDate), injuriesOf.get(playerId) ?? []);
    list.forEach((l, i) => postInjuryById.set(l._id, flags[i]));
  });
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
        postInjury: postInjuryById.get(l._id) ?? false,
        injuredOff: !!l.injuredOff,
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
