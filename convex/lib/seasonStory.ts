/**
 * Anatomía de la temporada de un equipo: POR QUÉ gana o pierde.
 *
 * Cada partido de liga se mide en PUNTOS con tres referencias:
 *   - esperado: lo que el mercado le daba ANTES del partido (cuotas sin margen:
 *     3·P(gana) + P(empata)). Ya incluye quién era el rival, la localía y las bajas
 *     conocidas, así que perder con el Madrid fuera "cuesta" poco y perder en casa
 *     con el colista cuesta mucho. Si no hay cuotas, se estima con el Elo.
 *   - merecido: lo que daban sus ocasiones (xG de los dos, Poisson): "xPts".
 *   - real: los puntos que sacó.
 *
 *   real − esperado = (merecido − esperado) + (real − merecido)
 *                   =      rendimiento       +       suerte
 *
 * La suerte se reparte entre la definición propia (goles − xG) y lo que encajó
 * frente a lo que concedió (portero, acierto del rival). El contexto (rival grande
 * o débil, cansancio, rojas, bajas, remontadas) se mide como real − esperado en
 * los partidos donde se dio.
 *
 * Es una herramienta para ENTENDER, no para predecir: el mercado ya sabe casi todo
 * esto antes del partido. Lo útil es ver cuándo la tabla engaña (mucha suerte).
 */
import type { MatchStats } from "./xgBlend";
import { matchXg } from "./xgBlend";
import { seasonOf } from "./season";

export interface StoryMatchIn {
  _id: string;
  date: string;
  league: string;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals?: number;
  awayGoals?: number;
  stats?: MatchStats | null;
  halfTime?: { home: number; away: number } | null;
  cards?: { hy: number; ay: number; hr: number; ar: number } | null;
  closingOdds?: { home: number; draw: number; away: number } | null;
  odds?: { home?: number; draw?: number; away?: number } | null;
}

export interface StoryNarrative {
  ownRed: number;
  oppRed: number;
  ownInjuries: string[];
  summary?: string;
}

export interface StoryExtras {
  names: Map<string, string>;
  /** Partidos del equipo en otras competiciones (Champions, copa…) */
  otherComps: Array<{ date: string; league: string }>;
  narratives: Map<string, StoryNarrative>;
  /** Jugadores importantes de baja en cada partido */
  absences: Map<string, string[]>;
}

export type Tier = "big" | "mid" | "weak";
export type CauseKey =
  | "outplayed"
  | "underplayed"
  | "clinical"
  | "wasteful"
  | "keeper"
  | "oppClinical"
  | "vsBig"
  | "vsMid"
  | "vsWeak"
  | "tired"
  | "ownRed"
  | "oppRed"
  | "absences"
  | "comeback"
  | "collapse"
  | "injuryInGame";

