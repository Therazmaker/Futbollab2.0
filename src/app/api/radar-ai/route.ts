import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { callAi, HttpError } from "@/lib/aiCall";
import { PREVIEW_SCHEMA, PREVIEW_SYSTEM, previewPrompt, normalizePreview } from "../../../../convex/lib/preview";
import { ruleSchema, ruleSystem, rulePrompt } from "../../../../convex/lib/ruleAi";
import { thesisSchema, thesisSystem, thesisPrompt, learnSchema, learnSystem } from "../../../../convex/lib/thesisAi";
import { isValidPick } from "../../../../convex/lib/picks";
import { validateRule, type Condition } from "../../../../convex/lib/features";
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
  const convex = new ConvexHttpClient(convexUrl);
  // Traducir una regla del Detector (no necesita partido)
  if (body?.action === "rule") {
    try {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (text.length < 10) return NextResponse.json({ error: "Escribe la regla con un poco más de detalle." }, { status: 422 });
      const settings = await convex.query(api.narratives.getAiSettings, {});
      const { raw, model } = await callAi(settings, ruleSystem(), rulePrompt(text, typeof body.context === "string" ? body.context.slice(0, 3000) : undefined), ruleSchema() as unknown as Record<string, unknown>);
      const conditions: Condition[] = (Array.isArray(raw?.conditions) ? raw.conditions : [])
        .map((c: any) => ({ feature: String(c?.feature ?? ""), op: c?.op === "<=" || c?.op === "=" ? c.op : ">=", value: Number(c?.value) }))
        .slice(0, 6);
      const teamName = typeof raw?.teamName === "string" ? raw.teamName.trim() : "";
      const team = teamName ? await convex.query(api.rules.resolveTeam, { name: teamName }) : null;
      const rule = {
        name: typeof raw?.name === "string" ? raw.name.slice(0, 80) : "Regla",
        teamName,
        team,
        conditions,
        target: typeof raw?.target === "string" ? raw.target : "draw",
        manualChecks: Array.isArray(raw?.manualChecks) ? raw.manualChecks.filter((x: unknown) => typeof x === "string").slice(0, 6) : [],
        explanation: typeof raw?.explanation === "string" ? raw.explanation.slice(0, 600) : "",
      };
      const errors = validateRule({ conditions, target: rule.target, teamScoped: !!team });
      if (teamName && !team) errors.unshift(`No encuentro el equipo "${teamName}" en la base.`);
      return NextResponse.json({ ok: true, rule, errors, model });
    } catch (err: any) {
      const status = err instanceof HttpError ? err.status : 500;
      return NextResponse.json({ error: err?.message ?? String(err) }, { status });
    }
  }
  // Aprender de las tesis resueltas → reglas nuevas (inactivas) probadas en el histórico
  if (body?.action === "learn") {
    try {
      const theses = await convex.query(api.theses.thesesForLearning, {});
      if (theses.length < 3) return NextResponse.json({ error: `Hacen falta al menos 3 tesis resueltas (tienes ${theses.length}).` }, { status: 422 });
      const settings = await convex.query(api.narratives.getAiSettings, {});
      const { raw, model } = await callAi(
        settings,
        learnSystem(),
        `TESIS RESUELTAS (${theses.length}):\n${theses
          .map((t, i) => `${i + 1}. ${t.match}\n   Tesis: ${t.thesis}\n   Pronóstico: ${t.prediction} → ${t.verdict === "won" ? "ACERTÓ" : "FALLÓ"}\n   Razones: ${t.reasons.join("; ")}`)
          .join("\n")}`,
        learnSchema() as unknown as Record<string, unknown>
      );
      const rules = [];
      for (const r of (Array.isArray(raw?.rules) ? raw.rules : []).slice(0, 3)) {
        const teamName = typeof r?.teamName === "string" ? r.teamName.trim() : "";
        const team = teamName ? await convex.query(api.rules.resolveTeam, { name: teamName }) : null;
        if (teamName && !team) continue;
        const conditions = (Array.isArray(r?.conditions) ? r.conditions : []).map((c: any) => ({ feature: String(c?.feature ?? ""), op: c?.op === "<=" || c?.op === "=" ? c.op : ">=", value: Number(c?.value) }));
        if (validateRule({ conditions, target: String(r?.target ?? ""), teamScoped: !!team }).length) continue;
        rules.push({
          name: String(r?.name ?? "Regla aprendida").slice(0, 80),
          text: `Aprendida de tus tesis: ${String(r?.basedOn ?? "").slice(0, 400)}`,
          teamId: team?._id,
          conditions,
          target: String(r.target),
          manualChecks: Array.isArray(r?.manualChecks) ? r.manualChecks.filter((x: unknown) => typeof x === "string") : [],
        });
      }
      const ids = rules.length ? await convex.mutation(api.theses.saveLearnedRules, { rules }) : [];
      for (const ruleId of ids) await convex.action(api.rules.runBacktest, { ruleId });
      return NextResponse.json({ ok: true, summary: typeof raw?.summary === "string" ? raw.summary : "", created: ids.length, model });
    } catch (err: any) {
      const status = err instanceof HttpError ? err.status : 500;
      return NextResponse.json({ error: err?.message ?? String(err) }, { status });
    }
  }
  const matchId = body?.matchId as Id<"matches"> | undefined;
  if (!matchId) return NextResponse.json({ error: "Falta el partido" }, { status: 400 });
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
    if (body.action === "thesis") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (text.length < 15) return NextResponse.json({ error: "Cuéntale un poco más: qué ves y qué crees que va a pasar." }, { status: 422 });
      const context = [
        `${ctx.home} vs ${ctx.away} · ${ctx.date} · ${ctx.competition}`,
        `1X2 (${ctx.fair ? "mercado + correcciones" : "modelo"}): ${Math.round(ctx.probs.home * 100)}% / ${Math.round(ctx.probs.draw * 100)}% / ${Math.round(ctx.probs.away * 100)}% · modelo solo ${Math.round(ctx.modelProbs.home * 100)}/${Math.round(ctx.modelProbs.draw * 100)}/${Math.round(ctx.modelProbs.away * 100)}`,
        ctx.odds ? `Cuotas: ${ctx.odds.home} / ${ctx.odds.draw} / ${ctx.odds.away}` : "Sin cuotas",
        ...ctx.reading,
        `Bajas: ${ctx.home}: ${ctx.absences.home.join(", ") || "ninguna"} · ${ctx.away}: ${ctx.absences.away.join(", ") || "ninguna"}`,
        `Narraciones ${ctx.home}: ${ctx.trends.home.join(" ") || "sin datos"}`,
        `Narraciones ${ctx.away}: ${ctx.trends.away.join(" ") || "sin datos"}`,
        ctx.preview ? `Previa: ${ctx.preview.summary}` : "",
      ].filter(Boolean).join("\n");
      const { raw, model } = await callAi(settings, thesisSystem(), thesisPrompt(context, text), thesisSchema() as unknown as Record<string, unknown>);
      const market = String(raw?.market ?? "");
      const pick = String(raw?.pick ?? "");
      if (!isValidPick(market, pick)) throw new HttpError(502, "La IA no entendió bien el pronóstico; prueba a decirlo más claro (p. ej. «el Sevilla no gana»).");
      const r = raw?.rule ?? {};
      const teamName = typeof r?.teamName === "string" ? r.teamName.trim() : "";
      const team = teamName ? await convex.query(api.rules.resolveTeam, { name: teamName }) : null;
      const conditions = (Array.isArray(r?.conditions) ? r.conditions : []).map((c: any) => ({ feature: String(c?.feature ?? ""), op: c?.op === "<=" || c?.op === "=" ? c.op : ">=", value: Number(c?.value) }));
      const ruleOk = conditions.length > 0 && (!teamName || team) && !validateRule({ conditions, target: String(r?.target ?? ""), teamScoped: !!team }).length;
      const c = Number(raw?.confidence);
      const saved = await convex.mutation(api.theses.saveThesis, {
        matchId,
        text,
        market,
        pick,
        confidence: Number.isFinite(c) ? Math.min(0.99, Math.max(0.01, c > 1 ? c / 100 : c)) : undefined,
        reasons: Array.isArray(raw?.reasons) ? raw.reasons.filter((x: unknown) => typeof x === "string").slice(0, 8) : [],
        feedback: typeof raw?.feedback === "string" ? raw.feedback : "",
        model: `${settings.provider}:${model}`,
        rule: ruleOk
          ? { name: String(r.name ?? "Regla de mi tesis"), teamId: team?._id, conditions, target: String(r.target), manualChecks: Array.isArray(r.manualChecks) ? r.manualChecks.filter((x: unknown) => typeof x === "string") : [] }
          : undefined,
      });
      if (saved.ruleId) await convex.action(api.rules.runBacktest, { ruleId: saved.ruleId });
      return NextResponse.json({ ok: true, ...saved, model });
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
