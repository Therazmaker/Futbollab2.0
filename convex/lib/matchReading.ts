import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";
import { matchXg } from "./xgBlend";
import { seasonOf } from "./season";

type Reader = GenericDatabaseReader<DataModel>;

/**
 * "Lectura" del partido en lenguaje normal: explica de dónde salen los números
 * (tabla, goles, xG, forma, localía, bajas, modelo y mercado). Se genera con
 * reglas fijas, sin IA: es instantánea y siempre dice lo mismo con los mismos datos.
 */

export interface TeamSeason {
  name: string;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  /** xG a favor / en contra (real o estimado con tiros) y en cuántos partidos */
  xgFor: number;
  xgAgainst: number;
  xgMatches: number;
  /** Últimos 5, del más antiguo al más reciente */
  form: Array<"W" | "D" | "L">;
  rank?: number | null;
  points?: number | null;
}

/** Temporada de un equipo en su liga, solo con partidos ANTERIORES a la fecha dada. */
export async function teamSeasonBefore(
  db: Reader,
  teamId: Id<"teams">,
  name: string,
  league: string,
  beforeDate: string
): Promise<TeamSeason> {
  const season = seasonOf(beforeDate);
  const start = `${season.slice(0, 4)}-07-01`;
  const [h, a] = await Promise.all([
    db.query("matches").withIndex("by_home_and_date", (q) => q.eq("homeTeamId", teamId).gte("date", start).lt("date", beforeDate)).collect(),
    db.query("matches").withIndex("by_away_and_date", (q) => q.eq("awayTeamId", teamId).gte("date", start).lt("date", beforeDate)).collect(),
  ]);
  const rows = [...h, ...a]
    .filter((m) => m.league === league && m.homeGoals !== undefined && m.awayGoals !== undefined)
    .sort((x, y) => (x.date < y.date ? -1 : 1));
  const s: TeamSeason = { name, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, xgFor: 0, xgAgainst: 0, xgMatches: 0, form: [] };
  for (const m of rows) {
    const home = m.homeTeamId === teamId;
    const f = home ? m.homeGoals! : m.awayGoals!;
    const c = home ? m.awayGoals! : m.homeGoals!;
    s.played++;
    s.gf += f;
    s.ga += c;
    const r = f > c ? "W" : f === c ? "D" : "L";
    s[r === "W" ? "w" : r === "D" ? "d" : "l"]++;
    s.form.push(r);
    const xg = matchXg(m.stats);
    if (xg) {
      s.xgFor += home ? xg.home : xg.away;
      s.xgAgainst += home ? xg.away : xg.home;
      s.xgMatches++;
    }
  }
  s.form = s.form.slice(-5);
  return s;
}

export interface ReadingInput {
  home: TeamSeason;
  away: TeamSeason;
  /** 1X2 mostrado (con cuotas: mercado + correcciones) */
  probs: { home: number; draw: number; away: number };
  modelProbs: { home: number; draw: number; away: number };
  fair: { home: number; draw: number; away: number } | null;
  expectedGoals: { home: number; away: number };
  over25: number;
  homeAdvantage?: number | null;
  goalsPerTeam?: number | null;
  absences: { home: string[]; away: string[] };
  played: boolean;
}

const pc = (x: number) => `${Math.round(x * 100)} %`;
const d1 = (x: number) => x.toFixed(1).replace(".", ",");
const per = (x: number, n: number) => (n ? x / n : 0);

function formText(t: TeamSeason) {
  if (!t.form.length) return null;
  const w = t.form.filter((r) => r === "W").length;
  const d = t.form.filter((r) => r === "D").length;
  const l = t.form.filter((r) => r === "L").length;
  const n = t.form.length;
  if (w >= 4) return `${t.name} llega en racha (${w} victorias de ${n})`;
  if (w === 0 && d >= 3) return `${t.name} no gana pero empata mucho (${d} empates de ${n})`;
  if (w === 0) return `${t.name} no gana en los últimos ${n}`;
  if (l >= 3) return `${t.name} llega mal (${l} derrotas de ${n})`;
  return `${t.name} irregular (${w}V ${d}E ${l}D en los últimos ${n})`;
}