export const CAUSES: Record<CauseKey, { icon: string; label: string; group: "why" | "when"; hint: string }> = {
  outplayed: { icon: "📈", label: "Jugó mejor de lo esperado", group: "why", hint: "Sus ocasiones (xG) valían más puntos de los que el mercado le daba." },
  underplayed: { icon: "📉", label: "Jugó peor de lo esperado", group: "why", hint: "Sus ocasiones (xG) valían menos puntos de los que el mercado le daba." },
  clinical: { icon: "🎯", label: "Definió por encima de su xG", group: "why", hint: "Marcó más goles de los que valían sus ocasiones: suerte o pegada." },
  wasteful: { icon: "😩", label: "Falló lo que generó", group: "why", hint: "Marcó menos de lo que valían sus ocasiones." },
  keeper: { icon: "🧤", label: "Portero / defensa salvó goles", group: "why", hint: "Encajó menos de lo que valían las ocasiones del rival." },
  oppClinical: { icon: "💥", label: "El rival la metió todas", group: "why", hint: "Encajó más de lo que valían las ocasiones del rival." },
  vsBig: { icon: "🏆", label: "Contra los grandes", group: "when", hint: "Rivales del cuarto superior de la liga por Elo en ese momento." },
  vsMid: { icon: "⚖️", label: "Contra los de la zona media", group: "when", hint: "Rivales ni grandes ni débiles." },
  vsWeak: { icon: "🐣", label: "Contra los débiles", group: "when", hint: "Rivales del 30 % inferior por Elo en ese momento." },
  tired: { icon: "😴", label: "Con cansancio", group: "when", hint: "Jugó otra competición en los 4 días previos o tuvo 3 días o menos de descanso." },
  ownRed: { icon: "🟥", label: "Se quedó con 10", group: "when", hint: "Le expulsaron a alguien (football-data o tu narración)." },
  oppRed: { icon: "🟩", label: "Rival con 10", group: "when", hint: "Expulsaron a alguien del rival." },
  absences: { icon: "🩹", label: "Con bajas importantes", group: "when", hint: "Algún jugador importante (muchos minutos) estaba lesionado." },
  comeback: { icon: "🔄", label: "Remontó en la 2ª parte", group: "when", hint: "Iba perdiendo al descanso y sacó puntos (impacto: puntos ganados en la 2ª parte)." },
  collapse: { icon: "🫠", label: "Se dejó remontar", group: "when", hint: "Iba ganando al descanso y no ganó (impacto: puntos perdidos en la 2ª parte)." },
  injuryInGame: { icon: "🚑", label: "Lesión durante el partido", group: "when", hint: "Tu narración registra una lesión suya en el partido." },
};

export interface StoryCauseHit {
  key: CauseKey;
  /** Puntos que explica en ese partido (+ suma, − resta) */
  impact: number;
}

export interface StoryMatchOut {
  _id: string;
  date: string;
  isHome: boolean;
  opponentId: string;
  opponent: string;
  gf: number;
  ga: number;
  result: "W" | "D" | "L";
  halfTime: { gf: number; ga: number } | null;
  xgf: number | null;
  xga: number | null;
  eloBefore: number;
  eloAfter: number;
  oppElo: number;
  tier: Tier;
  expected: number;
  expectedSource: "mercado" | "elo";
  deserved: number | null;
  points: number;
  performance: number | null;
  luck: number | null;
  causes: StoryCauseHit[];
  absences: string[];
  narrative: string | null;
  sentence: string;
}

export interface StoryCauseOut {
  key: CauseKey;
  icon: string;
  label: string;
  group: "why" | "when";
  hint: string;
  impact: number;
  n: number;
  matchIds: string[];
  points: number;
  expected: number;
  deserved: number | null;
}

export interface SeasonStory {
  season: string;
  played: number;
  points: number;
  expected: number;
  deserved: number | null;
  performance: number | null;
  luck: number | null;
  xgMatches: number;
  eloStart: number;
  eloNow: number;
  matches: StoryMatchOut[];
  causes: StoryCauseOut[];
  splits: Array<{ key: string; label: string; n: number; points: number; expected: number; deserved: number | null }>;
  summary: string[];
  keyMatches: string[];
}

export const ELO = { start: 1500, newcomer: 1440, k: 20, home: 60, carry: 0.75 };
const r1 = (x: number) => Math.round(x * 10) / 10;
const fmt = (x: number) => r1(x).toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const sgn = (x: number) => `${x >= 0 ? "+" : "−"}${fmt(Math.abs(x))}`;
const DAY = 86_400_000;

function fair(o?: { home?: number; draw?: number; away?: number } | null) {
  if (!o || !(o.home! > 1 && o.draw! > 1 && o.away! > 1)) return null;
  const i = [1 / o.home!, 1 / o.draw!, 1 / o.away!];
  const t = i[0] + i[1] + i[2];
  return { home: i[0] / t, draw: i[1] / t, away: i[2] / t };
}

/** 1X2 a partir de la diferencia de Elo (con localía). Solo si no hay cuotas. */
export function eloProbs(eloHome: number, eloAway: number) {
  const we = 1 / (1 + Math.pow(10, -(eloHome + ELO.home - eloAway) / 400));
  const draw = Math.max(0.08, 0.28 - 0.8 * (we - 0.5) ** 2);
  const home = Math.max(0.02, we - draw / 2);
  const away = Math.max(0.02, 1 - we - draw / 2);
  const t = home + draw + away;
  return { home: home / t, draw: draw / t, away: away / t };
}

