"use client";

import React, { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PICK_MARKETS, pickLabel } from "../../convex/lib/picks";

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)} %`);

/** Predicciones del partido: la de la IA y "Mi pronóstico", guardadas antes y resueltas solas después. */
export function PredictionsSheet({
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
  const picks = useQuery(api.radarAi.getPicks, { matchId }) ?? [];
  const settings = useQuery(api.narratives.getAiSettings);
  const save = useMutation(api.radarAi.savePicks);
  const del = useMutation(api.radarAi.deletePicks);
  const [tab, setTab] = useState<"ai" | "user">("ai");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, { pick: string; odds: string; conf: string }>>({});
  const [editingMine, setEditingMine] = useState(false);

  const ai = picks.filter((p: any) => p.source === "ai");
  const mine = picks.filter((p: any) => p.source === "user");

  const askAi = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/radar-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "predict", matchId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const openMine = () => {
    const f: typeof form = {};
    for (const p of mine as any[]) f[p.market] = { pick: p.pick, odds: p.odds ? String(p.odds) : "", conf: p.confidence ? String(Math.round(p.confidence * 100)) : "" };
    setForm(f);
    setEditingMine(true);
  };
  const saveMine = async () => {
    setBusy(true);
    setError(null);
    try {
      const rows = Object.entries(form)
        .filter(([, v]) => v.pick)
        .map(([market, v]) => ({
          market,
          pick: v.pick,
          odds: v.odds.trim() ? Number(v.odds.replace(",", ".")) : undefined,
          confidence: v.conf.trim() ? Math.min(99, Math.max(1, Number(v.conf))) / 100 : undefined,
        }));
      if (!rows.length) await del({ matchId, source: "user" });
      else await save({ matchId, source: "user", picks: rows });
      setEditingMine(false);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const PickRow = ({ p }: { p: any }) => (
    <div className="flex flex-col border-b border-surface-container-high/40 py-1">
      <div className="flex justify-between items-center gap-2">
        <span className="text-on-surface-variant w-28 shrink-0">{(PICK_MARKETS as any)[p.market]?.label}</span>
        <span className="text-on-surface flex-1 truncate">{p.label}</span>
        {p.verdict && <span className={p.verdict === "won" ? "text-primary" : "text-error"}>{p.verdict === "won" ? "✓" : "✗"}</span>}
      </div>
      <div className="flex gap-3 text-[9px] text-on-surface-variant">
        {p.confidence !== undefined && <span>confianza {pct(p.confidence)}</span>}
        <span>Radar {pct(p.systemProb)}</span>
        {p.marketProb !== undefined && <span>mercado {pct(p.marketProb)}</span>}
        {p.odds && <span>@{p.odds}</span>}
      </div>
      {p.reasoning && <p className="text-[10px] text-on-surface-variant leading-snug">{p.reasoning}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain flex justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-surface-container-low border border-primary/40 rounded-2xl w-full max-w-md p-5 shadow-2xl my-auto flex flex-col gap-3 font-mono text-[11px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-bold text-on-surface font-sans">🧪 Predicciones</p>
            <p className="text-[10px] text-on-surface-variant">
              {homeName} vs {awayName}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-container text-on-surface-variant">
            ✕
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface-container">
          {(
            [
              ["ai", `🤖 IA (${ai.length})`],
              ["user", `✋ Mi pronóstico (${mine.length})`],
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`h-8 rounded-lg font-bold ${tab === k ? "bg-primary text-on-primary" : "text-on-surface-variant"}`}>
              {l}
            </button>
          ))}
        </div>

        {tab === "ai" && (
          <>
            {ai.length === 0 ? (
              <p className="text-on-surface-variant">
                {played
                  ? "Este partido se jugó sin predicción de la IA."
                  : `La IA (${settings?.provider === "claude" ? "Claude" : "Gemini"}) recibe todo lo que el Radar sabe: mercado, modelo, lectura, bajas, previa y tendencias de las narraciones. Devuelve un pick por mercado con su probabilidad.`}
              </p>
            ) : (
              ai.map((p: any) => <PickRow key={p._id} p={p} />)
            )}
            {!played && (
              <button onClick={askAi} disabled={busy} className="self-start px-3 h-8 rounded-lg bg-primary text-on-primary font-bold disabled:opacity-50">
                {busy ? "Pensando…" : ai.length ? "Volver a pedir" : "🤖 Pedir predicción a la IA"}
              </button>
            )}
          </>
        )}

        {tab === "user" && (
          <>
            {!editingMine ? (
              <>
                {mine.length === 0 ? (
                  <p className="text-on-surface-variant">
                    {played ? "No apuntaste pronóstico para este partido." : "Apunta tu intuición ANTES del partido. Se mide igual que la IA: acierto, ROI y CLV frente al mercado."}
                  </p>
                ) : (
                  mine.map((p: any) => <PickRow key={p._id} p={p} />)
                )}
                {!played && (
                  <button onClick={openMine} className="self-start px-3 h-8 rounded-lg bg-primary text-on-primary font-bold">
                    {mine.length ? "Editar mi pronóstico" : "✋ Apuntar mi pronóstico"}
                  </button>
                )}
              </>
            ) : (
              <>
                {Object.entries(PICK_MARKETS).map(([market, def]) => {
                  const v = form[market] ?? { pick: "", odds: "", conf: "" };
                  const set = (patch: Partial<typeof v>) => setForm({ ...form, [market]: { ...v, ...patch } });
                  return (
                    <div key={market} className="flex flex-col gap-1 border-b border-surface-container-high/40 pb-1.5">
                      <span className="text-[10px] text-on-surface-variant uppercase">{def.label}</span>
                      <div className="flex flex-wrap gap-1">
                        {def.picks.map((p) => (
                          <button
                            key={p}
                            onClick={() => set({ pick: v.pick === p ? "" : p })}
                            className={`px-2 h-7 rounded-lg text-[10px] ${v.pick === p ? "bg-primary text-on-primary font-bold" : "bg-surface-container text-on-surface-variant"}`}
                          >
                            {pickLabel(market, p, homeName, awayName)}
                          </button>
                        ))}
                      </div>
                      {v.pick && (
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            inputMode="decimal"
                            value={v.odds}
                            onChange={(e) => set({ odds: e.target.value })}
                            placeholder={market === "result" ? "cuota (o usa la del Radar)" : "cuota (opcional)"}
                            className="h-7 px-2 rounded-lg bg-surface-container text-on-surface border border-surface-container-high text-[10px]"
                          />
                          <input
                            inputMode="numeric"
                            value={v.conf}
                            onChange={(e) => set({ conf: e.target.value })}
                            placeholder="confianza % (opcional)"
                            className="h-7 px-2 rounded-lg bg-surface-container text-on-surface border border-surface-container-high text-[10px]"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setEditingMine(false)} className="px-3 h-8 rounded-lg text-on-surface-variant">
                    Cancelar
                  </button>
                  <button onClick={saveMine} disabled={busy} className="px-3 h-8 rounded-lg bg-primary text-on-primary font-bold disabled:opacity-50">
                    {busy ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {error && <p className="text-error">{error}</p>}
        <p className="text-[9px] text-on-surface-variant">
          Se resuelven solas al llegar el marcador (y el del descanso para los mercados de 1ª parte). «Radar» = la probabilidad que el Radar daba a ese
          pick: si aciertas más que eso, le estás ganando.
        </p>
      </div>
    </div>
  );
}
