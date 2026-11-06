"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const CLAUDE_OPTIONS: Array<[string, string]> = [
  ["claude-opus-5-5", "Opus 5.5 · el más fino (~$0.04/partido)"],
  ["claude-sonnet-5-5", "Sonnet 5.5 · equilibrado (~$0.02/partido)"],
  ["claude-haiku-5-5", "Haiku 5.5 · el más barato (~$0.001/partido)"],
];

/** Ajustes de la IA que lee las narraciones: Gemini o Claude. */
export function AiSettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useQuery(api.narratives.getAiSettings);
  const save = useMutation(api.narratives.setAiSettings);
  const [keys, setKeys] = useState<{ gemini: boolean; claude: boolean } | null>(null);
  const [geminiModel, setGeminiModel] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/analyze-narrative")
      .then((r) => r.json())
      .then(setKeys)
      .catch(() => setKeys(null));
  }, []);
  useEffect(() => {
    if (settings) setGeminiModel(settings.geminiModel);
  }, [settings?.geminiModel]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = async (patch: Parameters<typeof save>[0]) => {
    setError(null);
    try {
      await save(patch);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const provider = settings?.provider ?? "gemini";
  const keyBadge = (ok: boolean | undefined) =>
    ok === undefined ? null : (
      <span className={`text-[9px] px-1.5 py-0.5 rounded ${ok ? "bg-primary/20 text-primary" : "bg-error/20 text-error"}`}>
        {ok ? "clave OK" : "sin clave"}
      </span>
    );

  // Portal: el header usa backdrop-blur, que encerraría un "fixed" dentro de él
  return createPortal(
    <div className="fixed inset-0 z-[80] overflow-y-auto flex justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-surface-container-low border border-primary/40 rounded-2xl w-full max-w-md p-5 shadow-2xl my-auto flex flex-col gap-4 font-mono text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-on-surface font-sans flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[18px] text-primary">settings</span>
            Ajustes
          </span>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-container text-on-surface-variant">
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase text-secondary">IA para leer narraciones</span>
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface-container">
            {(["gemini", "claude"] as const).map((p) => (
              <button
                key={p}
                onClick={() => update({ provider: p })}
                className={`h-10 rounded-lg font-bold flex items-center justify-center gap-1.5 ${
                  provider === p ? "bg-primary text-on-primary" : "text-on-surface-variant"
                }`}
              >
                {p === "gemini" ? "Gemini" : "Claude"}
              </button>
            ))}
          </div>
        </div>

        <div className={`flex flex-col gap-1.5 p-3 rounded-xl border ${provider === "gemini" ? "border-primary/50" : "border-surface-container-high opacity-70"}`}>
          <div className="flex items-center justify-between">
            <span className="text-on-surface font-bold">Gemini</span>
            {keyBadge(keys?.gemini)}
          </div>
          <label className="text-[10px] text-on-surface-variant uppercase">
            Modelo
            <input
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value)}
              onBlur={() => geminiModel && geminiModel !== settings?.geminiModel && update({ geminiModel: geminiModel.trim() })}
              className="w-full h-9 px-2 mt-0.5 rounded-lg bg-surface-container text-on-surface border border-surface-container-high normal-case"
              placeholder="gemini-2.5-flash"
            />
          </label>
          <p className="text-[10px] text-on-surface-variant">Clave: variable GEMINI_API_KEY en Vercel.</p>
        </div>

        <div className={`flex flex-col gap-1.5 p-3 rounded-xl border ${provider === "claude" ? "border-primary/50" : "border-surface-container-high opacity-70"}`}>
          <div className="flex items-center justify-between">
            <span className="text-on-surface font-bold">Claude</span>
            {keyBadge(keys?.claude)}
          </div>
          <label className="text-[10px] text-on-surface-variant uppercase">
            Modelo
            <select
              value={settings?.claudeModel ?? "claude-opus-5-5"}
              onChange={(e) => update({ claudeModel: e.target.value })}
              className="w-full h-9 px-2 mt-0.5 rounded-lg bg-surface-container text-on-surface border border-surface-container-high normal-case"
            >
              {CLAUDE_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[10px] text-on-surface-variant">Clave: variable ANTHROPIC_API_KEY en Vercel.</p>
        </div>

        <p className="text-[10px] text-on-surface-variant">
          Las claves nunca se escriben aquí: se ponen en Vercel → Settings → Environment Variables y se vuelve a desplegar.
        </p>
        {error && <p className="text-error text-[11px]">{error}</p>}
      </div>
    </div>,
    document.body
  );
}