function poisson(l: number, k: number) {
  let p = Math.exp(-l);
  for (let i = 1; i <= k; i++) p *= l / i;
  return p;
}

/** Puntos que "valían" las ocasiones: 3·P(gana) + P(empata) con dos Poisson independientes. */
export function xPoints(xgf: number, xga: number) {
  let win = 0;
  let draw = 0;
  for (let i = 0; i <= 10; i++) {
    const pi = poisson(Math.max(0.01, xgf), i);
    for (let j = 0; j <= 10; j++) {
      const p = pi * poisson(Math.max(0.01, xga), j);
      if (i > j) win += p;
      else if (i === j) draw += p;
    }
  }
  return 3 * win + draw;
}

const ptsOf = (f: number, a: number) => (f > a ? 3 : f === a ? 1 : 0);

/** Elo de toda la liga, partido a partido, con regresión a la media al cambiar de temporada. */
export function runElo(matches: StoryMatchIn[]) {
  const rating = new Map<string, number>();
  const before = new Map<string, { home: number; away: number }>();
  const after = new Map<string, { home: number; away: number }>();
  let season: string | null = null;
  let firstSeason: string | null = null;
  const sorted = matches
    .filter((m) => m.homeGoals !== undefined && m.awayGoals !== undefined)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a._id < b._id ? -1 : 1));
  for (const m of sorted) {
    const s = seasonOf(m.date);
    if (firstSeason === null) firstSeason = s;
    if (season !== null && s !== season) rating.forEach((v, k) => rating.set(k, ELO.start + ELO.carry * (v - ELO.start)));
    season = s;
    const init = s === firstSeason ? ELO.start : ELO.newcomer;
    const h = rating.get(m.homeTeamId) ?? init;
    const a = rating.get(m.awayTeamId) ?? init;
    before.set(m._id, { home: h, away: a });
    const we = 1 / (1 + Math.pow(10, -(h + ELO.home - a) / 400));
    const gd = m.homeGoals! - m.awayGoals!;
    const w = gd > 0 ? 1 : gd === 0 ? 0.5 : 0;
    const g = Math.abs(gd) <= 1 ? 1 : Math.abs(gd) === 2 ? 1.5 : (11 + Math.abs(gd)) / 8;
    const d = ELO.k * g * (w - we);
    rating.set(m.homeTeamId, h + d);
    rating.set(m.awayTeamId, a - d);
    after.set(m._id, { home: h + d, away: a - d });
  }
  return { before, after, rating };
}

function tierOf(oppElo: number, others: number[]): Tier {
  // Posición del rival entre los equipos de la liga en ese momento (0 = el mejor)
  const better = others.filter((x) => x > oppElo).length;
  const q = better / Math.max(1, others.length - 1);
  return q < 0.25 ? "big" : q >= 0.7 ? "weak" : "mid";
}

/**
 * Construye la historia de `teamId` en `season` con todos los partidos de su liga
 * (de la temporada y de la anterior, para que el Elo arranque "caliente").
 */
