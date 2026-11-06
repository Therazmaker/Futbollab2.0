/**
 * Predicción de la IA para un partido (los 7 mercados del "Entrenamiento del
 * Radar" del FutbolLab viejo). La app le pasa todo lo que sabe; la IA devuelve
 * picks con una confianza que es una PROBABILIDAD (0–1), para poder calibrarla.
 */

const PICK = (values: string[]) =>
  ({
    type: "object",
    additionalProperties: false,
    required: ["pick", "confidence", "reasoning"],
    properties: {
      pick: { type: "string", enum: values },
      confidence: { type: "number", description: "Probabilidad (0-1) de que este pick salga" },
      reasoning: { type: "string", description: "Una frase en español" },
    },
  }) as const;

export const AI_PREDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["markets", "summary", "warnings"],
  properties: {
    markets: {
      type: "object",
      additionalProperties: false,
      required: ["result", "btts", "over15", "over25", "cleanSheet", "htGoalless", "htResult"],
      properties: {
        result: PICK(["home", "draw", "away"]),
        btts: PICK(["yes", "no"]),
        over15: PICK(["yes", "no"]),
        over25: PICK(["yes", "no"]),
        cleanSheet: PICK(["home", "away", "none"]),
        htGoalless: PICK(["yes", "no"]),
        htResult: PICK(["home", "draw", "away"]),
      },
    },
    summary: { type: "string", description: "2-3 frases en español" },
    warnings: { type: "array", items: { type: "string" }, description: "Incongruencias o riesgos" },
  },
} as const;

export const AI_PREDICT_SYSTEM = `Eres analista de fútbol y de mercados de apuestas. Te paso los datos de un partido tal como los ve FutbolLab.
Para cada mercado elige un pick y da "confidence" como la PROBABILIDAD real (0-1) de que salga, no como entusiasmo.
Reglas:
- Las probabilidades del Radar ya parten del mercado (las cuotas) y en el histórico el mercado acierta más que cualquier modelo.
  Solo aléjate de ellas si hay información concreta (bajas, previa, tendencias de las narraciones) que lo justifique, y dilo en el razonamiento.
- Una racha de 5 partidos o la tabla sola NO justifican alejarse: el mercado ya las ha visto.
- Sé breve y concreto. Español.`;

export interface AiContext {
  home: string;
  away: string;
  date: string;
  competition: string;
  probs: Record<string, number>;
  modelProbs: { home: number; draw: number; away: number };
  fair: { home: number; draw: number; away: number } | null;
  odds: { home?: number; draw?: number; away?: number } | null;
  expectedGoals: { home: number; away: number };
  reading: string[];
  absences: { home: string[]; away: string[] };
  preview: { summary: string; signals: Record<string, string>; structured: Record<string, string> } | null;
  trends: { home: string[]; away: string[] };
}

export function aiPredictPrompt(c: AiContext) {
  const p = (x: number | undefined) => (x === undefined ? "—" : `${Math.round(x * 100)} %`);
  const P = c.probs;
  return `Partido: ${c.home} (local) vs ${c.away} (visitante) · ${c.date} · ${c.competition}

PROBABILIDADES DEL RADAR (${c.fair ? "mercado + correcciones" : "solo modelo, sin cuotas"}):
1X2: ${p(P.home)} / ${p(P.draw)} / ${p(P.away)} · Modelo solo: ${p(c.modelProbs.home)} / ${p(c.modelProbs.draw)} / ${p(c.modelProbs.away)}
${c.odds ? `Cuotas: ${c.odds.home ?? "—"} / ${c.odds.draw ?? "—"} / ${c.odds.away ?? "—"}` : "Sin cuotas"}
Goles esperados: ${c.expectedGoals.home} - ${c.expectedGoals.away} · +1.5 ${p(P.over15)} · +2.5 ${p(P.over25)} · ambos marcan ${p(P.btts)}
Portería a cero: local ${p(P.homeCleanSheet)} · visitante ${p(P.awayCleanSheet)}
Descanso: ${p(P.htHome)} / ${p(P.htDraw)} / ${p(P.htAway)} · 0-0 al descanso ${p(P.htGoalless)}

LECTURA:
${c.reading.map((l) => `- ${l}`).join("\n")}

BAJAS REGISTRADAS: ${c.home}: ${c.absences.home.join(", ") || "ninguna"} · ${c.away}: ${c.absences.away.join(", ") || "ninguna"}

TENDENCIAS DE LAS NARRACIONES:
${c.home}: ${c.trends.home.join(" ") || "sin datos"}
${c.away}: ${c.trends.away.join(" ") || "sin datos"}

PREVIA: ${
    c.preview
      ? `${c.preview.summary}\nSeñales: ${Object.entries(c.preview.signals)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}\n${Object.entries(c.preview.structured)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")}`
      : "no hay"
  }`;
}

export function normalizeAiPicks(raw: any) {
  const M = raw?.markets ?? {};
  const allowed: Record<string, string[]> = {
    result: ["home", "draw", "away"],
    btts: ["yes", "no"],
    over15: ["yes", "no"],
    over25: ["yes", "no"],
    cleanSheet: ["home", "away", "none"],
    htGoalless: ["yes", "no"],
    htResult: ["home", "draw", "away"],
  };
  const picks: Array<{ market: string; pick: string; confidence: number; reasoning: string }> = [];
  for (const [market, vals] of Object.entries(allowed)) {
    const m = M[market];
    if (!m || !vals.includes(m.pick)) continue;
    const c = Number(m.confidence);
    picks.push({
      market,
      pick: m.pick,
      confidence: Number.isFinite(c) ? Math.min(0.99, Math.max(0.01, c > 1 ? c / 100 : c)) : 0.5,
      reasoning: typeof m.reasoning === "string" ? m.reasoning.slice(0, 300) : "",
    });
  }
  return {
    picks,
    summary: typeof raw?.summary === "string" ? raw.summary.slice(0, 800) : "",
    warnings: Array.isArray(raw?.warnings) ? raw.warnings.filter((w: unknown) => typeof w === "string").slice(0, 6) : [],
  };
}
