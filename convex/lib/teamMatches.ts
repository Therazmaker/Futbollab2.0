import type { GenericDatabaseReader, GenericDatabaseWriter } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { recomputeLeague } from "./leagueTable";
import { homeCompetition } from "./noLeague";

type Db = GenericDatabaseWriter<DataModel>;
type Reader = GenericDatabaseReader<DataModel>;

/**
 * Un partido de jugador pertenece a un partido de su equipo (tabla `matches`).
 * Este módulo encuentra o crea ese partido, enlaza los registros y limpia los
 * partidos que se quedan vacíos.
 */

export const normalizeName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(fc|cf|ac|as|ss|ssc|afc|sc|de|club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Busca un equipo por nombre (exacto tras normalizar, o por prefijo único). */
export async function findTeamByName(db: Reader, name: string) {
  const key = normalizeName(name);
  if (!key) return null;
  const all = await db.query("teams").collect();
  const exact = all.filter((t) => normalizeName(t.name) === key);
  if (exact.length === 1) return exact[0];
  const prefix = all.filter((t) => {
    const n = normalizeName(t.name);
    return n.startsWith(key + " ") || key.startsWith(n + " ");
  });
  return prefix.length === 1 ? prefix[0] : null;
}

export async function findTeamMatch(db: Reader, homeTeamId: Id<"teams">, awayTeamId: Id<"teams">, date: string) {
  const rows = await db
    .query("matches")
    .withIndex("by_home_and_date", (q) => q.eq("homeTeamId", homeTeamId).eq("date", date))
    .collect();
  return rows.find((m) => m.awayTeamId === awayTeamId) ?? null;
}

/**
 * Partido del equipo para un registro de jugador, desde el punto de vista de
 * su equipo. Lo reutiliza si existe (mismo local, visitante y fecha); si no,
 * lo crea. Devuelve null si falta el equipo del jugador o el rival.
 */
export async function findOrCreateTeamMatch(
  db: Db,
  args: {
    teamId: Id<"teams">;
    opponentTeamId: Id<"teams">;
    isAway: boolean;
    date: string;
    competition?: string;
    teamGoals?: number;
    opponentGoals?: number;
  }
) {
  if (args.teamId === args.opponentTeamId) return null;
  const team = await db.get(args.teamId);
  if (!team) return null;
  const homeTeamId = args.isAway ? args.opponentTeamId : args.teamId;
  const awayTeamId = args.isAway ? args.teamId : args.opponentTeamId;
  const hasScore = args.teamGoals !== undefined && args.opponentGoals !== undefined;
  const homeGoals = hasScore ? (args.isAway ? args.opponentGoals : args.teamGoals) : undefined;
  const awayGoals = hasScore ? (args.isAway ? args.teamGoals : args.opponentGoals) : undefined;

  const existing = await findTeamMatch(db, homeTeamId, awayTeamId, args.date);
  if (existing) {
    if (hasScore && (existing.homeGoals !== homeGoals || existing.awayGoals !== awayGoals)) {
      await db.patch(existing._id, { homeGoals, awayGoals });
      await recomputeLeague(db, existing.league);
    }
    return existing._id;
  }
  const league = args.competition || homeCompetition(team);
  const id = await db.insert("matches", { league, date: args.date, homeTeamId, awayTeamId, homeGoals, awayGoals });
  if (hasScore) await recomputeLeague(db, league);
  return id;
}

/** Borra un partido sin marcador que ya no tiene jugadores (era solo un "contenedor"). */
export async function deleteIfOrphan(db: Db, matchId: Id<"matches"> | undefined) {
  if (!matchId) return;
  const m = await db.get(matchId);
  if (!m || m.legacyId || m.homeGoals !== undefined) return;
  const anyLog = await db
    .query("playerMatchLogs")
    .withIndex("by_match", (q) => q.eq("matchId", matchId))
    .first();
  if (!anyLog) await db.delete(matchId);
}

/**
 * Enlaza (o re-enlaza) un registro de jugador con el partido de su equipo.
 * Si no se conoce el rival como equipo, intenta resolverlo por nombre.
 */
export async function linkLogToTeamMatch(
  db: Db,
  log: Doc<"playerMatchLogs">,
  opts: { resolveByName?: boolean } = {}
) {
  const player = await db.get(log.playerId);
  if (!player) return null;
  let opponentTeamId = log.opponentTeamId;
  if (!opponentTeamId && log.opponent && opts.resolveByName !== false) {
    const found = await findTeamByName(db, log.opponent);
    if (found && found._id !== player.teamId) {
      opponentTeamId = found._id;
      await db.patch(log._id, { opponentTeamId });
    }
  }
  const previous = log.matchId;
  if (!opponentTeamId) {
    if (previous) {
      await db.patch(log._id, { matchId: undefined });
      await deleteIfOrphan(db, previous);
    }
    return null;
  }
  const matchId = await findOrCreateTeamMatch(db, {
    teamId: player.teamId,
    opponentTeamId,
    isAway: log.isAway,
    date: log.matchDate,
    competition: log.competition,
  });
  if (matchId !== previous) {
    await db.patch(log._id, { matchId: matchId ?? undefined });
    await deleteIfOrphan(db, previous);
  }
  return matchId;
}