export function buildSeasonStory(teamId: string, season: string, leagueMatches: StoryMatchIn[], x: StoryExtras): SeasonStory {
  const elo = runElo(leagueMatches);
  const inSeason = leagueMatches
    .filter((m) => seasonOf(m.date) === season && m.homeGoals !== undefined && m.awayGoals !== undefined)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const seasonTeams = new Set<string>();
  inSeason.forEach((m) => {
    seasonTeams.add(m.homeTeamId);
    seasonTeams.add(m.awayTeamId);
  });
  // Elo de cada equipo de la liga antes de cada fecha (para clasificar al rival)
  const current = new Map<string, number>();
  const prior = leagueMatches
    .filter((m) => seasonOf(m.date) !== season && m.homeGoals !== undefined)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const m of prior) {
    const af = elo.after.get(m._id);
    if (af) {
      current.set(m.homeTeamId, ELO.start + ELO.carry * (af.home - ELO.start));
      current.set(m.awayTeamId, ELO.start + ELO.carry * (af.away - ELO.start));
    }
  }

  const out: StoryMatchOut[] = [];
  let eloStart: number | null = null;
  for (const m of inSeason) {
    const b = elo.before.get(m._id)!;
    const af = elo.after.get(m._id)!;
    current.set(m.homeTeamId, b.home);
    current.set(m.awayTeamId, b.away);
    const isHome = m.homeTeamId === teamId;
    const isAway = m.awayTeamId === teamId;
    if (isHome || isAway) {
      const oppId = isHome ? m.awayTeamId : m.homeTeamId;
      const gf = isHome ? m.homeGoals! : m.awayGoals!;
      const ga = isHome ? m.awayGoals! : m.homeGoals!;
      const eloBefore = isHome ? b.home : b.away;
      const oppElo = isHome ? b.away : b.home;
      if (eloStart === null) eloStart = eloBefore;
      const others = Array.from(seasonTeams).map((t) => current.get(t) ?? ELO.newcomer);
      const tier = tierOf(oppElo, others);

      const market = fair(m.closingOdds) ?? fair(m.odds);
      const p = market ?? eloProbs(b.home, b.away);
      const expected = isHome ? 3 * p.home + p.draw : 3 * p.away + p.draw;
      const points = ptsOf(gf, ga);
      const xg = matchXg(m.stats);
      const xgf = xg ? (isHome ? xg.home : xg.away) : null;
      const xga = xg ? (isHome ? xg.away : xg.home) : null;
      const deserved = xgf !== null && xga !== null ? xPoints(xgf, xga) : null;
      const performance = deserved !== null ? deserved - expected : null;
      const luck = deserved !== null ? points - deserved : null;
      const causes: StoryCauseHit[] = [];
      const diff = points - expected;

      // ¿Por qué? rendimiento + suerte (repartida entre definición y lo encajado)
      if (performance !== null && Math.abs(performance) >= 0.5) causes.push({ key: performance > 0 ? "outplayed" : "underplayed", impact: performance });
      if (luck !== null && Math.abs(luck) >= 0.4) {
        const comps: Array<{ key: CauseKey; c: number }> = [
          { key: (gf - xgf! >= 0 ? "clinical" : "wasteful") as CauseKey, c: gf - xgf! },
          { key: (xga! - ga >= 0 ? "keeper" : "oppClinical") as CauseKey, c: xga! - ga },
        ].filter((k) => Math.sign(k.c) === Math.sign(luck) && Math.abs(k.c) > 0.2);
        const tot = comps.reduce((s, k) => s + Math.abs(k.c), 0);
        for (const k of comps) {
          const share = (luck * Math.abs(k.c)) / tot;
          if (Math.abs(share) >= 0.3) causes.push({ key: k.key, impact: share });
        }
      }

      // ¿Cuándo? contextos, medidos como real − esperado
      causes.push({ key: tier === "big" ? "vsBig" : tier === "weak" ? "vsWeak" : "vsMid", impact: diff });
      const t0 = Date.parse(m.date);
      const lastAny = [...x.otherComps.map((o) => o.date), ...inSeason.filter((o) => (o.homeTeamId === teamId || o.awayTeamId === teamId) && o.date < m.date).map((o) => o.date)]
        .filter((d) => d < m.date)
        .sort()
        .pop();
      const rest = lastAny ? Math.round((t0 - Date.parse(lastAny)) / DAY) : 99;
      const midweek = x.otherComps.some((o) => o.date < m.date && t0 - Date.parse(o.date) <= 4 * DAY);
      if (midweek || rest <= 3) causes.push({ key: "tired", impact: diff });
      const nar = x.narratives.get(m._id);
      const ownRed = Math.max(m.cards ? (isHome ? m.cards.hr : m.cards.ar) : 0, nar?.ownRed ?? 0);
      const oppRed = Math.max(m.cards ? (isHome ? m.cards.ar : m.cards.hr) : 0, nar?.oppRed ?? 0);
      if (ownRed > 0) causes.push({ key: "ownRed", impact: diff });
      if (oppRed > 0) causes.push({ key: "oppRed", impact: diff });
      const abs = x.absences.get(m._id) ?? [];
      if (abs.length) causes.push({ key: "absences", impact: diff });
      let ht: { gf: number; ga: number } | null = null;
      if (m.halfTime) {
        ht = { gf: isHome ? m.halfTime.home : m.halfTime.away, ga: isHome ? m.halfTime.away : m.halfTime.home };
        const change = points - ptsOf(ht.gf, ht.ga);
        // Remontada: iba perdiendo al descanso y sacó algo. Se le escapó: iba ganando y no ganó.
        if (ht.gf < ht.ga && change > 0) causes.push({ key: "comeback", impact: change });
        if (ht.gf > ht.ga && change < 0) causes.push({ key: "collapse", impact: change });
      }
      if (nar?.ownInjuries.length) causes.push({ key: "injuryInGame", impact: diff });

      const row: StoryMatchOut = {
        _id: m._id,
        date: m.date,
        isHome,
        opponentId: oppId,
        opponent: x.names.get(oppId) ?? "?",
        gf,
        ga,
        result: gf > ga ? "W" : gf === ga ? "D" : "L",
        halfTime: ht,
        xgf,
        xga,
        eloBefore: Math.round(eloBefore),
        eloAfter: Math.round(isHome ? af.home : af.away),
        oppElo: Math.round(oppElo),
        tier,
        expected,
        expectedSource: market ? "mercado" : "elo",
        deserved,
        points,
        performance,
        luck,
        causes,
        absences: abs,
        narrative: nar?.summary ?? null,
        sentence: "",
      };
      row.sentence = matchSentence(row);
      out.push(row);
    }
  }

  // Causas agregadas (nodos del grafo)
  const agg = new Map<CauseKey, StoryCauseOut>();
  for (const m of out) {
    for (const c of m.causes) {
      const meta = CAUSES[c.key];
      if (!agg.has(c.key)) agg.set(c.key, { key: c.key, ...meta, impact: 0, n: 0, matchIds: [], points: 0, expected: 0, deserved: 0 });
      const a = agg.get(c.key)!;
      a.impact += c.impact;
      a.n++;
      a.matchIds.push(m._id);
      a.points += m.points;
      a.expected += m.expected;
      a.deserved = a.deserved === null || m.deserved === null ? null : a.deserved + m.deserved;
    }
  }
  const causes = Array.from(agg.values()).sort((a, b) => (a.group === b.group ? Math.abs(b.impact) - Math.abs(a.impact) : a.group === "why" ? -1 : 1));

  const sum = (f: (m: StoryMatchOut) => number) => out.reduce((s, m) => s + f(m), 0);
  const withXg = out.filter((m) => m.deserved !== null);
  const points = sum((m) => m.points);
  const expected = sum((m) => m.expected);
  const deserved = withXg.length === out.length && out.length ? sum((m) => m.deserved!) : null;
  const split = (key: string, label: string, rows: StoryMatchOut[]) => ({
    key,
    label,
    n: rows.length,
    points: rows.reduce((s, m) => s + m.points, 0),
    expected: rows.reduce((s, m) => s + m.expected, 0),
    deserved: rows.every((m) => m.deserved !== null) ? rows.reduce((s, m) => s + m.deserved!, 0) : null,
  });
  const splits = [
    split("home", "🏠 En casa", out.filter((m) => m.isHome)),
    split("away", "✈️ Fuera", out.filter((m) => !m.isHome)),
    split("big", "🏆 vs grandes", out.filter((m) => m.tier === "big")),
    split("mid", "⚖️ vs zona media", out.filter((m) => m.tier === "mid")),
    split("weak", "🐣 vs débiles", out.filter((m) => m.tier === "weak")),
  ].filter((s) => s.n > 0);

  const story: SeasonStory = {
    season,
    played: out.length,
    points,
    expected,
    deserved,
    performance: deserved !== null ? deserved - expected : null,
    luck: deserved !== null ? points - deserved : null,
    xgMatches: withXg.length,
    eloStart: Math.round(eloStart ?? ELO.start),
    eloNow: out.length ? out[out.length - 1].eloAfter : Math.round(eloStart ?? ELO.start),
    matches: out,
    causes,
    splits,
    summary: [],
    keyMatches: [],
  };
  story.summary = summarize(story, x.names.get(teamId) ?? "El equipo");
  story.keyMatches = [...out]
    .sort((a, b) => Math.abs(b.points - b.expected) - Math.abs(a.points - a.expected))
    .slice(0, 3)
    .map((m) => m.sentence);
  return story;
}

