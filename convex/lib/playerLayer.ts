import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";
import { fitProfile, forecast, FittedState, ModelLog } from "./engine";
import { loadPlayerModelInput } from "./playerModel";
import { availabilityOn } from "./injuries";
import { forecastRating, PlayerRatingLog, RatingParams } from "./ratingModel";

type Reader = GenericDatabaseReader<DataModel>;

/**
 * Capa de jugadores del Radar: para un equipo en un partido concreto,
 * pronóstico de cada jugador con perfil (minutos, xG, P(marca), tiros, nota)
 * y aporte de xG que se pierde por las bajas.
 */

export interface PlayerProp {
  playerId: Id<"players">;
  name: string;
  position: string;
  minutes: number;
  xG: number;
  pScore: number; // 1 − e^(−xG): un gol por cada xG a largo plazo
  pShot1: number;
  pShot2: number;
  rating: number | null;
  ownMatches: number;
  returning: boolean;
}

export interface TeamPlayerLayer {
  players: PlayerProp[];
  absent: Array<{ name: string; xgPerMatch: number | null; expectedReturn: string | null }>;
  /** xG esperado sumando los jugadores con perfil disponibles */
  playersXg: number;
  absentXg: number;
  /** Minutos esperados de los jugadores con perfil / 990 (11 × 90) */
  coverage: number;
  logged: number;
}

export interface LayerCaches {
  input: Map<string, Awaited<ReturnType<typeof loadPlayerModelInput>>>;
  state: Map<string, FittedState>;
}

export function newLayerCaches(): LayerCaches {
  return { input: new Map(), state: new Map() };
}

function ratingHistory(logs: ModelLog[]): PlayerRatingLog[] {
  return logs
    .map((l) => ({
      rating: Number(l.rawStats?.rating),
      isAway: l.isAway,
      minutes: Number(l.minutesPlayed),
      ownStrength: l.ownStrength ?? null,
      opponentStrength: l.opponentStrength ?? null,
      postInjury: !!l.postInjury,
      injuredOff: !!l.injuredOff,
    }))
    .filter((h) => Number.isFinite(h.rating) && h.rating > 0 && h.rating <= 10);
}

export async function buildTeamPlayerLayer(
  db: Reader,
  teamId: Id<"teams">,
  ctx: { date: string; isAway: boolean; opponentDefense: number | null; opponentStrength: number | null },
  ratingParams: RatingParams,
  caches: LayerCaches
): Promise<TeamPlayerLayer> {
  const roster = await db
    .query("players")
    .withIndex("by_team", (q) => q.eq("teamId", teamId))
    .collect();
  const players: PlayerProp[] = [];
  const absent: TeamPlayerLayer["absent"] = [];
  let playersXg = 0;
  let absentXg = 0;
  let minutesSum = 0;
  let logged = 0;

  for (const p of roster) {
    if (!caches.input.has(p._id)) caches.input.set(p._id, await loadPlayerModelInput(db, p._id));
    const fullInput = caches.input.get(p._id);
    if (!fullInput) continue;
    // Solo lo que se sabía ANTES del partido (sin el propio partido ni posteriores)
    const input = { ...fullInput, logs: fullInput.logs.filter((l) => l.matchDate < ctx.date) };
    const played = input.logs.filter((l) => Number(l.minutesPlayed) > 0);
    const av = availabilityOn(ctx.date, input.injuries, played.map((l) => l.matchDate));
    if (!played.length) {
      if (av.status === "injured") absent.push({ name: p.name, xgPerMatch: null, expectedReturn: av.expectedReturn ?? null });
      continue;
    }
    logged++;
    const stateKey = `${p._id}|${ctx.date}`;
    if (!caches.state.has(stateKey)) caches.state.set(stateKey, fitProfile(input.logs, input.priorInput));
    const state = caches.state.get(stateKey)!;
    const usual = state.expectedMinutes;
    if (av.status === "injured") {
      const xgPerMatch = state.rates.xG.rate * (usual / 90);
      absentXg += xgPerMatch;
      absent.push({ name: p.name, xgPerMatch: +xgPerMatch.toFixed(2), expectedReturn: av.expectedReturn ?? null });
      continue;
    }
    const returning = av.status === "returning";
    const minutes = returning ? Math.min(usual, 60) : usual;
    const fc = forecast(state, { isAway: ctx.isAway, opponentDefense: ctx.opponentDefense, postInjury: returning }, minutes);
    const xG = fc.stats.xG.mean;
    const rf = ratingHistory(input.logs).length
      ? forecastRating(ratingParams, ratingHistory(input.logs), {
          isAway: ctx.isAway,
          minutes,
          ownStrength: input.ownStrength,
          opponentStrength: ctx.opponentStrength,
          postInjury: returning,
        })
      : null;
    playersXg += xG;
    minutesSum += minutes;
    players.push({
      playerId: p._id,
      name: p.name,
      position: p.position,
      minutes: Math.round(minutes),
      xG: +xG.toFixed(2),
      pScore: +(1 - Math.exp(-xG)).toFixed(3),
      pShot1: +(fc.stats.totalShots.pAtLeast["1"] ?? 0).toFixed(3),
      pShot2: +(fc.stats.totalShots.pAtLeast["2"] ?? 0).toFixed(3),
      rating: rf ? +rf.mean.toFixed(2) : null,
      ownMatches: played.length,
      returning,
    });
  }
  players.sort((a, b) => b.pScore - a.pScore);
  return {
    players,
    absent,
    playersXg: +playersXg.toFixed(2),
    absentXg: +absentXg.toFixed(2),
    coverage: +Math.min(1, minutesSum / 990).toFixed(2),
    logged,
  };
}
