"use client";

import React, { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const L: Record<string, string> = {
  clinical: "letal",
  normal: "normal",
  wasteful: "perdonó",
  solid: "sólida",
  fragile: "frágil",
  kept_pushing: "siguió atacando",
  eased_off: "bajó el ritmo",
  parked_bus: "se encerró",
  never_led: "—",
  reacted: "reaccionó",
  no_reaction: "no reaccionó",
  never_trailed: "—",
  high: "alta",
  medium: "media",
  low: "baja",
};
const EVENT_ICON: Record<string, string> = {
  goal: "⚽",
  big_chance: "🎯",
  red_card: "🟥",
  injury: "🩹",
  penalty: "⚪",
  tactical_change: "🔁",
  other: "•",
};

/** Pegar la narración de un partido y ver lo que la IA sacó de ella. */
export function NarrativePanel({ matchId, homeName, awayName }: { matchId: Id<"matches">; homeName: string; awayName: string }) {
  const saved = useQuery(api.narratives.getNarrative, { matchId });
  const settings = useQuery(api.narratives.getAiSettings);
  const remove = useMutation(api.narratives.deleteNarrative);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
      setEditing(false);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const a = saved?.analysis;
  const providerLabel = settings ? (settings.provider === "claude" ? "Claude" : "Gemini") : "";

  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl border border-secondary/30 bg-surface-container font-mono text-[11px]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase text-secondary font-bold flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
          Narración (IA)
        </span>
        {!editing && (
          <button
            onClick={() => {
              setText(saved?.text ?? "");
              setEditing(true);
            }}
            className="px-2 h-7 rounded-lg bg-surface-container-high text-secondary border border-secondary/30 text-[10px]"
          >
            {a ? "Volver a analizar" : "Pegar narración"}
          </button>
        )}
      </div>

      {editing && (
        <div className="flex flex-col gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Pega aquí el minuto a minuto o la crónica del partido (Sofascore, FotMob, ESPN…)"
            className="w-full p-2 rounded-lg bg-surface-container-low text-on-surface border border-surface-container-high text-[11px]"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-on-surface-variant">
              {text.length.toLocaleString()} caracteres · se analiza con {providerLabel}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="px-3 h-8 rounded-lg text-on-surface-variant">
                Cancelar
              </button>
              <button
                onClick={analyze}
                disabled={busy || text.trim().length < 200}
                className="px-3 h-8 rounded-lg bg-primary text-on-primary font-bold disabled:opacity-50"
              >
                {busy ? "Analizando…" : "Analizar"}
              </button>
            </div>
          </div>
        </div>
      )}
      {error && <p className="text-error">{error}</p>}

      {!a && !editing && (
        <p className="text-[10px] text-on-surface-variant">
          Pega la narración y la IA sacará quién dominó cada tramo, ocasiones claras, si el favorito se relajó, si el
          underdog fue eficiente… Con varios partidos se ven las tendencias en el perfil del equipo.
        </p>
      )}

      {a && !editing && (
        <>
          <p className="text-on-surface leading-snug">{a.summary}</p>

          {a.periods.length > 0 && (
            <div className="flex gap-0.5">
              {a.periods.map((p: any, i: number) => (
                <div
                  key={i}
                  title={p.note}
                  className={`flex-1 text-center rounded py-1 text-[9px] ${
                    p.dominant === "home" ? "bg-primary/30 text-primary" : p.dominant === "away" ? "bg-secondary/30 text-secondary" : "bg-surface-container-high text-on-surface-variant"
                  }`}
                >
                  {p.range}
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between text-[9px] text-on-surface-variant">
            <span className="text-primary">■ {homeName}</span>
            <span className="text-secondary">■ {awayName}</span>
          </div>

          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-on-surface-variant">
                <th className="text-left font-normal"></th>
                <th className="text-right font-normal text-primary truncate max-w-[90px]">{homeName}</th>
                <th className="text-right font-normal text-secondary truncate max-w-[90px]">{awayName}</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Control", (s: any) => `${s.dominance}%`],
                  ["Ocasiones claras", (s: any) => s.clearChances],
                  ["Definición", (s: any) => L[s.finishing]],
                  ["Defensa", (s: any) => L[s.defending]],
                  ["Yendo ganando", (s: any) => L[s.afterLeading]],
                  ["Yendo perdiendo", (s: any) => L[s.afterTrailing]],
                  ["Intensidad", (s: any) => L[s.intensity]],
                ] as Array<[string, (s: any) => React.ReactNode]>
              ).map(([label, f]) => (
                <tr key={label} className="border-t border-surface-container-high/40">
                  <td className="py-0.5 text-on-surface-variant">{label}</td>
                  <td className="text-right text-on-surface">{f(a.home)}</td>
                  <td className="text-right text-on-surface">{f(a.away)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {a.scoreFairness !== "fair" && (
            <p className="text-tertiary text-[10px]">
              El marcador maquilla el partido a favor de {a.scoreFairness === "flattering_home" ? homeName : awayName}.
            </p>
          )}

          {(["home", "away"] as const).map((s) =>
            a[s].notes ? (
              <p key={s} className="text-[10px] text-on-surface-variant">
                <span className={s === "home" ? "text-primary" : "text-secondary"}>{s === "home" ? homeName : awayName}:</span> {a[s].notes}
                {a[s].keyPlayers.length > 0 && <span className="text-on-surface"> · Clave: {a[s].keyPlayers.join(", ")}</span>}
              </p>
            ) : null
          )}

          {a.events.length > 0 && (
            <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
              {[...a.events]
                .sort((x: any, y: any) => x.minute - y.minute)
                .map((e: any, i: number) => (
                  <div key={i} className="flex gap-1.5 text-[10px]">
                    <span className="w-7 text-right text-on-surface-variant">{e.minute}&apos;</span>
                    <span>{EVENT_ICON[e.type] ?? "•"}</span>
                    <span className={e.team === "home" ? "text-primary" : "text-secondary"}>{e.player}</span>
                    <span className="text-on-surface-variant truncate">{e.note}</span>
                  </div>
                ))}
            </div>
          )}

          <NarrativePlayers matchId={matchId} homeName={homeName} awayName={awayName} count={(a.players ?? []).length} />

          <div className="flex items-center justify-between text-[9px] text-on-surface-variant">
            <span>
              {saved!.provider === "claude" ? "Claude" : "Gemini"} · {saved!.model} · {new Date(saved!.createdAt).toLocaleDateString()}
            </span>
            <button onClick={() => confirm("¿Borrar el análisis de esta narración?") && remove({ matchId })} className="text-error">
              Borrar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Tendencias de un equipo sacadas de sus narraciones. */
export function TeamNarrativeTrends({ teamId, teamName, beforeDate, compact }: { teamId: Id<"teams">; teamName?: string; beforeDate?: string; compact?: boolean }) {
  const data = useQuery(api.narratives.getTeamTrends, { teamId, beforeDate });
  if (!data) return null;
  const t = data.trends;
  if (t.matches === 0) {
    return compact ? (
      <p className="font-mono text-[10px] text-on-surface-variant">{teamName}: sin narraciones analizadas todavía.</p>
    ) : (
      <div className="p-3 rounded-xl border border-surface-container-high bg-surface-container-low font-mono text-[10px] text-on-surface-variant">
        <span className="text-secondary font-bold uppercase">Lectura de narraciones</span>
        <p className="mt-1">
          Aún no hay narraciones analizadas. Abre un partido jugado → Narración (IA) → pega el minuto a minuto.
        </p>
      </div>
    );
  }
  return (
    <div className={`flex flex-col gap-1.5 font-mono text-[10px] ${compact ? "" : "p-3 rounded-xl border border-secondary/30 bg-surface-container-low"}`}>
      <div className="flex items-center justify-between">
        <span className="text-secondary font-bold uppercase">{compact ? teamName : "Lectura de narraciones"}</span>
        <span className="text-on-surface-variant">
          {t.matches} partido{t.matches === 1 ? "" : "s"}
          {t.matches < 3 ? " · provisional" : ""}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1 text-center">
        <Stat label="Control medio" value={`${t.avgDominance}%`} />
        <Stat label="Ocasiones claras" value={`${t.avgClearChancesFor}`} />
        <Stat label="Concedidas" value={`${t.avgClearChancesAgainst}`} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-on-surface-variant">
        {t.asFavorite.matches > 0 && (
          <span>
            Favorito: {t.asFavorite.matches} · se relajó {t.asFavorite.easedOff}
          </span>
        )}
        {t.asUnderdog.matches > 0 && (
          <span>
            Underdog: {t.asUnderdog.matches} · compitió {t.asUnderdog.competitive}
          </span>
        )}
        {t.easedOff.of > 0 && (
          <span>
            Yendo ganando bajó el ritmo {t.easedOff.count}/{t.easedOff.of}
          </span>
        )}
      </div>
      {t.insights.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {t.insights.map((s: string) => (
            <li key={s} className="text-on-surface">
              • {s}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-on-surface-variant">Sin patrones repetidos todavía (se marca algo cuando pasa en ≥ 2 partidos y en al menos la mitad).</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-container py-1">
      <div className="text-on-surface font-bold text-xs">{value}</div>
      <div className="text-[9px] text-on-surface-variant">{label}</div>
    </div>
  );
}

type PlanRow = {
  idx: number;
  name: string;
  side: "home" | "away";
  existingName: string | null;
  alreadyLogged: boolean;
  minutes: number;
  minutesEstimated: boolean;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  bigChancesMissed: number;
  injured: boolean;
};

/** Registrar a los jugadores que salen en la narración (y crear los que falten). */
function NarrativePlayers({ matchId, homeName, awayName, count }: { matchId: Id<"matches">; homeName: string; awayName: string; count: number }) {
  const run = useMutation(api.narratives.registerNarrativePlayers);
  const [plan, setPlan] = useState<PlanRow[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (count === 0) {
    return (
      <p className="text-[10px] text-on-surface-variant">
        Este análisis no trae jugadores (es anterior a esa función): dale a "Volver a analizar" para sacarlos.
      </p>
    );
  }

  const open = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await run({ matchId, preview: true });
      setPlan(r.plan as PlanRow[]);
      setChecked(new Set(r.plan.filter((p: PlanRow) => !p.alreadyLogged).map((p: PlanRow) => p.idx)));
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await run({ matchId, include: Array.from(checked) });
      setMsg(`Listo: ${r.logged} jugadores con este partido apuntado (${r.created} nuevos en la plantilla).`);
      setPlan(null);
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const facts = (p: PlanRow) =>
    [
      p.goals ? `⚽${p.goals > 1 ? "×" + p.goals : ""}` : "",
      p.assists ? `🅰️${p.assists > 1 ? "×" + p.assists : ""}` : "",
      p.yellowCards ? "🟨" : "",
      p.redCards ? "🟥" : "",
      p.bigChancesMissed ? `🎯✗${p.bigChancesMissed}` : "",
      p.injured ? "🩹" : "",
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <div className="flex flex-col gap-1.5 border-t border-surface-container-high pt-2">
      {!plan ? (
        <button
          onClick={open}
          disabled={busy}
          className="self-start px-2 h-7 rounded-lg bg-surface-container-high text-secondary border border-secondary/30 text-[10px] flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[13px]">group_add</span>
          {busy ? "Cargando…" : `Registrar jugadores de la narración (${count})`}
        </button>
      ) : (
        <>
          {(["home", "away"] as const).map((side) => (
            <div key={side} className="flex flex-col">
              <span className={`text-[10px] font-bold ${side === "home" ? "text-primary" : "text-secondary"}`}>
                {side === "home" ? homeName : awayName}
              </span>
              {plan
                .filter((p) => p.side === side)
                .map((p) => (
                  <label key={p.idx} className="flex items-center gap-1.5 text-[10px] py-0.5 border-t border-surface-container-high/30">
                    <input
                      type="checkbox"
                      disabled={p.alreadyLogged}
                      checked={!p.alreadyLogged && checked.has(p.idx)}
                      onChange={(e) => {
                        const next = new Set(checked);
                        if (e.target.checked) next.add(p.idx);
                        else next.delete(p.idx);
                        setChecked(next);
                      }}
                    />
                    <span className="text-on-surface truncate flex-1">
                      {p.name}
                      <span className="text-on-surface-variant">
                        {p.alreadyLogged ? " · ya registrado" : p.existingName ? (p.existingName !== p.name ? ` · = ${p.existingName}` : "") : " · nuevo"}
                      </span>
                    </span>
                    <span>{facts(p)}</span>
                    <span className="text-on-surface-variant w-9 text-right">
                      {p.minutesEstimated ? "~" : ""}
                      {p.minutes}&apos;
                    </span>
                  </label>
                ))}
            </div>
          ))}
          <p className="text-[9px] text-on-surface-variant">
            Se apuntan goles, asistencias, tarjetas, ocasiones falladas, lesión y minutos (~ = aproximados). No cuentan para
            el modelo de tiros/xG/nota hasta que pegues sus stats de Sofascore en ese partido. Los nuevos se crean como
            centrocampistas si la narración no deja clara la posición; puedes cambiarla en su ficha.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setPlan(null)} className="px-3 h-7 rounded-lg text-on-surface-variant text-[10px]">
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={busy || checked.size === 0}
              className="px-3 h-7 rounded-lg bg-primary text-on-primary font-bold text-[10px] disabled:opacity-50"
            >
              {busy ? "Guardando…" : `Registrar ${checked.size}`}
            </button>
          </div>
        </>
      )}
      {msg && <p className="text-[10px] text-primary">{msg}</p>}
    </div>
  );
}