const TIER_TXT: Record<Tier, string> = { big: "rival grande", mid: "rival de zona media", weak: "rival débil" };

/** Una frase por partido: qué se esperaba, qué merecía, qué pasó y la causa principal. */
export function matchSentence(m: StoryMatchOut): string {
  const res = m.result === "W" ? "Ganó" : m.result === "D" ? "Empató" : "Perdió";
  const where = m.isHome ? `en casa con el ${m.opponent}` : `en el campo del ${m.opponent}`;
  const parts = [`${res} ${m.gf}-${m.ga} ${where} (${TIER_TXT[m.tier]}).`];
  parts.push(`Se esperaban ${fmt(m.expected)} pts${m.expectedSource === "elo" ? " (sin cuotas: estimado con el Elo)" : ""}`);
  if (m.deserved !== null) parts[1] += `; por ocasiones (xG ${fmt(m.xgf!)}–${fmt(m.xga!)}) merecía ${fmt(m.deserved)}`;
  parts[1] += ".";
  const why = m.causes.filter((c) => CAUSES[c.key].group === "why").sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const diff = m.points - m.expected;
  if (Math.abs(diff) < 0.4) parts.push("Salió más o menos lo esperado.");
  else if (why.length) {
    const top = why[0];
    const txt: Record<string, string> = {
      outplayed: "jugó mejor de lo que se esperaba",
      underplayed: "jugó peor de lo que se esperaba",
      clinical: "definió por encima de lo que valían sus ocasiones",
      wasteful: "falló lo que generó",
      keeper: "su portería salvó goles",
      oppClinical: "el rival convirtió más de lo que generó",
    };
    parts.push(`La clave: ${txt[top.key]} (${sgn(top.impact)} pts).`);
  } else if (m.deserved === null) parts.push(`Sacó ${sgn(diff)} pts sobre lo esperado (sin xG para saber si fue juego o suerte).`);
  else parts.push(`Sacó ${sgn(diff)} pts sobre lo esperado.`);
  if (m.halfTime) {
    const c = m.causes.find((k) => k.key === "comeback" || k.key === "collapse");
    if (c) parts.push(`Al descanso iba ${m.halfTime.gf}-${m.halfTime.ga}: ${c.key === "comeback" ? "lo remontó" : "se le escapó la ventaja"}.`);
  }
  const red = m.causes.find((k) => k.key === "ownRed") ? "se quedó con 10" : m.causes.find((k) => k.key === "oppRed") ? "el rival se quedó con 10" : null;
  if (red) parts.push(`Ojo: ${red}.`);
  if (m.absences.length) parts.push(`Bajas: ${m.absences.slice(0, 3).join(", ")}.`);
  return parts.join(" ");
}

