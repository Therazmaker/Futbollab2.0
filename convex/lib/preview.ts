/**
 * "Radar Analysis Editor": la previa del partido (noticias, crónica previa, rueda
 * de prensa…) leída por la IA. Los mismos campos y señales que el editor del
 * FutbolLab viejo, pero extraídos por la IA en vez de contar palabras clave.
 */

export type Level = "low" | "medium" | "high";
export type Lean = "home" | "away" | "neutral";

export interface PreviewAnalysis {
  structured: {
    matchContext: string;
    recentForm: string;
    psychologicalNarrative: string;
    tacticalFactors: string;
    streaks: string;
    newsEnvironment: string;
    keyPlayers: string;
    absences: string;
  };
  signals: {
    narrativeFavours: Lean;
    momentumHome: Level;
    momentumAway: Level;
    drawSignal: Level;
    upsetAlert: Level;
    emotionalFactors: Level;
    motivationGap: Lean;
  };
  /** Bajas que la previa menciona (nombre + equipo) */
  absentPlayers: Array<{ name: string; team: "home" | "away"; status: "out" | "doubt" }>;
  summary: string;
}

export const PREVIEW_FIELDS: Array<[keyof PreviewAnalysis["structured"], string]> = [
  ["matchContext", "Contexto del partido"],
  ["recentForm", "Forma reciente"],
  ["psychologicalNarrative", "Narrativa psicológica"],
  ["tacticalFactors", "Factores tácticos"],
  ["streaks", "Rachas"],
  ["newsEnvironment", "Noticias / entorno"],
  ["keyPlayers", "Jugadores clave"],
  ["absences", "Bajas"],
];

const LEVEL = { type: "string", enum: ["low", "medium", "high"] } as const;
const LEAN = { type: "string", enum: ["home", "away", "neutral"] } as const;
const STR = { type: "string" } as const;

export const PREVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["structured", "signals", "absentPlayers", "summary"],
  properties: {
    structured: {
      type: "object",
      additionalProperties: false,
      required: PREVIEW_FIELDS.map(([k]) => k),
      properties: Object.fromEntries(PREVIEW_FIELDS.map(([k]) => [k, STR])),
    },
    signals: {
      type: "object",
      additionalProperties: false,
      required: ["narrativeFavours", "momentumHome", "momentumAway", "drawSignal", "upsetAlert", "emotionalFactors", "motivationGap"],
      properties: {
        narrativeFavours: LEAN,
        momentumHome: LEVEL,
        momentumAway: LEVEL,
        drawSignal: LEVEL,
        upsetAlert: LEVEL,
        emotionalFactors: LEVEL,
        motivationGap: { ...LEAN, description: "Qué equipo tiene MÁS en juego (o neutral)" },
      },
    },
    absentPlayers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "team", "status"],
        properties: { name: STR, team: { type: "string", enum: ["home", "away"] }, status: { type: "string", enum: ["out", "doubt"] } },
      },
    },
    summary: { type: "string", description: "2-3 frases en español" },
  },
} as const;

export const PREVIEW_SYSTEM = `Eres analista de fútbol. Te paso la PREVIA de un partido (noticias, crónica previa, declaraciones).
Rellena cada campo con lo que dice el texto, en español y en una o dos frases; si el texto no dice nada de un campo, déjalo vacío.
Señales:
- narrativeFavours: a quién favorece el relato de la previa (no las cuotas).
- momentumHome/Away: estado anímico y de forma que transmite la previa.
- drawSignal: si la previa sugiere un partido cerrado / de empate.
- upsetAlert: si hay motivos concretos para una sorpresa del no favorito.
- emotionalFactors: presión, nervios, derbi, despedidas, crisis…
- motivationGap: quién se juega más.
absentPlayers: solo jugadores que la previa da como baja (out) o duda (doubt).
"home" es siempre el equipo local indicado. No inventes nada que no esté en el texto.`;

export function previewPrompt(ctx: { home: string; away: string; date: string; competition: string }, text: string) {
  return `Partido: ${ctx.home} (local, "home") vs ${ctx.away} (visitante, "away")
Fecha: ${ctx.date} · Competición: ${ctx.competition}

PREVIA:
${text}`;
}

const lvl = (v: unknown): Level => (v === "low" || v === "medium" || v === "high" ? v : "low");
const lean = (v: unknown): Lean => (v === "home" || v === "away" ? v : "neutral");
const s = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function normalizePreview(raw: any): PreviewAnalysis {
  if (!raw || typeof raw !== "object") throw new Error("La IA no devolvió un JSON válido.");
  const st = raw.structured ?? {};
  const sg = raw.signals ?? {};
  return {
    structured: Object.fromEntries(PREVIEW_FIELDS.map(([k]) => [k, s(st[k])])) as PreviewAnalysis["structured"],
    signals: {
      narrativeFavours: lean(sg.narrativeFavours),
      momentumHome: lvl(sg.momentumHome),
      momentumAway: lvl(sg.momentumAway),
      drawSignal: lvl(sg.drawSignal),
      upsetAlert: lvl(sg.upsetAlert),
      emotionalFactors: lvl(sg.emotionalFactors),
      motivationGap: lean(sg.motivationGap),
    },
    absentPlayers: (Array.isArray(raw.absentPlayers) ? raw.absentPlayers : [])
      .slice(0, 20)
      .map((p: any) => ({ name: s(p?.name, 60), team: p?.team === "away" ? "away" : "home", status: p?.status === "doubt" ? "doubt" : "out" }))
      .filter((p: { name: string }) => p.name.length >= 2),
    summary: s(raw.summary, 800),
  } as PreviewAnalysis;
}

/** Narrativa frente a datos (lo que el editor viejo llamaba "consistencia / conflicto"). */
export function compareWithData(a: PreviewAnalysis, probs: { home: number; away: number }) {
  const dataFavours: Lean = Math.abs(probs.home - probs.away) < 0.08 ? "neutral" : probs.home > probs.away ? "home" : "away";
  const n = a.signals.narrativeFavours;
  const consistency = n === "neutral" || dataFavours === "neutral" ? "medium" : n === dataFavours ? "high" : "low";
  return { dataFavours, narrativeFavours: n, consistency };
}

/** Señales de la previa que se miden en Entrenamiento (como el "poder predictivo de señales" del viejo). */
export const PREVIEW_SIGNAL_TESTS: Array<{ key: string; label: string; active: (a: PreviewAnalysis) => boolean; event: string }> = [
  { key: "draw_high", label: "Previa: señal de empate alta", active: (a) => a.signals.drawSignal === "high", event: "draw" },
  { key: "upset_high", label: "Previa: alerta de sorpresa alta", active: (a) => a.signals.upsetAlert === "high", event: "underdog_not_lose" },
  { key: "narr_home", label: "Previa: el relato favorece al local", active: (a) => a.signals.narrativeFavours === "home", event: "home" },
  { key: "narr_away", label: "Previa: el relato favorece al visitante", active: (a) => a.signals.narrativeFavours === "away", event: "away" },
  { key: "emotional_high", label: "Previa: factores emocionales altos", active: (a) => a.signals.emotionalFactors === "high", event: "over25" },
];
