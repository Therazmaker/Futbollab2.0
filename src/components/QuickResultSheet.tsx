"use client";

import React, { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { NarrativePanel } from "./NarrativePanel";

const input = "w-14 h-10 text-center rounded-lg bg-surface-container text-on-surface border border-surface-container-high text-lg font-bold";

/**
 * Registrar un partido desde el Radar, sin salir: marcador (y descanso opcional)
 * y, en la misma hoja, la narración con su análisis y el registro de jugadores.
 */
export function QuickResultSheet({
  match,
  onClose,
}: {
  match: { _id: Id<"matches">; home: { name: string }; away: { name: string }; result: { home: number; away: number } | null; halfTime?: { home: number; away: number } | null };
  onClose: () => void;
}) {
  const save = useMutation(api.teams.setMatchScore);
  const [f, setF] = useState({
    h: match.result ? String(match.result.home) : "",
    a: match.result ? String(match.result.away) : "",
    hh: match.halfTime ? String(match.halfTime.home) : "",
    ha: match.halfTime ? String(match.halfTime.away) : "",
  });
  const [saved, setSaved] = useState(!!match.result);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = (s: string) => (s.trim() === "" ? undefined : Number(s));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (n(f.h) === undefined || n(f.a) === undefined) return setError("Pon los goles de los dos equipos.");
    if ((n(f.hh) === undefined) !== (n(f.ha) === undefined)) return setError("El descanso: pon los dos o ninguno.");
    setBusy(true);
    setError(null);
    try {
      await save({ matchId: match._id, homeGoals: n(f.h)!, awayGoals: n(f.a)!, htHome: n(f.hh), htAway: n(f.ha) });
      setSaved(true);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain flex justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface-container-low border border-primary/40 rounded-2xl w-full max-w-md p-5 shadow-2xl my-auto flex flex-col gap-3 font-mono text-[11px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <p className="text-sm font-bold text-on-surface font-sans">✓ Registrar resultado</p>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-container text-on-surface-variant">
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-2">
          <div className="grid grid-cols-[1fr_auto_auto_auto_1fr] items-center gap-2">
            <span className="text-right text-on-surface font-bold font-sans text-xs truncate">{match.home.name}</span>
            <input inputMode="numeric" value={f.h} onChange={(e) => setF({ ...f, h: e.target.value })} className={input} aria-label="Goles local" autoFocus={!match.result} />
            <span className="text-on-surface-variant">-</span>
            <input inputMode="numeric" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })} className={input} aria-label="Goles visitante" />
            <span className="text-on-surface font-bold font-sans text-xs truncate">{match.away.name}</span>
          </div>
          <div className="flex items-center justify-center gap-2 text-[10px] text-on-surface-variant">
            Descanso (opcional)
            <input inputMode="numeric" value={f.hh} onChange={(e) => setF({ ...f, hh: e.target.value })} className="w-10 h-8 text-center rounded-lg bg-surface-container text-on-surface border border-surface-container-high" aria-label="Descanso local" />
            -
            <input inputMode="numeric" value={f.ha} onChange={(e) => setF({ ...f, ha: e.target.value })} className="w-10 h-8 text-center rounded-lg bg-surface-container text-on-surface border border-surface-container-high" aria-label="Descanso visitante" />
          </div>
          {error && <p className="text-error text-center">{error}</p>}
          <button type="submit" disabled={busy} className="h-9 rounded-lg bg-primary text-on-primary font-bold disabled:opacity-50">
            {busy ? "Guardando…" : saved ? "Actualizar marcador" : "Guardar marcador"}
          </button>
          {saved && (
            <p className="text-primary text-center text-[10px]">
              ✓ Guardado: tabla, fuerza y Entrenamiento actualizados. Si tienes la narración, pégala abajo; si no, cierra y pasa al siguiente.
            </p>
          )}
        </form>

        {saved && <NarrativePanel matchId={match._id} homeName={match.home.name} awayName={match.away.name} />}

        {saved && (
          <button onClick={onClose} className="h-9 rounded-lg bg-surface-container-high text-on-surface font-bold">
            Listo · siguiente partido
          </button>
        )}
      </div>
    </div>
  );
}
