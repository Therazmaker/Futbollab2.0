import type { GenericDatabaseReader, GenericDatabaseWriter } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";
import {
  FEATURE_PRIORS,
  fitProfile,
  ModelLog,
  PlayerPriorInput,
  walkForward,
} from "./engine";

type Reader = GenericDatabaseReader<DataModel>;
type Writer = GenericDatabaseWriter<DataModel>;

/** Carga jugador + partidos (orden cronológico) listos para el motor. */
export async function loadPlayerModelInput(db: Reader, playerId: Id<"players">) {
  const player = await db.get(playerId);
  if (!player) return null;
  const logs = await db
    .query("playerMatchLogs")
    .withIndex("by_player", (q) => q.eq("playerId", playerId))
    .collect();
  logs.sort((a, b) => (a.matchDate < b.matchDate ? -1 : a.matchDate > b.matchDate ? 1 : a._creationTime - b._creationTime));

  const defenseCache = new Map<string, number | null>();
  const defenseOf = async (teamId?: Id<"teams">) => {
    if (!teamId) return null;
    if (!defenseCache.has(teamId)) {
      const team = await db.get(teamId);
      defenseCache.set(teamId, team?.defenseRating ?? null);
    }
    return defenseCache.get(teamId) ?? null;
  };

  const modelLogs: ModelLog[] = [];
  for (const l of logs) {
    modelLogs.push({
      id: l._id,
      matchDate: l.matchDate,
      opponent: l.opponent,
      isAway: l.isAway,
      minutesPlayed: l.minutesPlayed,
      rawStats: l.rawStats,
      contextFeatures: l.contextFeatures,
      opponentDefense: await defenseOf(l.opponentTeamId),
    });
  }
  const priorInput: PlayerPriorInput = {
    position: player.position,
    seasonStats: player.seasonStats ?? null,
  };
  return { player, logs: modelLogs, priorInput, defenseOf };
}

/**
 * Guarda los efectos de contexto aprendidos en `playerWeights`, para que la UI
 * los muestre. Siempre se recalculan desde cero con todos los partidos, así que
 * editar o borrar un partido corrige los pesos automáticamente.
 */
export async function syncPlayerWeights(db: Writer, playerId: Id<"players">) {
  const input = await loadPlayerModelInput(db, playerId);
  if (!input) return null;
  const state = fitProfile(input.logs, input.priorInput);
  // Siempre mostramos los efectos conocidos, aunque aún no haya datos.
  for (const f of Object.keys(FEATURE_PRIORS)) {
    if (!state.beta[f]) {
      const pr = FEATURE_PRIORS[f];
      state.beta[f] = { mean: pr.mean, sd: pr.sd, prior: pr, dataShare: 0, matches: 0 };
    }
  }
  const existing = await db
    .query("playerWeights")
    .withIndex("by_player_and_feature", (q) => q.eq("playerId", playerId))
    .collect();
  const now = Date.now();
  for (const [featureName, b] of Object.entries(state.beta)) {
    const doc = existing.find((e) => e.featureName === featureName);
    const row = {
      weightValue: +(Math.exp(b.mean) - 1).toFixed(4),
      confidenceScore: +b.dataShare.toFixed(3),
      sd: +b.sd.toFixed(4),
      matches: b.matches,
      updatedAt: now,
    };
    if (doc) await db.patch(doc._id, row);
    else await db.insert("playerWeights", { playerId, featureName, ...row });
  }
  // Pesos que el modelo ya no usa (p.ej. el viejo home_pitch_bias, que contaba dos veces lo mismo)
  for (const doc of existing) {
    if (!state.beta[doc.featureName]) await db.delete(doc._id);
  }
  return { state, input };
}

export function buildReport(input: NonNullable<Awaited<ReturnType<typeof loadPlayerModelInput>>>) {
  const points = walkForward(input.logs, input.priorInput);
  const state = fitProfile(input.logs, input.priorInput);
  return { points, state };
}
