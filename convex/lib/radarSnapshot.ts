import type { GenericDatabaseWriter } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";
import { analyzeStoredMatch, newRadarContext, RadarContext } from "./radarMatch";

type Db = GenericDatabaseWriter<DataModel>;

/**
 * Foto del Radar antes del partido. Se toma (y se refresca) al abrir el
 * Radar mientras el partido no tiene marcador, y como respaldo justo antes de
 * guardar el marcador (`late`). Nunca se reescribe una vez hay marcador: así
 * la evaluación compara con lo que el modelo decía ANTES.
 */
export async function upsertSnapshot(db: Db, matchId: Id<"matches">, opts: { late?: boolean; rc?: RadarContext } = {}) {
  const m = await db.get(matchId);
  if (!m) return null;
  const existing = await db
    .query("radarSnapshots")
    .withIndex("by_match", (q) => q.eq("matchId", matchId))
    .first();
  const scored = m.homeGoals !== undefined && m.awayGoals !== undefined;
  if (scored) return existing?._id ?? null; // ya jugado: no se toca (ni se crea a posteriori)
  const a = await analyzeStoredMatch(db, m, opts.rc ?? (await newRadarContext(db)));
  if (!a) return null;
  const mk = a.markets;
  const doc = {
    matchId,
    date: m.date,
    competition: m.league,
    takenAt: Date.now(),
    late: !!opts.late,
    probs: {
      ...mk.probabilities,
      over15: mk.over15,
      over25: mk.over25,
      over35: mk.over35,
      btts: mk.btts,
      homeCleanSheet: mk.homeCleanSheet,
      awayCleanSheet: mk.awayCleanSheet,
    },
    base: a.leagueBase ?? null,
    baseProbs: a.baseMarkets ? a.baseMarkets.probabilities : undefined,
    expectedGoals: mk.expectedGoals,
    attackFactor: a.attackFactor,
    odds: m.odds ?? undefined,
    fair: a.fair ?? undefined,
    flags: a.flags.map((f) => f.code),
    favorite: a.favorite,
    bestEdge: a.bestEdge ?? undefined,
    players: (["home", "away"] as const).flatMap((side) =>
      a.players[side].list.map((p) => ({
        playerId: p.playerId,
        teamId: a[side]._id,
        pScore: p.pScore,
        pShot1: p.pShot1,
        pShot2: p.pShot2,
        xG: p.xG,
        minutes: p.minutes,
        rating: p.rating,
      }))
    ),
    studyScore: a.studyScore,
  };
  if (existing) {
    await db.patch(existing._id, doc);
    return existing._id;
  }
  return await db.insert("radarSnapshots", doc);
}

/** Antes de poner un marcador: asegura que hay foto previa (si no la había, la toma ahora). */
export async function ensureSnapshotBeforeScore(db: Db, matchId: Id<"matches">) {
  const existing = await db
    .query("radarSnapshots")
    .withIndex("by_match", (q) => q.eq("matchId", matchId))
    .first();
  if (existing) return existing._id;
  return upsertSnapshot(db, matchId, { late: true });
}