function summarize(s: SeasonStory, name: string): string[] {
  const L: string[] = [];
  if (!s.played) return [`${name} todavía no ha jugado partidos de liga esta temporada.`];
  L.push(
    `${name} suma ${s.points} pts en ${s.played} partidos de liga. Con sus rivales, el mercado le daba ${fmt(s.expected)}` +
      (s.deserved !== null ? ` y, por las ocasiones que generó y concedió, merecía ${fmt(s.deserved)}.` : ".")
  );
  if (s.performance !== null && s.luck !== null) {
    const perf =
      s.performance >= 1.5
        ? `Juega mejor de lo que se esperaba de él (${sgn(s.performance)} pts por cómo juega)`
        : s.performance <= -1.5
        ? `Juega por debajo de lo que se esperaba de él (${sgn(s.performance)} pts por cómo juega)`
        : "Juega más o menos lo que se esperaba de él";
    const luck =
      s.luck >= 1.5
        ? `y la suerte le suma ${fmt(s.luck)} pts: la tabla le favorece más de lo que juega; lo normal es que esa ventaja se vaya perdiendo.`
        : s.luck <= -1.5
        ? `y la mala suerte le quita ${fmt(-s.luck)} pts: merece más de lo que dice la tabla; si sigue generando igual, debería subir.`
        : "y la suerte está casi neutra: la tabla refleja bien lo que juega.";
    L.push(`${perf} ${luck}`);
  } else if (s.xgMatches < s.played) {
    L.push(`Faltan tiros/xG en ${s.played - s.xgMatches} partidos, así que no puedo separar del todo juego y suerte.`);
  }
  const ctx = s.causes.filter((c) => c.group === "when" && c.n >= 2 && !["comeback", "collapse"].includes(c.key));
  const top = [...ctx].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))[0];
  if (top && Math.abs(top.impact) >= 1.5) {
    L.push(
      `Donde más se nota: ${top.label.toLowerCase()} (${top.n} partidos) saca ${top.points} pts de ${fmt(top.expected)} esperados (${sgn(top.impact)}).` +
        (top.deserved !== null && Math.abs(top.points - top.deserved) >= 1.5
          ? ` Por juego merecía ${fmt(top.deserved)}, así que ahí ${top.points > top.deserved ? "también hay suerte" : "también hay mala suerte"}.`
          : "")
    );
  }
  const big = s.splits.find((x) => x.key === "big");
  const weak = s.splits.find((x) => x.key === "weak");
  if (big && weak && top?.key !== "vsBig" && top?.key !== "vsWeak") {
    const db = big.points - big.expected;
    const dw = weak.points - weak.expected;
    if (Math.abs(db - dw) >= 2) {
      L.push(
        db > dw
          ? `Rinde mejor contra los grandes (${sgn(db)}) que contra los débiles (${sgn(dw)}): se le atragantan los partidos que "debe" ganar.`
          : `Cumple contra los débiles (${sgn(dw)}) pero sufre contra los grandes (${sgn(db)}).`
      );
    }
  }
  const coll = s.causes.find((c) => c.key === "collapse");
  const comb = s.causes.find((c) => c.key === "comeback");
  if ((coll && coll.n >= 2) || (comb && comb.n >= 2)) {
    L.push(
      `En las segundas partes: ${comb ? `remontó ${comb.n} (${sgn(comb.impact)} pts)` : "no remontó ninguno"}, ${coll ? `se dejó remontar ${coll.n} (${sgn(coll.impact)} pts)` : "no se dejó remontar ninguno"}.`
    );
  }
  // Mayor caída de Elo
  let peak = s.eloStart;
  let peakDate = s.matches[0]?.date;
  let worst = { drop: 0, from: 0, to: 0, d1: "", d2: "", n: 0 };
  let peakIdx = -1;
  s.matches.forEach((m, i) => {
    if (m.eloAfter > peak) {
      peak = m.eloAfter;
      peakDate = m.date;
      peakIdx = i;
    }
    if (peak - m.eloAfter > worst.drop) worst = { drop: peak - m.eloAfter, from: peak, to: m.eloAfter, d1: peakDate ?? m.date, d2: m.date, n: i - peakIdx };
  });
  const d = s.eloNow - s.eloStart;
  L.push(
    `Su Elo ${Math.abs(d) < 10 ? "está igual que al empezar" : d > 0 ? `ha subido ${d} puntos` : `ha bajado ${-d} puntos`} (${s.eloStart} → ${s.eloNow}).` +
      (worst.drop >= 25 ? ` Su peor tramo: de ${worst.from} a ${worst.to} en ${worst.n} partidos (${worst.d1} → ${worst.d2}).` : "")
  );
  if (s.played < 8) L.push(`Ojo: con ${s.played} partidos todavía hay mucho ruido; mira las tendencias, no los decimales.`);
  return L;
}
