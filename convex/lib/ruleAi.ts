/**
 * Traductor de reglas: lo que dices con tus palabras → condiciones sobre datos
 * del catálogo (lib/features.ts). Lo que no se puede medir con datos va a
 * "manualChecks" (se revisa a mano en cada partido que cumpla el resto).
 */
import { featureCatalog, TARGETS } from "./features";

export function ruleSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["name", "teamName", "conditions", "target", "manualChecks", "explanation"],
    properties: {
      name: { type: "string", description: "Nombre corto de la regla (3-6 palabras)" },
      teamName: { type: "string", description: "Equipo concreto al que se refiere la regla, o cadena vacía si es general" },
      conditions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["feature", "op", "value"],
          properties: {
            feature: { type: "string", enum: Object.keys(featureCatalog()) },
            op: { type: "string", enum: [">=", "<=", "="] },
            value: { type: "number" },
          },
        },
      },
      target: { type: "string", enum: Object.keys(TARGETS) },
      manualChecks: { type: "array", items: { type: "string" }, description: "Lo que no se puede medir con los datos disponibles" },
      explanation: { type: "string", description: "1-2 frases en español: cómo has traducido la regla" },
    },
  } as const;
}

export function ruleSystem() {
  const cat = featureCatalog();
  return `Traduces reglas de un aficionado al fútbol a condiciones sobre datos. Responde en español.
Solo puedes usar estos datos (nombre → significado). Probabilidades en 0–1; goles y xG por partido; conteos enteros:
${Object.entries(cat)
  .map(([k, d]) => `- ${k}: ${d}`)
  .join("\n")}

Objetivos posibles (qué predice la regla):
${Object.entries(TARGETS)
  .map(([k, d]) => `- ${k}: ${d}`)
  .join("\n")}

Reglas de traducción:
- Si la regla habla de UN equipo concreto, pon su nombre en teamName y usa team_ (ese equipo) y opp_ (su rival). Si es general, teamName = "" y usa fav_/dog_ o home_/away_ (nunca team_/opp_).
- Convierte expresiones vagas en umbrales razonables y dilos en la explicación ("recibe mucho" → ga10 >= 1.6; "empata mucho" → draws10 >= 4; "llega cansado" → rest <= 3 o midweek = 1; "último partido le metieron 3" → ga_last >= 3).
- "No van a jugar para ganar / se conforman" → normalmente draw o under25 (elige el que mejor encaje y explícalo).
- Lo que NO esté en los datos (derbis, rotaciones, entrenador nuevo, clima, motivación, alineaciones) va a manualChecks como una frase corta; no lo inventes con otros datos.
- Pocas condiciones (1–4). No añadas condiciones que el usuario no dijo.`;
}

export function rulePrompt(text: string, context?: string) {
  return `${context ? `CONTEXTO (partido que inspiró la regla):\n${context}\n\n` : ""}REGLA DEL USUARIO:\n${text}`;
}
