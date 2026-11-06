/**
 * Lectura de narraciones de partido con IA.
 *
 * La IA solo LEE la narración y devuelve señales con un formato fijo (JSON).
 * Lo que hacemos con ellas (tendencias por equipo, favorito/underdog) se calcula
 * aquí, con código, para que sea reproducible y no dependa del modelo.
 */

export type Side = "home" | "away";

/** Ajustes por defecto de la IA (se cambian desde el botón de ajustes). */
export const AI_DEFAULTS = {
  provider: "gemini" as "gemini" | "claude",
  geminiModel: "gemini-2.5-flash",
  claudeModel: "claude-opus-5-5",
};
export const CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

export interface TeamSignals {
  /** Ocasiones claras creadas según la narración */
  clearChances: number;
  /** Cuánto del partido controló (0–100; los dos lados suman ~100) */
  dominance: number;
  finishing: "clinical" | "normal" | "wasteful";
  defending: "solid" | "normal" | "fragile";
  /** Qué hizo cuando fue ganando */
  afterLeading: "kept_pushing" | "eased_off" | "parked_bus" | "never_led";
  /** Qué hizo cuando fue perdiendo */
  afterTrailing: "reacted" | "no_reaction" | "never_trailed";
  intensity: "high" | "medium" | "low";
  keyPlayers: string[];
  notes: string;
}

export interface NarrativeEvent {
  minute: number;
  team: Side;
  type: "goal" | "big_chance" | "red_card" | "injury" | "penalty" | "tactical_change" | "other";
  player: string;
  note: string;
}

export interface NarrativeAnalysis {
  summary: string;
  periods: { range: string; dominant: Side | "even"; note: string }[];
  home: TeamSignals;
  away: TeamSignals;
  /** ¿El marcador refleja el partido? */
  scoreFairness: "fair" | "flattering_home" | "flattering_away";
  events: NarrativeEvent[];
}

const TEAM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["clearChances", "dominance", "finishing", "defending", "afterLeading", "afterTrailing", "intensity", "keyPlayers", "notes"],
  properties: {
    clearChances: { type: "integer", description: "Ocasiones claras creadas (incluye goles de ocasión clara)" },
    dominance: { type: "integer", description: "0-100, cuánto controló el partido este equipo" },
    finishing: { type: "string", enum: ["clinical", "normal", "wasteful"] },
    defending: { type: "string", enum: ["solid", "normal", "fragile"] },
    afterLeading: { type: "string", enum: ["kept_pushing", "eased_off", "parked_bus", "never_led"] },
    afterTrailing: { type: "string", enum: ["reacted", "no_reaction", "never_trailed"] },
    intensity: { type: "string", enum: ["high", "medium", "low"] },
    keyPlayers: { type: "array", items: { type: "string" } },
    notes: { type: "string", description: "1-2 frases en español sobre cómo jugó" },
  },
} as const;

/** JSON Schema de la respuesta (lo usan Claude y Gemini). */
export const NARRATIVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "periods", "home", "away", "scoreFairness", "events"],
  properties: {
    summary: { type: "string", description: "3-4 frases en español: cómo fue el partido de verdad" },
    periods: {
      type: "array",
      description: "Tramos del partido (p. ej. 0-15, 15-30, 30-45, 45-60, 60-75, 75-90)",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["range", "dominant", "note"],
        properties: {
          range: { type: "string" },
          dominant: { type: "string", enum: ["home", "away", "even"] },
          note: { type: "string" },
        },
      },
    },
    home: TEAM_SCHEMA,
    away: TEAM_SCHEMA,
    scoreFairness: { type: "string", enum: ["fair", "flattering_home", "flattering_away"] },
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["minute", "team", "type", "player", "note"],
        properties: {
          minute: { type: "integer" },
          team: { type: "string", enum: ["home", "away"] },
          type: { type: "string", enum: ["goal", "big_chance", "red_card", "injury", "penalty", "tactical_change", "other"] },
          player: { type: "string" },
          note: { type: "string" },
        },
      },
    },
  },
} as const;

export interface NarrativeMatchContext {
  home: string;
  away: string;
  homeGoals?: number;
  awayGoals?: number;
  date: string;
  competition: string;
}

export const NARRATIVE_SYSTEM = `Eres analista táctico de fútbol. Te paso la narración (minuto a minuto o crónica) de un partido.
Léela entera y extrae cómo se jugó DE VERDAD, no solo el resultado:
- quién dominó cada tramo y por qué,
- ocasiones claras de cada equipo (no cuentes tiros lejanos sin peligro),
- si un equipo bajó el ritmo al ir ganando (eased_off) o se encerró (parked_bus), o siguió atacando,
- si reaccionó al ir perdiendo,
- si definió bien (clinical) o perdonó (wasteful), y si su defensa fue sólida o frágil,
- expulsiones, lesiones, penaltis y cambios tácticos importantes con su minuto,
- si el marcador refleja el partido o lo maquilla a favor de alguien.
Usa solo lo que dice la narración; si algo no aparece, usa el valor neutro ("normal", "medium", "never_led", 0).
"home" es siempre el equipo local indicado abajo, aunque la narración los nombre de otra forma.
Textos libres (summary, notes, note) en español y cortos.`;

