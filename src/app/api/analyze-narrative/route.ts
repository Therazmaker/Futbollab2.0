import { NextRequest, NextResponse } from "next/server";
import { callAi, HttpError } from "@/lib/aiCall";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { NARRATIVE_SCHEMA, NARRATIVE_SYSTEM, narrativePrompt, normalizeAnalysis } from "../../../../convex/lib/narrative";

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
    const { raw, model } = await callAi(settings, NARRATIVE_SYSTEM, narrativePrompt(ctx, text), NARRATIVE_SCHEMA as unknown as Record<string, unknown>);
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

