"use client";

import React, { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { featureCatalog } from "../../convex/lib/features";

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)} %`);
const CATALOG = featureCatalog();
const OPS: Record<string, string> = { ">=": "≥", "<=": "≤", "=": "=" };
const condText = (c: any) => `${CATALOG[c.feature] ?? c.feature} ${OPS[c.op] ?? c.op} ${/_prob$/.test(c.feature) ? `${Math.round(c.value * 100)} %` : c.value}`;

/** Regla propuesta (de una tesis o aprendida) con su resultado en el histórico y el botón para activarla. */
export function ProposedRule({ rule }: { rule: any }) {
  const setActive = useMutation(api.rules.setActive);
  const bt = rule.backtest;
  return (
    <div className="flex flex-col gap-1 p-2 rounded-lg border border-secondary/30 bg-surface-container">
      <span className="text-[10px] uppercase text-secondary font-bold">Regla que la IA saca de tu idea</span>
      <span className="text-on-surface font-bold">{rule.name}</span>
      <div className="text-[10px] text-on-surface-variant">
        {rule.conditions.map((c: any, i: number) => (
          <div key={i}>• {condText(c)}</div>
        ))}
        {rule.manualChecks.map((m: string, i: number) => (
          <div key={`m${i}`}>✋ Revisar a mano: {m}</div>
        ))}
        <div className="text-on-surface">→ {rule.targetLabel}</div>
      </div>
      <p className="text-[10px] text-on-surface-variant">
        {!bt
          ? "Probándola en el histórico…"
          : bt.n === 0
          ? "En el histórico no se dio nunca (quizá es muy específica)."
          : `En el histórico: ${bt.n} veces, pasó ${pct(bt.rate)} (margen ${pct(bt.ci.low)}–${pct(bt.ci.high)})${bt.market !== null ? ` · el mercado esperaba ${pct(bt.market)}` : ""}${bt.roi !== null ? ` · ROI ${bt.roi >= 0 ? "+" : ""}${(bt.roi * 100).toFixed(1)} %` : ""}`}
      </p>
      <button
        onClick={() => setActive({ ruleId: rule._id, active: !rule.active })}
        className={`self-start px-3 h-7 rounded-lg text-[10px] font-bold ${rule.active ? "bg-surface-container-high text-on-surface-variant" : "bg-primary text-on-primary"}`}
      >
        {rule.active ? "✓ Activa en el Detector (pausar)" : "Activar en el Detector"}
      </button>
    </div>
  );
}

/** "Mi tesis": lo que ves en el partido y lo que crees que pasará; la IA lo entiende, opina y lo convierte en regla. */
export function ThesisSheet({ matchId, homeName, awayName, played, onClose }: { matchId: Id<"matches">; homeName: string; awayName: string; played: boolean; onClose: () => void }) {
  const theses = useQuery(api.theses.getTheses, { matchId });
  const del = useMutation(api.theses.deleteThesis);
  const [text, setText] = useState("");
  const [rewrite, setRewrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = theses?.[0];

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/radar-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "thesis", matchId, text }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
      setRewrite(false);
      setText("");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain flex justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface-container-low border border-error/40 rounded-2xl w-full max-w-md p-5 shadow-2xl my-auto flex flex-col gap-3 font-mono text-[11px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm font-bold text-on-surface font-sans">💬 Mi tesis</p>
            <p className="text-[10px] text-on-surface-variant">
              {homeName} vs {awayName}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-container text-on-surface-variant">
            ✕
          </button>
        </div>

        {(!t || rewrite) && !played && (
          <>
            <p className="text-[10px] text-on-surface-variant leading-snug">
              Escribe lo que ves y lo que crees que va a pasar, como me lo dirías a mí. La IA lo convierte en tu pronóstico, te dice qué lo apoya y qué
              no con los datos, y lo generaliza en una regla que se prueba con el histórico. Si aciertas, actívala y el Detector la buscará en los próximos
              partidos.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="Ej.: El City llega de Champions, el Forest se encierra y sale a la contra; con Delap en forma creo que el City no gana."
              className="w-full p-2 rounded-lg bg-surface-container text-on-surface border border-surface-container-high"
            />
            <div className="flex justify-end gap-2">
              {t && (
                <button onClick={() => setRewrite(false)} className="px-3 h-8 rounded-lg text-on-surface-variant">
                  Cancelar
                </button>
              )}
              <button onClick={send} disabled={busy || text.trim().length < 15} className="px-3 h-8 rounded-lg bg-primary text-on-primary font-bold disabled:opacity-50">
                {busy ? "La IA lo está pensando…" : "Enviar a la IA"}
              </button>
            </div>
          </>
        )}
        {!t && played && <p className="text-on-surface-variant">Este partido se jugó sin tesis.</p>}
        {error && <p className="text-error">{error}</p>}

        {t && !rewrite && (
          <>
            <p className="text-on-surface italic leading-snug">«{t.text}»</p>
            <div className="flex items-center justify-between p-2 rounded-lg bg-surface-container">
              <span className="text-on-surface font-bold">
                Tu pronóstico: {t.label}
                {t.confidence ? <span className="text-on-surface-variant font-normal"> · confianza {pct(t.confidence)}</span> : null}
              </span>
              {t.verdict && <span className={t.verdict === "won" ? "text-primary font-bold" : "text-error font-bold"}>{t.verdict === "won" ? `✓ ${t.score}` : `✗ ${t.score}`}</span>}
            </div>
            {t.reasons.length > 0 && (
              <div className="text-[10px] text-on-surface-variant">
                <span className="uppercase text-secondary font-bold">Tus razones</span>
                {t.reasons.map((r: string, i: number) => (
                  <div key={i}>• {r}</div>
                ))}
              </div>
            )}
            <div className="text-[11px] text-on-surface leading-snug">
              <span className="text-[10px] uppercase text-secondary font-bold block">Lo que ve la IA</span>
              {t.feedback}
            </div>
            {t.rule && <ProposedRule rule={t.rule} />}
            {t.verdict === "won" && t.rule && !t.rule.active && <p className="text-primary text-[10px]">¡Acertaste! Si la regla te convence, actívala para que el Detector la busque.</p>}
            {t.verdict === "lost" && (
              <p className="text-[10px] text-on-surface-variant">No salió. Sirve igual: «🧠 Aprender de mis tesis» también usa los fallos para no repetirlos.</p>
            )}
            {!played && (
              <div className="flex gap-3 text-[10px]">
                <button onClick={() => { setText(t.text); setRewrite(true); }} className="text-secondary">
                  Reescribir
                </button>
                <button onClick={() => confirm("¿Borrar la tesis?") && del({ thesisId: t._id })} className="text-error">
                  Borrar
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Resumen de tus tesis y el botón para que la IA aprenda de ellas (cabecera del Audaz). */
export function ThesesSummary() {
  const theses = useQuery(api.theses.getTheses, {}) ?? [];
  const rules = useQuery(api.rules.listRules) ?? [];
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const won = theses.filter((t: any) => t.verdict === "won").length;
  const lost = theses.filter((t: any) => t.verdict === "lost").length;
  const learned = rules.filter((r: any) => r.origin === "learned");
  const learn = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/radar-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "learn" }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
      setMsg(`${json.summary}${json.created ? ` · ${json.created} regla${json.created === 1 ? "" : "s"} nueva${json.created === 1 ? "" : "s"} (abajo, probadas en el histórico).` : " · No encontró reglas nuevas que se puedan medir."}`);
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="p-2.5 rounded-xl border border-secondary/30 bg-surface-container-low font-mono text-[11px] flex flex-col gap-1.5">
      <div className="flex justify-between items-center gap-2">
        <span className="text-on-surface font-bold">
          💬 Mis tesis: {theses.length}
          <span className="text-on-surface-variant font-normal">
            {" "}
            · ✓{won} ✗{lost} · {theses.length - won - lost} pendientes
          </span>
        </span>
        <button onClick={learn} disabled={busy || won + lost < 3} className="shrink-0 px-2.5 h-7 rounded-lg bg-secondary text-on-secondary font-bold text-[10px] disabled:opacity-40">
          {busy ? "Aprendiendo…" : "🧠 Aprender de mis tesis"}
        </button>
      </div>
      {won + lost < 3 && <p className="text-[10px] text-on-surface-variant">Con 3 tesis resueltas la IA ya puede buscar lo que se repite en tus aciertos.</p>}
      {msg && <p className="text-[10px] text-on-surface leading-snug">{msg}</p>}
      {learned.slice(0, 3).map((r: any) => (
        <ProposedRule key={r._id} rule={r} />
      ))}
    </div>
  );
}
