"use client";

import React, { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { COMPETITIONS } from "@/lib/competitions";
import { parseResults, parseFixtures } from "@/lib/parse-results";

type Preview = {
  recognized: number;
  unmatched: string[];
  added: number;
  updated: number;
  unchanged: number;
  rows: Array<{ date: string; homeName: string; awayName: string; homeGoals: number; awayGoals: number }>;
};

/** Pegar una lista de resultados (una jornada o la temporada) y guardarlos de golpe. */
export function BulkResultsSheet({ defaultCompetition, onClose }: { defaultCompetition: string; onClose: () => void }) {
  const bulk = useMutation(api.results.addResultsBulk);
  const bulkFixtures = useMutation(api.results.addFixturesBulk);
  const [mode, setMode] = useState<"results" | "fixtures">("results");
  const [competition, setCompetition] = useState(
    COMPETITIONS.some((c) => c.code === defaultCompetition) ? defaultCompetition : "laliga"
  );
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseResults(text, date), [text, date]);
  const parsedFx = useMemo(() => parseFixtures(text, date), [text, date]);
  const count = mode === "results" ? parsed.rows.length : parsedFx.rows.length;

  const run = async (dry: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r: any =
        mode === "results"
          ? await bulk({ competition, preview: dry, rows: parsed.rows })
          : await bulkFixtures({ competition, preview: dry, rows: parsedFx.rows }).then((x) => ({
              ...x,
              updated: 0,
              unchanged: x.existing,
              rows: x.rows.map((rr) => ({ ...rr, homeGoals: null, awayGoals: null })),
            }));
      if (dry) setPreview(r);
      else {
        setDone(r);
        setPreview(null);
        setText("");
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain flex justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-surface-container-low border border-primary/40 rounded-2xl w-full max-w-md p-5 shadow-2xl my-auto flex flex-col gap-3 font-mono text-xs">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-on-surface font-sans">{mode === "results" ? "Pegar resultados" : "Pegar próximos partidos"}</span>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-container text-on-surface-variant">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface-container">
          {(
            [
              ["results", "Resultados"],
              ["fixtures", "Próximos partidos"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => {
                setMode(k);
                setPreview(null);
                setDone(null);
              }}
              className={`h-8 rounded-lg font-bold ${mode === k ? "bg-primary text-on-primary" : "text-on-surface-variant"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] text-on-surface-variant uppercase">
            Competición
            <select
              value={competition}
              onChange={(e) => {
                setCompetition(e.target.value);
                setPreview(null);
              }}
              className="w-full h-9 px-2 mt-0.5 rounded-lg bg-surface-container text-on-surface border border-surface-container-high normal-case"
            >
              {COMPETITIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] text-on-surface-variant uppercase">
            Fecha si no viene
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full h-9 px-2 mt-0.5 rounded-lg bg-surface-container text-on-surface border border-surface-container-high"
            />
          </label>
        </div>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
            setDone(null);
          }}
          rows={9}
          placeholder={
            mode === "results"
              ? "Pega la jornada (Sofascore, FlashScore, tabla…). Ejemplos:\n2026-11-07 Valencia 1-2 Real Madrid\n08/11 Betis 2-2 Sevilla"
              : "Pega los próximos partidos. Ejemplos:\n2026-11-25 Real Madrid - Liverpool\n26/11 21:00 Inter vs Barcelona"
          }
          className="w-full p-2 rounded-lg bg-surface-container text-on-surface border border-surface-container-high text-[11px]"
        />
        <p className="text-[10px] text-on-surface-variant">
          {count} partidos leídos
          {(mode === "results" ? parsed.skipped : parsedFx.skipped).length
            ? ` · ${(mode === "results" ? parsed.skipped : parsedFx.skipped).length} líneas sin entender`
            : ""}
          .{" "}
          {mode === "results"
            ? "Los partidos que ya existan solo reciben el marcador; no se duplican."
            : "Entran sin marcador, con su foto previa en el Radar. Los cinco grandes ligas llegan solas con «Actualizar jornadas»; esto es para la Champions y demás."}
        </p>

        {preview && (
          <div className="flex flex-col gap-1.5 p-2 rounded-lg border border-secondary/30 bg-surface-container">
            <span className="text-secondary font-bold">
              {preview.recognized} de {parsed.rows.length} partidos con los dos equipos reconocidos
            </span>
            {preview.unmatched.length > 0 && (
              <p className="text-tertiary text-[10px]">
                No encuentro: {preview.unmatched.join(", ")}. Créalos antes o escribe el nombre como sale en la app; esos
                partidos se saltan.
              </p>
            )}
            <div className="max-h-40 overflow-y-auto flex flex-col">
              {preview.rows.map((r, i) => (
                <div key={i} className="flex gap-2 text-[10px] border-t border-surface-container-high/40 py-0.5">
                  <span className="text-on-surface-variant">{r.date}</span>
                  <span className="text-on-surface truncate">
                    {r.homeName} {r.homeGoals === null ? "vs" : `${r.homeGoals}-${r.awayGoals}`} {r.awayName}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {done && (
          <p className="text-primary">
            Listo: {done.added} nuevos{mode === "results" ? `, ${done.updated} con marcador actualizado` : ""}, {done.unchanged} ya estaban.
            {mode === "results" ? " Tabla y fuerza recalculadas." : " Ya salen en el Radar."}
          </p>
        )}
        {error && <p className="text-error">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 h-8 rounded-lg text-on-surface-variant">
            Cerrar
          </button>
          {!preview ? (
            <button
              onClick={() => run(true)}
              disabled={busy || count === 0}
              className="px-4 h-8 rounded-lg bg-secondary text-on-secondary font-bold disabled:opacity-50"
            >
              {busy ? "Revisando…" : "Revisar"}
            </button>
          ) : (
            <button
              onClick={() => run(false)}
              disabled={busy || preview.recognized === 0}
              className="px-4 h-8 rounded-lg bg-primary text-on-primary font-bold disabled:opacity-50"
            >
              {busy ? "Guardando…" : `Guardar ${preview.recognized}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
