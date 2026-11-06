import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODELS } from "../../convex/lib/narrative";

/**
 * Llamadas a la IA (Gemini o Claude, según Ajustes) con respuesta JSON de esquema fijo.
 * Solo en el servidor: las claves vienen de las variables de entorno.
 */

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function callClaude(model: string, system: string, prompt: string, schema: Record<string, unknown>) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new HttpError(503, "Falta ANTHROPIC_API_KEY en las variables de entorno de Vercel.");
  if (!CLAUDE_MODELS.includes(model)) model = CLAUDE_MODELS[0];
  const client = new Anthropic({ apiKey });
  const params = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: "user" as const, content: prompt }],
    output_config: {
      effort: "medium" as const,
      format: { type: "json_schema" as const, schema },
    },
  };
  try {
    // Opus/Sonnet: si un filtro de seguridad rechaza la petición, la API la repite
    // sola con otro modelo (fallbacks "default"). Haiku no lo admite.
    const res =
      model === "claude-haiku-5-5"
        ? await client.messages.create(params)
        : await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    if (res.stop_reason === "refusal") throw new HttpError(422, "Claude rechazó analizar este texto.");
    if (res.stop_reason === "max_tokens") throw new HttpError(502, "La respuesta de Claude se cortó; prueba con una narración más corta.");
    const out = res.content.find((b) => b.type === "text");
    if (!out || out.type !== "text") throw new HttpError(502, "Claude no devolvió texto.");
    return { raw: JSON.parse(out.text), model: res.model ?? model };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(401, "La clave de Anthropic no es válida.");
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, "Claude: límite de peticiones alcanzado, prueba en un minuto.");
    if (err instanceof Anthropic.APIError) throw new HttpError(502, `Error de Claude (${err.status}): ${err.message}`);
    throw err;
  }
}

export async function callGemini(model: string, system: string, prompt: string, schema: Record<string, unknown>) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new HttpError(503, "Falta GEMINI_API_KEY en las variables de entorno de Vercel.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const call = (withSchema: boolean) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: withSchema ? system : `${system}\n\nDevuelve SOLO un JSON que cumpla este JSON Schema:\n${JSON.stringify(schema)}`,
            },
          ],
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          ...(withSchema ? { responseJsonSchema: schema } : {}),
          temperature: 0.2,
        },
      }),
    });

  let res = await call(true);
  // Algunos modelos no aceptan el esquema estricto: reintentamos con el esquema en el prompt
  if (res.status === 400) res = await call(false);
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    if (res.status === 401 || res.status === 403) throw new HttpError(401, "La clave de Gemini no es válida o no tiene permiso.");
    if (res.status === 404) throw new HttpError(400, `El modelo de Gemini "${model}" no existe; cámbialo en Ajustes.`);
    if (res.status === 429) throw new HttpError(429, "Gemini: límite de peticiones alcanzado, prueba en un minuto.");
    throw new HttpError(502, `Error de Gemini (${res.status}): ${detail}`);
  }
  const json = await res.json();
  const out: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  if (!out) throw new HttpError(502, "Gemini no devolvió respuesta (puede que la bloqueara un filtro).");
  const cleaned = out.replace(/^```(?:json)?\s*|\s*```$/g, "");
  return { raw: JSON.parse(cleaned), model };
}

/** Llama al proveedor elegido en Ajustes y devuelve el JSON y el modelo usado. */
export async function callAi(
  settings: { provider: "gemini" | "claude"; geminiModel: string; claudeModel: string },
  system: string,
  prompt: string,
  schema: Record<string, unknown>
) {
  return settings.provider === "claude"
    ? callClaude(settings.claudeModel, system, prompt, schema)
    : callGemini(settings.geminiModel, system, prompt, schema);
}
