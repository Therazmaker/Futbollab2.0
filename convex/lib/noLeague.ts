import { currentSeason } from "./season";

/**
 * Equipos que solo se registran en una competición internacional (p. ej. la
 * Champions) sin su liga doméstica. Su `league` es NO_LEAGUE y su inscripción
 * vale para una temporada (`competitionSeason`).
 */
export const NO_LEAGUE = "intl";

type TeamLike = { league: string; competitions?: string[]; competitionSeason?: string };

export const isNoLeague = (t: TeamLike) => t.league === NO_LEAGUE;

/** Competición "propia" del equipo: su liga, o su competición internacional. */
export function homeCompetition(t: TeamLike): string {
  if (!isNoLeague(t)) return t.league;
  return t.competitions?.find((c) => c !== NO_LEAGUE) ?? "ucl";
}

/** ¿Debe aparecer al filtrar por esta competición en la temporada actual? */
export function activeIn(t: TeamLike, code: string, season = currentSeason()): boolean {
  const inComp = t.league === code || (t.competitions ?? []).includes(code);
  if (!inComp) return false;
  if (isNoLeague(t)) return !t.competitionSeason || t.competitionSeason === season;
  return true;
}
