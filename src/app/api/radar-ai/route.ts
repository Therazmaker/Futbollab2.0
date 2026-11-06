import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { callAi, HttpError } from "@/lib/aiCall";
import { PREVIEW_SCHEMA, PREVIEW_SYSTEM, previewPrompt, normalizePreview } from "../../../../convex/lib/preview";
import { AI_PREDICT_SCHEMA, AI_PREDICT_SYSTEM, aiPredictPrompt, normalizeAiPicks } from "../../../../convex/lib/aiPredict";

export const runtime = "nodejs";
export const maxDuration = 120;

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || "https://exciting-blackbird-312.convex.cloud";

/**
 * IA del Radar:
 *  - action "preview": lee la previa pegada (Radar Analysis Editor) y la guarda.
 *  - action "predict": pide a la IA sus picks para el partido y los guarda.
 * Ambas solo antes de que el partido tenga marcador.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la petición no válido" }, { status: 400 });
  }
  const matchId = body?.matchId as Id<"matches"> | undefined;
  if (!matchId) return NextResponse.json({ error: "Falta el partido" }, { status: 400 });
  const convex = new ConvexHttpClient(convexUrl);
  const [settings, ctx] = await Promise.all([
    convex.query(api.narratives.getAiSettings, {}),
    convex.query(api.radarAi.aiContext, { matchId }),
  ]);
  if (!ctx) return NextResponse.json({ error: "Partido no encontrado" }, { status: 404 });
  if (ctx.scored) return NextResponse.json({ error: "El partido ya tiene marcador: esto se hace antes de jugarse." }, { status: 409 });

  try {
    if (body.action === "preview") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (text.length < 120) return NextResponse.json({ error: "La previa es muy corta: pega la noticia o la crónica previa completa." }, { status: 422 });
      if (text.length > 80_000) return NextResponse.json({ error: "La previa es demasiado larga (máx. 80.000 caracteres)." }, { status: 422 });
      const { raw, model } = await callAi(
        settings,
        PREVIEW_SYSTEM,
        previewPrompt({ home: ctx.home, away: ctx.away, date: ctx.date, competition: ctx.competition }, text),
        PREVIEW_SCHEMA as unknown as Record<string, unknown>
      );
      const analysis = normalizePreview(raw);
      await convex.mutation(api.radarAi.savePreview, { matchId, text, provider: settings.provider, model, analysis });
      return NextResponse.json({ ok: true, analysis, model });
    }
    if (body.action === "predict") {
      const { raw, model } = await callAi(settings, AI_PREDICT_SYSTEM, aiPredictPrompt(ctx), AI_PREDICT_SCHEMA as unknown as Record<string, unknown>);
      const out = normalizeAiPicks(raw);
      if (!out.picks.length) throw new HttpError(502, "La IA no devolvió picks válidos.");
      await convex.mutation(api.radarAi.savePicks, {
        matchId,
        source: "ai",
        model: `${settings.provider}:${model}`,
        picks: out.picks.map((p, i) => ({
          ...p,
          // El resumen y las advertencias van en el razonamiento del primer pick (1X2)
          reasoning: i === 0 && (out.summary || out.warnings.length) ? `${p.reasoning}${out.summary ? ` · ${out.summary}` : ""}${out.warnings.length ? ` · ⚠ ${out.warnings.join(" · ")}` : ""}`.slice(0, 1200) : p.reasoning,
        })),
      });
      return NextResponse.json({ ok: true, ...out, model });
    }
    return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: err?.message ?? String(err) }, { status });
  }
}
