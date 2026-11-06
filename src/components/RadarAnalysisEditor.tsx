"use client";

import React, { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PREVIEW_FIELDS } from "../../convex/lib/preview";

const LEVEL: Record<string, string> = { low: "BAJO", medium: "MEDIO", high: "ALTO" };
const LEVEL_CLS: Record<string, string> = {
  low: "bg-surface-container-high text-on-surface-variant",
  medium: "bg-amber-900/40 text-amber-300",
  high: "bg-error/20 text-error",
};
const CONS: Record<string, string> = { high: "ALTA", medium: "MEDIA", low: "BAJA" };

/** "Radar Analysis Editor" del FutbolLab viejo: la previa pegada, leída por la IA. */
export function RadarAnalysisEditor({
  matchId,
  homeName,
  awayName,
  played,
  onClose,
}: {
  matchId: Id<"matches">;
  homeName: string;
  awayName: string;
  played: boolean;
  onClose: () => void;
}) {
  const saved = useQuery(api.radarAi.getPreview, { matchId });
  const settings = useQuery(api.narratives.getAiSettings);
  const remove = useMutation(api.radarAi.deletePreview);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = text !== null || (saved === null && !played);
  const value = text ?? saved?.text ?? "";
  const side = (s: string) => (s === "home" ? homeName : s === "away" ? awayName : "Neutral");

  const process = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/radar-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", matchId, text: value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
      setText(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const a = saved?.analysis;
  const sig = a?.signals;
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain flex justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-surface-container-low border border-primary/40 rounded-2xl w-full max-w-md p-5 shadow-2xl my-auto flex flex-col gap-3 font-mono text-[11px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-bold text-on-surface font-sans">📝 Análisis previo</p>
            <p className="text-[10px] text-on-surface-variant">
              {homeName} vs {awayName}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-container text-on-surface-variant">
            ✕
          </button>
        </div>

        {editing && !played ? (
          <>
            <p className="text-[10px] text-on-surface-variant">
              Pega la previa: noticias, crónica previa, rueda de prensa… La IA ({settings?.provider === "claude" ? "Claude" : "Gemini"}) saca el
              contexto, las bajas y las señales, y se compara con los números del Radar. Se guarda antes del partido para poder medir si acierta.
            </p>
            <textarea
              value={value}
              onChange={(e) => setText(e.target.value)}
              rows={9}
              placeholder="Pega aquí la previa del partido…"
              className="w-full p-2 rounded-lg bg-surface-container text-on-surface border border-surface-container-high"
            />
            <div className="flex justify-between items-center gap-2">
              <span className="text-[10px] text-on-surface-variant">{value.length.toLocaleString()} caracteres</span>
              <div className="flex gap-2">
                {saved && (
                  <button onClick={() => setText(null)} className="px-3 h-8 rounded-lg text-on-surface-variant">
                    Cancelar
                  </button>
                )}
                <button
                  onClick={process}
                  disabled={busy || value.trim().length < 120}
                  className="px-3 h-8 rounded-lg bg-primary text-on-primary font-bold disabled:opacity-50"
                >
                  {busy ? "Procesando…" : "✨ Procesar"}
                </button>
              </div>
            </div>
          </>
        ) : !a ? (
          <p className="text-on-surface-variant">Este partido ya se jugó y no tenía previa guardada.</p>
        ) : null}
        {error && <p className="text-error">{error}</p>}

        {a && text === null && (
          <>
            <p className="text-on-surface leading-snug text-[12px] font-sans">{a.summary}</p>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase text-secondary font-bold">Señales extraídas</span>
              {(
                [
                  ["Favoritismo narrativo", side(sig.narrativeFavours), null],
                  [`Momentum ${homeName}`, LEVEL[sig.momentumHome], sig.momentumHome],
                  [`Momentum ${awayName}`, LEVEL[sig.momentumAway], sig.momentumAway],
                  ["Señal de empate", LEVEL[sig.drawSignal], sig.drawSignal],
                  ["Alerta de sorpresa", LEVEL[sig.upsetAlert], sig.upsetAlert],
                  ["Factores emocionales", LEVEL[sig.emotionalFactors], sig.emotionalFactors],
                  ["Más en juego", side(sig.motivationGap), null],
                ] as Array<[string, string, string | null]>
              ).map(([k, v, lv]) => (
                <div key={k} className="flex justify-between items-center border-b border-surface-container-high/40 py-0.5">
                  <span className="text-on-surface-variant">{k}</span>
                  <span className={`px-1.5 rounded text-[10px] font-bold ${lv ? LEVEL_CLS[lv] : "text-on-surface"}`}>{v}</span>
                </div>
              ))}
            </div>

            {saved?.comparison && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase text-secondary font-bold">Comparación con los datos del sistema</span>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">La narrativa favorece</span>
                  <b className="text-on-surface">{side(saved.comparison.narrativeFavours)}</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Los números favorecen</span>
                  <b className="text-on-surface">{side(saved.comparison.dataFavours)}</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Consistencia</span>
                  <b className={saved.comparison.consistency === "low" ? "text-error" : saved.comparison.consistency === "high" ? "text-primary" : "text-amber-300"}>
                    {CONS[saved.comparison.consistency]}
                  </b>
                </div>
                {saved.comparison.consistency === "low" && (
                  <p className="text-[10px] text-on-surface-variant">
                    La previa cuenta una historia distinta a la de los números. Interesante para estudiar; en Histórico se mide si la previa acierta
                    más que el mercado.
                  </p>
                )}
              </div>
            )}

            {a.absentPlayers.length > 0 && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase text-secondary font-bold">Bajas que menciona</span>
                {a.absentPlayers.map((p: any, i: number) => (
                  <span key={i} className="text-on-surface">
                    {p.status === "doubt" ? "❓" : "🩹"} {p.name} <span className="text-on-surface-variant">({side(p.team)}{p.status === "doubt" ? ", duda" : ""})</span>
                  </span>
                ))}
                <span className="text-[9px] text-on-surface-variant">
                  Para que cuenten en las probabilidades, regístralas en el perfil del jugador (Reportar lesión).
                </span>
              </div>
            )}

            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase text-secondary font-bold">Campos estructurados</span>
              {PREVIEW_FIELDS.filter(([k]) => a.structured[k]).map(([k, label]) => (
                <p key={k} className="text-on-surface-variant">
                  <span className="text-on-surface">{label}:</span> {a.structured[k]}
                </p>
              ))}
            </div>

            <div className="flex justify-between items-center text-[9px] text-on-surface-variant">
              <span>
                {saved!.provider === "claude" ? "Claude" : "Gemini"} · {saved!.model}
              </span>
              {!played && (
                <span className="flex gap-3">
                  <button onClick={() => setText(saved!.text)} className="text-secondary">
                    Editar previa
                  </button>
                  <button onClick={() => confirm("¿Borrar el análisis previo?") && remove({ matchId })} className="text-error">
                    Borrar
                  </button>
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
