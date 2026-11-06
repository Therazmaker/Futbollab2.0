import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  CLAUDE_MODELS,
  NARRATIVE_SCHEMA,
  NARRATIVE_SYSTEM,
  NarrativeMatchContext,
  narrativePrompt,
  normalizeAnalysis,
} from "../../../../convex/lib/narrative";

export const runtime = "nodejs";
export const maxDuration = 120;

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || "https://exciting-blackbird-312.convex.cloud";
const MAX_CHARS = 120_000; // ~30k tokens: de sobra para un minuto a minuto completo

/** Qué claves hay configuradas (sin revelar su valor), para la pantalla de ajustes. */
export async function GET() {
  return NextResponse.json({
    gemini: !!process.env.GEMINI_API_KEY,
    claude: !!process.env.ANTHROPIC_API_KEY,
  });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la petición no válido" }, { status: 400 });
  }
  const matchId = body?.matchId as Id<"matches"> | undefined;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!matchId) return NextResponse.json({ error: "Falta el partido" }, { status: 400 });
  if (text.length < 200) return NextResponse.json({ error: "La narración es muy corta: pega el minuto a minuto o la crónica completa." }, { status: 422 });
  if (text.length > MAX_CHARS)
    return NextResponse.json({ error: `La narración es demasiado larga (${text.length} caracteres, máximo ${MAX_CHARS}).` }, { status: 422 });

  const convex = new ConvexHttpClient(convexUrl);
  const [settings, ctx] = await Promise.all([
    convex.query(api.narratives.getAiSettings, {}),
    convex.query(api.narratives.matchContext, { matchId }),
  ]);
  if (!ctx) return NextResponse.json({ error: "Partido no encontrado" }, { status: 404 });

  try {
    const { raw, model } =
      settings.provider === "claude"
        ? await analyzeWithClaude(ctx, text, settings.claudeModel)
        : await analyzeWithGemini(ctx, text, settings.geminiModel);
    const analysis = normalizeAnalysis(raw);
    await convex.mutation(api.narratives.saveNarrative, {
      matchId,
      text,
      provider: settings.provider,
      model,
      analysis,
    });
    return NextResponse.json({ ok: true, provider: settings.provider, model, analysis });
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: err?.message ?? String(err) }, { status });
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function analyzeWithClaude(ctx: NarrativeMatchContext, text: string, model: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new HttpError(503, "Falta ANTHROPIC_API_KEY en las variables de entorno de Vercel.");
  if (!CLAUDE_MODELS.includes(model)) model = CLAUDE_MODELS[0];
  const client = new Anthropic({ apiKey });
  const params = {
    model,
    max_tokens: 16000,
    system: NARRATIVE_SYSTEM,
    messages: [{ role: "user" as const, content: narrativePrompt(ctx, text) }],
    output_config: {
      effort: "medium" as const,
      format: { type: "json_schema" as const, schema: NARRATIVE_SCHEMA as unknown as Record<string, unknown> },
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

async function analyzeWithGemini(ctx: NarrativeMatchContext, text: string, model: string) {
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
              text: withSchema
                ? NARRATIVE_SYSTEM
                : `${NARRATIVE_SYSTEM}\n\nDevuelve SOLO un JSON que cumpla este JSON Schema:\n${JSON.stringify(NARRATIVE_SCHEMA)}`,
            },
          ],
        },
        contents: [{ role: "user", parts: [{ text: narrativePrompt(ctx, text) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          ...(withSchema ? { responseJsonSchema: NARRATIVE_SCHEMA } : {}),
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
