"use client";

import React, { useState } from "react";
import { ThesisSheet } from "./ThesisSheet";
import { QuickResultSheet } from "./QuickResultSheet";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { competitionLabel } from "@/lib/competitions";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}`;
const ICON: Record<string, string> = { modelo: "📐", bajas: "🩹", regla: "🔎", narraciones: "🎙️", previa: "📝" };
const LEVEL: Record<string, { label: string; cls: string }> = {
  mercado: { label: "Como el mercado", cls: "bg-surface-container-high text-on-surface-variant" },
  atrevido: { label: "Atrevido", cls: "bg-amber-900/40 text-amber-300" },
  loco: { label: "🔥 Loco", cls: "bg-error/20 text-error" },
};

function Bar({ p, label }: { p: { home: number; draw: number; away: number }; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 font-mono text-[10px] text-on-surface-variant">{label}</span>
      <div className="flex-1 flex h-5 rounded-md overflow-hidden font-mono text-[10px] font-bold">
        <div className="bg-primary text-on-primary flex items-center justify-center" style={{ width: pct(p.home) }}>
          {pct(p.home)}
        </div>
        <div className="bg-secondary/70 text-black flex items-center justify-center" style={{ width: pct(p.draw) }}>
          {pct(p.draw)}
        </div>
        <div className="bg-tertiary text-black flex items-center justify-center" style={{ width: pct(p.away) }}>
          {pct(p.away)}
        </div>
      </div>
    </div>
  );
}

/** Tarjeta del Radar Audaz: mercado vs audaz, por qué se aleja, su apuesta y si coincide contigo. */
export function BoldCard({ m, onOpenTeam, onRegister }: { m: any; onOpenTeam: (id: Id<"teams">) => void; onRegister?: (m: any) => void }) {
  const picks = useQuery(api.radarAi.getPicks, { matchId: m._id }) ?? [];
  const theses = useQuery(api.theses.getTheses, { matchId: m._id }) ?? [];
  const [thesisOpen, setThesisOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const th: any = theses[0];
  const b = m.bold;
  const name = (o: string) => (o === "home" ? m.home.name : o === "away" ? m.away.name : "Empate");
  const mine = picks.filter((p: any) => p.source === "user" && (p.market === "result" || p.market === "doubleChance"));
  const covers = (p: any, o: string) => (p.market === "result" ? p.pick === o : p.pick === "home_away" ? o !== "draw" : p.pick.split("_").includes(o));
  return (
    <div className="bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60 shadow-md flex flex-col gap-2">
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-bold text-sm text-on-surface flex-wrap">
            <button onClick={() => onOpenTeam(m.home._id)} className="hover:text-primary truncate">
              {m.home.name}
            </button>
            <span className="text-on-surface-variant font-normal">vs</span>
            <button onClick={() => onOpenTeam(m.away._id)} className="hover:text-primary truncate">
              {m.away.name}
            </button>
          </div>
          <p className="font-mono text-[10px] text-on-surface-variant">
            {m.date} · {competitionLabel(m.competition) || m.competition}
            {m.result ? ` · Final ${m.result.home}-${m.result.away}` : ""}
          </p>
        </div>
        {b && <span className={`shrink-0 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${LEVEL[b.level].cls}`}>{LEVEL[b.level].label}</span>}
      </div>

      {!b ? (
        <p className="font-mono text-[10px] text-on-surface-variant">Sin cuotas: el Audaz necesita el mercado para saber cuánto alejarse.</p>
      ) : (
        <>
          <Bar p={b.market} label="Mercado" />
          <Bar p={b.probs} label="🔥 Audaz" />
          <p className="font-mono text-[10px] text-on-surface-variant">Se aleja del mercado hasta {Math.round(b.craziness * 100)} pts.</p>

          {b.parts.length > 0 ? (
            <div className="flex flex-col gap-0.5 font-mono text-[10px]">
              {b.parts.map((p: any, i: number) => {
                const k = (["home", "draw", "away"] as const).reduce((a, x) => (Math.abs(p.delta[x]) > Math.abs(p.delta[a]) ? x : a));
                return (
                  <div key={i} className="flex justify-between gap-2">
                    <span className="text-on-surface-variant">
                      {ICON[p.source]} {p.label}
                    </span>
                    <span className={`shrink-0 ${p.delta[k] >= 0 ? "text-primary" : "text-error"}`}>
                      {pts(p.delta[k])} {k === "draw" ? "empate" : name(k)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="font-mono text-[10px] text-on-surface-variant">Nada lo empuja: ni el modelo, ni reglas, ni narraciones, ni previa.</p>
          )}

          {b.pick ? (
            <div className="px-2 py-1.5 rounded-lg border border-error/40 bg-error/5 font-mono text-[11px]">
              <span className="text-on-surface font-bold">
                🔥 Apuesta audaz: {name(b.pick.outcome)}
                {b.pick.odds ? ` @${b.pick.odds}` : ""}
              </span>
              <div className="text-[10px] text-on-surface-variant">
                mercado {pct(b.pick.market)} → audaz {pct(b.pick.prob)}
                {b.pick.ev !== null ? ` · si el Audaz tuviera razón, valor ${b.pick.ev >= 0 ? "+" : ""}${Math.round(b.pick.ev * 100)} %` : ""}
                {m.result ? (m.result.outcome === b.pick.outcome ? " · ✓ salió" : " · ✗ no salió") : ""}
              </div>
            </div>
          ) : (
            <p className="font-mono text-[10px] text-on-surface-variant">
              Sin apuesta audaz: no se aleja 3 pts o más, o solo lo empuja el modelo (que solo, en el histórico, pierde).
            </p>
          )}

          {mine.length > 0 &&
            mine.map((p: any) => (
              <p key={p._id} className="font-mono text-[10px]">
                ✋ Tú: <span className="text-on-surface">{p.label}</span>
                {b.pick ? (
                  covers(p, b.pick.outcome) ? (
                    <span className="text-primary"> · 🤝 coincides con el Audaz</span>
                  ) : (
                    <span className="text-amber-300"> · vas por otro lado</span>
                  )
                ) : null}
                {p.verdict ? (p.verdict === "won" ? " ✓" : " ✗") : ""}
              </p>
            ))}
        </>
      )}
      <div className="flex items-center gap-2 font-mono text-[10px]">
        <button
          onClick={() => (onRegister ? onRegister(m) : setResultOpen(true))}
          className={`px-2 h-7 rounded-lg border font-bold ${m.result ? "bg-surface-container-high text-on-surface-variant border-surface-container-high" : "bg-primary text-on-primary border-primary"}`}
        >
          {m.result ? `✓ ${m.result.home}-${m.result.away}` : "✓ Resultado"}
        </button>
        <button onClick={() => setThesisOpen(true)} className="px-2 h-7 rounded-lg bg-surface-container-high text-secondary border border-secondary/30">
          💬 {th ? "Mi tesis" : m.result ? "Tesis" : "Escribir mi tesis"}
        </button>
        {th && (
          <span className="text-on-surface-variant truncate">
            {th.label}
            {th.verdict ? (th.verdict === "won" ? " ✓" : " ✗") : ""}
            {th.rule ? (th.rule.active ? " · regla activa" : " · regla propuesta") : ""}
          </span>
        )}
      </div>
      {resultOpen && <QuickResultSheet match={m} onClose={() => setResultOpen(false)} />}
      {thesisOpen && <ThesisSheet matchId={m._id} homeName={m.home.name} awayName={m.away.name} played={!!m.result} onClose={() => setThesisOpen(false)} />}
    </div>
  );
}