export function buildReading(x: ReadingInput): { headline: string; lines: string[] } {
  const { home: H, away: A } = x;
  const lines: string[] = [];

  // 1) Tabla
  if (H.rank && A.rank && !x.played) {
    const gap = Math.abs((H.points ?? 0) - (A.points ?? 0));
    lines.push(
      `En la tabla: ${H.name} ${H.rank}º (${H.points} pts) y ${A.name} ${A.rank}º (${A.points} pts)` +
        (gap <= 3 ? " — prácticamente empatados." : gap <= 8 ? " — cerca." : " — bastante separados.")
    );
  }

  // 2) Goles por partido
  if (H.played >= 3 && A.played >= 3) {
    const hf = per(H.gf, H.played), ha = per(H.ga, H.played), af = per(A.gf, A.played), aa = per(A.ga, A.played);
    const diff = hf - ha - (af - aa);
    let s = `Goles por partido esta temporada: ${H.name} mete ${d1(hf)} y recibe ${d1(ha)}; ${A.name} mete ${d1(af)} y recibe ${d1(aa)}.`;
    if (Math.abs(diff) < 0.3) s += " Por goles, son casi iguales.";
    else s += ` Por goles, ${diff > 0 ? H.name : A.name} es algo mejor.`;
    if (hf + ha >= 3 && af + aa >= 3) s += " Los dos juegan partidos abiertos.";
    lines.push(s);
    if (H.played < 10 || A.played < 10) lines.push(`Ojo: con ${Math.min(H.played, A.played)} partidos, un par de goles cambian estas medias; por eso el modelo también usa temporadas anteriores.`);
  }

  // 3) xG frente a goles: ¿suerte o puntería?
  for (const t of [H, A]) {
    if (t.xgMatches < 4) continue;
    const xgDiff = per(t.xgFor - t.xgAgainst, t.xgMatches);
    const gDiff = per(t.gf - t.ga, t.played);
    const gap = gDiff - xgDiff;
    if (gap >= 0.35) lines.push(`${t.name} saca más de lo que genera: por ocasiones (xG) su diferencia sería ${d1(xgDiff)} por partido y en goles es ${d1(gDiff)}. Puede estar teniendo suerte.`);
    else if (gap <= -0.35) lines.push(`${t.name} juega mejor de lo que dice su marcador: por ocasiones (xG) su diferencia sería ${d1(xgDiff)} por partido y en goles es ${d1(gDiff)}. Le falta puntería, o ha tenido mala suerte.`);
  }

  // 4) Forma
  const fh = formText(H), fa = formText(A);
  if (fh || fa) lines.push(`Forma: ${[fh, fa].filter(Boolean).join("; ")}. Cinco partidos pesan poco: el mercado suele exagerar las rachas.`);

  // 5) Localía
  if (x.homeAdvantage && x.goalsPerTeam) {
    const extra = x.goalsPerTeam * (x.homeAdvantage - 1);
    lines.push(`Jugar en casa vale unos ${d1(extra)} goles de más en esta liga.`);
  }

  // 6) Bajas
  for (const [side, t] of [["home", H], ["away", A]] as const) {
    if (x.absences[side].length) lines.push(`${t.name} tiene bajas: ${x.absences[side].join(", ")}.`);
  }

  // 7) Modelo y mercado
  const fav = x.probs.home >= x.probs.away ? "home" : "away";
  const favName = fav === "home" ? H.name : A.name;
  const notFav = 1 - x.probs[fav];
  lines.push(
    `El modelo (3 temporadas, goles + xG) da: ${H.name} ${pc(x.modelProbs.home)}, empate ${pc(x.modelProbs.draw)}, ${A.name} ${pc(x.modelProbs.away)}.`
  );
  if (x.fair) {
    const gap = x.modelProbs[fav] - x.fair[fav];
    lines.push(
      `El mercado (tus cuotas sin margen) da: ${pc(x.fair.home)} / ${pc(x.fair.draw)} / ${pc(x.fair.away)}.` +
        (Math.abs(gap) >= 0.04
          ? ` El modelo ve a ${favName} ${gap < 0 ? "menos" : "más"} favorito que el mercado, pero en el histórico, cuando no coinciden, suele acertar el mercado: ya ha visto la tabla, las rachas y las noticias. Por eso la barra parte del mercado.`
          : " Modelo y mercado coinciden.")
    );
  }

  // 8) Goles esperados
  const total = x.expectedGoals.home + x.expectedGoals.away;
  lines.push(
    `Se esperan unos ${d1(total)} goles (${H.name} ${d1(x.expectedGoals.home)}, ${A.name} ${d1(x.expectedGoals.away)}); más de 2,5 al ${pc(x.over25)}.`
  );

  // Titular
  const pFav = x.probs[fav];
  const headline =
    pFav >= 0.6
      ? `${favName} es claro favorito (${pc(pFav)}).`
      : pFav >= 0.45
      ? `${favName} es favorito, pero no por mucho: que no gane (empate o ${fav === "home" ? A.name : H.name}) pasa ${pc(notFav)} de las veces.`
      : `Partido muy abierto: ninguno pasa del 45 %${fav === "home" ? "; la localía apenas inclina hacia " + H.name : ""}.`;
  return { headline, lines };
}