export function narrativePrompt(ctx: NarrativeMatchContext, text: string) {
  const score = ctx.homeGoals !== undefined && ctx.awayGoals !== undefined ? `${ctx.homeGoals}-${ctx.awayGoals}` : "sin marcador registrado";
  return `Partido: ${ctx.home} (local, "home") vs ${ctx.away} (visitante, "away")
Fecha: ${ctx.date} · Competición: ${ctx.competition} · Resultado: ${score}

NARRACIÓN:
${text}`;
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
const int = (v: unknown, lo: number, hi: number, fallback = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const str = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function normalizeTeam(t: any): TeamSignals {
  return {
    clearChances: int(t?.clearChances, 0, 40),
    dominance: int(t?.dominance, 0, 100, 50),
    finishing: pick(t?.finishing, ["clinical", "normal", "wasteful"] as const, "normal"),
    defending: pick(t?.defending, ["solid", "normal", "fragile"] as const, "normal"),
    afterLeading: pick(t?.afterLeading, ["kept_pushing", "eased_off", "parked_bus", "never_led"] as const, "never_led"),
    afterTrailing: pick(t?.afterTrailing, ["reacted", "no_reaction", "never_trailed"] as const, "never_trailed"),
    intensity: pick(t?.intensity, ["high", "medium", "low"] as const, "medium"),
    keyPlayers: Array.isArray(t?.keyPlayers) ? t.keyPlayers.map((x: unknown) => str(x, 60)).filter(Boolean).slice(0, 6) : [],
    notes: str(t?.notes),
  };
}

/** Valida y limpia lo que devuelve la IA (sea cual sea el proveedor). */
export function normalizeAnalysis(raw: any): NarrativeAnalysis {
  if (!raw || typeof raw !== "object") throw new Error("La IA no devolvió un JSON válido.");
  const sides = ["home", "away"] as const;
  return {
    summary: str(raw.summary, 1200),
    periods: (Array.isArray(raw.periods) ? raw.periods : []).slice(0, 12).map((p: any) => ({
      range: str(p?.range, 20),
      dominant: pick(p?.dominant, ["home", "away", "even"] as const, "even"),
      note: str(p?.note, 200),
    })),
    home: normalizeTeam(raw.home),
    away: normalizeTeam(raw.away),
    scoreFairness: pick(raw.scoreFairness, ["fair", "flattering_home", "flattering_away"] as const, "fair"),
    events: (Array.isArray(raw.events) ? raw.events : []).slice(0, 40).map((e: any) => ({
      minute: int(e?.minute, 0, 130),
      team: pick(e?.team, sides, "home"),
      type: pick(e?.type, ["goal", "big_chance", "red_card", "injury", "penalty", "tactical_change", "other"] as const, "other"),
      player: str(e?.player, 60),
      note: str(e?.note, 200),
    })),
  };
}

// ---------- Tendencias por equipo ----------

export type Role = "favorite" | "underdog" | "even";

export interface TrendRow {
  side: Side;
  role: Role;
  goalsFor?: number;
  goalsAgainst?: number;
  analysis: NarrativeAnalysis;
}

/**
 * Papel del equipo antes del partido: por cuotas si las hay; si no, por la
 * diferencia de fuerza (ataque/defensa) con el local un poco favorecido.
 */
export function roleFor(
  side: Side,
  odds: { home?: number; away?: number } | undefined,
  strengthHome: number | null,
  strengthAway: number | null
): Role {
  let edge: number | null = null; // > 0: el local es favorito
  if (odds?.home && odds?.away) edge = Math.log(odds.away / odds.home);
  else if (strengthHome !== null && strengthAway !== null) edge = strengthHome - strengthAway + 0.15;
  if (edge === null || Math.abs(edge) < 0.25) return "even";
  const homeFav = edge > 0;
  return (side === "home") === homeFav ? "favorite" : "underdog";
}

export interface TeamTrends {
  matches: number;
  avgClearChancesFor: number;
  avgClearChancesAgainst: number;
  avgDominance: number;
  /** Veces que bajó el ritmo / se encerró al ir ganando, sobre los partidos en que fue ganando */
  easedOff: { count: number; of: number };
  reacted: { count: number; of: number };
  wasteful: number;
  clinical: number;
  fragile: number;
  solid: number;
  /** Marcador le favoreció / le perjudicó respecto a lo jugado */
  flattered: number;
  hardDone: number;
  asUnderdog: { matches: number; competitive: number; avgDominance: number };
  asFavorite: { matches: number; easedOff: number; avgDominance: number };
  insights: string[];
}

const avg = (xs: number[]) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : 0);

export function teamTrends(rows: TrendRow[]): TeamTrends {
  const own = (r: TrendRow) => r.analysis[r.side];
  const opp = (r: TrendRow) => r.analysis[r.side === "home" ? "away" : "home"];
  const led = rows.filter((r) => own(r).afterLeading !== "never_led");
  const trailed = rows.filter((r) => own(r).afterTrailing !== "never_trailed");
  const eased = (r: TrendRow) => own(r).afterLeading === "eased_off" || own(r).afterLeading === "parked_bus";
  const under = rows.filter((r) => r.role === "underdog");
  const fav = rows.filter((r) => r.role === "favorite");
  // Underdog "competitivo": no perdió, o controló al menos el 45% del partido
  const competitive = under.filter(
    (r) => (r.goalsFor !== undefined && r.goalsAgainst !== undefined && r.goalsFor >= r.goalsAgainst) || own(r).dominance >= 45
  );
  const flatteredMe = (r: TrendRow) => r.analysis.scoreFairness === (r.side === "home" ? "flattering_home" : "flattering_away");
  const flatteredOpp = (r: TrendRow) => r.analysis.scoreFairness === (r.side === "home" ? "flattering_away" : "flattering_home");

  const t: TeamTrends = {
    matches: rows.length,
    avgClearChancesFor: avg(rows.map((r) => own(r).clearChances)),
    avgClearChancesAgainst: avg(rows.map((r) => opp(r).clearChances)),
    avgDominance: avg(rows.map((r) => own(r).dominance)),
    easedOff: { count: led.filter(eased).length, of: led.length },
    reacted: { count: trailed.filter((r) => own(r).afterTrailing === "reacted").length, of: trailed.length },
    wasteful: rows.filter((r) => own(r).finishing === "wasteful").length,
    clinical: rows.filter((r) => own(r).finishing === "clinical").length,
    fragile: rows.filter((r) => own(r).defending === "fragile").length,
    solid: rows.filter((r) => own(r).defending === "solid").length,
    flattered: rows.filter(flatteredMe).length,
    hardDone: rows.filter(flatteredOpp).length,
    asUnderdog: { matches: under.length, competitive: competitive.length, avgDominance: avg(under.map((r) => own(r).dominance)) },
    asFavorite: { matches: fav.length, easedOff: fav.filter(eased).length, avgDominance: avg(fav.map((r) => own(r).dominance)) },
    insights: [],
  };

  // Solo decimos algo cuando se repite (≥ 2 veces y ≥ la mitad de los casos)
  const often = (a: number, b: number) => b >= 2 && a >= 2 && a / b >= 0.5;
  const I = t.insights;
  if (often(t.easedOff.count, t.easedOff.of))
    I.push(`Baja el ritmo o se encierra al ir ganando (${t.easedOff.count} de ${t.easedOff.of}): ojo con remontadas y con el +goles en vivo.`);
  if (often(t.asFavorite.easedOff, t.asFavorite.matches))
    I.push(`Como favorito va "sobrado": se relajó en ${t.asFavorite.easedOff} de ${t.asFavorite.matches}.`);
  if (often(t.asUnderdog.competitive, t.asUnderdog.matches))
    I.push(`Como underdog compite: ${t.asUnderdog.competitive} de ${t.asUnderdog.matches} sin perder o con ≥45% de control.`);
  if (often(t.wasteful, t.matches)) I.push(`Perdona mucho: definición pobre en ${t.wasteful} de ${t.matches}; genera más de lo que marca.`);
  if (often(t.clinical, t.matches)) I.push(`Muy eficiente arriba (${t.clinical} de ${t.matches}): puede estar marcando por encima de lo que genera.`);
  if (often(t.fragile, t.matches)) I.push(`Defensa frágil en ${t.fragile} de ${t.matches} partidos.`);
  if (often(t.flattered, t.matches)) I.push(`El marcador le ha favorecido ${t.flattered} veces: sus resultados exageran su nivel.`);
  if (often(t.hardDone, t.matches)) I.push(`Ha jugado mejor de lo que dice el marcador ${t.hardDone} veces: sus resultados lo infravaloran.`);
  if (often(t.reacted.count, t.reacted.of)) I.push(`Reacciona al ir perdiendo (${t.reacted.count} de ${t.reacted.of}).`);
  if (t.matches >= 3 && t.avgClearChancesFor - t.avgClearChancesAgainst >= 1.5)
    I.push(`Crea claramente más ocasiones claras de las que concede (${t.avgClearChancesFor} vs ${t.avgClearChancesAgainst}).`);
  if (t.matches >= 3 && t.avgClearChancesAgainst - t.avgClearChancesFor >= 1.5)
    I.push(`Concede más ocasiones claras de las que crea (${t.avgClearChancesAgainst} vs ${t.avgClearChancesFor}).`);
  return t;
}
