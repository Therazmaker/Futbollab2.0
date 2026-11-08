/**
 * IA de "Mi tesis": entiende lo que ves de un partido, lo convierte en
 * pronóstico, te da su opinión con los datos y lo generaliza en una regla.
 * Y, con tus tesis resueltas, aprende reglas mejores.
 */
import { PICK_MARKETS } from "./picks";
import { ruleSchema, ruleSystem } from "./ruleAi";

const RULE = (() => {
  const r = ruleSchema() as any;
  return { ...r, required: r.required.filter((k: string) => k !== "explanation"), properties: Object.fromEntries(Object.entries(r.properties).filter(([k]) => k !== "explanation")) };
})();

export function thesisSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["market", "pick", "confidence", "reasons", "feedback", "rule"],
    properties: {
      market: { type: "string", enum: Object.keys(PICK_MARKETS) },
      pick: { type: "string", description: "home|draw|away|home_draw|away_draw|home_away|yes|no|none según el mercado" },
      confidence: { type: "number", description: "Confianza del usuario 0-1 si la dice; si no, tu estimación de la suya" },
      reasons: { type: "array", items: { type: "string" }, description: "Las razones del usuario en frases cortas" },
      feedback: { type: "string", description: "Tu opinión honesta con los datos: qué apoya la tesis, qué la contradice y si el mercado ya lo descuenta. 3-5 frases." },
      rule: RULE,
    },
  } as const;
}

export function thesisSystem() {
  const markets = Object.entries(PICK_MARKETS)
    .map(([k, d]) => `- ${k} (${d.label}): ${d.picks.join(" | ")}`)
    .join("\n");
  return `Eres el compañero de análisis de un apostador de fútbol. Te escribe su TESIS sobre un partido: lo que ve y lo que cree que va a pasar.
Haz cuatro cosas, en español:
1) Su pronóstico en uno de estos mercados (elige el que mejor encaje con lo que dice):
${markets}
2) Sus razones, en frases cortas y con sus palabras.
3) Tu opinión honesta usando los DATOS DEL PARTIDO que te paso: qué apoya su tesis, qué la contradice y si el mercado ya lo tiene en cuenta (las cuotas ya reflejan la tabla, las rachas y las noticias públicas). No le des la razón por darla.
4) Generaliza su tesis en una REGLA reutilizable para otros partidos (campo "rule"), con estas instrucciones:

${ruleSystem()}`;
}

export function thesisPrompt(context: string, text: string) {
  return `DATOS DEL PARTIDO (lo que sabe FutbolLab):\n${context}\n\nTESIS DEL USUARIO:\n${text}`;
}

export function learnSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "rules"],
    properties: {
      summary: { type: "string", description: "Qué has aprendido de sus tesis: en qué acierta, en qué falla. 3-5 frases." },
      rules: {
        type: "array",
        items: { ...RULE, required: [...RULE.required, "basedOn"], properties: { ...RULE.properties, basedOn: { type: "string", description: "En qué tesis te basas" } } },
        description: "Hasta 3 reglas nuevas o mejoradas",
      },
    },
  } as const;
}

export function learnSystem() {
  return `Eres el compañero de análisis de un apostador de fútbol. Te paso sus TESIS ya resueltas (lo que vio antes del partido, su pronóstico y si acertó).
Busca lo que se REPITE en sus aciertos y lo que hay en sus fallos, y propone hasta 3 reglas reutilizables que capturen lo mejor de su intuición
(combinando razones que aparecen en varias tesis acertadas y evitando las condiciones de las falladas). Sé honesto en el resumen: con pocas tesis,
dilo. Cada regla con estas instrucciones:

${ruleSystem()}`;
}
