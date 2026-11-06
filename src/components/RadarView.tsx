"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { competitionLabel, COMPETITIONS } from "@/lib/competitions";
import { RivalPicker } from "./RivalPicker";
import { RadarTraining } from "./RadarTraining";
import { TeamNarrativeTrends } from "./NarrativePanel";

interface RadarViewProps {
  onOpenTeam: (teamId: Id<"teams">) => void;
}

const card = "bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60 shadow-md";
const input =
  "w-full h-9 px-2.5 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary";
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Resultado más probable según el modelo */
const mostLikely = (P: { home: number; draw: number; away: number }) =>
  (["home", "draw", "away"] as const).reduce((a, b) => (P[b] > P[a] ? b : a));
const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};

const TONE: Record<string, string> = {
  info: "bg-secondary/10 text-secondary border-secondary/30",
  good: "bg-primary/15 text-primary border-primary/40",
  warn: "bg-amber-500/10 text-amber-300 border-amber-500/40",
  risk: "bg-error/10 text-error border-error/40",
};

function ScoreRing({ value }: { value: number }) {
  const color = value >= 70 ? "#10B981" : value >= 45 ? "#06B6D4" : "#64748B";
  return (
    <div
      className="w-11 h-11 rounded-full flex items-center justify-center font-mono text-sm font-bold shrink-0"
      style={{ border: `3px solid ${color}`, color }}
      title="Study Score: qué tan interesante es estudiar este partido"
    >
      {value}
    </div>
  );
}

function OddsEditor({ match, onDone }: { match: any; onDone: () => void }) {
  const setOdds = useMutation(api.radar.setOdds);
  const [o, setO] = useState({
    home: match.odds?.home ? String(match.odds.home) : "",
    draw: match.odds?.draw ? String(match.odds.draw) : "",
    away: match.odds?.away ? String(match.odds.away) : "",
  });
  const [error, setError] = useState<string | null>(null);
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(",", ".")));
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await setOdds({ matchId: match._id, home: num(o.home), draw: num(o.draw), away: num(o.away) });
          onDone();
        } catch (err: any) {
          setError(err?.message ?? String(err));
        }
      }}
      className="mt-2 flex flex-col gap-1.5"
    >
      <div className="grid grid-cols-3 gap-1.5">
        {(["home", "draw", "away"] as const).map((k) => (
          <label key={k} className="font-mono text-[9px] text-on-surface-variant uppercase">
            {k === "home" ? "1" : k === "draw" ? "X" : "2"}
            <input
              inputMode="decimal"
              value={o[k]}
              onChange={(e) => setO({ ...o, [k]: e.target.value })}
              placeholder="2.10"
              className={`${input} h-8`}
            />
          </label>
        ))}
      </div>
      {error && <p className="font-mono text-[10px] text-error">{error}</p>}
      <div className="flex justify-end gap-2 font-mono text-[11px]">
        <button type="button" onClick={onDone} className="px-2 h-7 text-on-surface-variant">
          Cancelar
        </button>
        <button type="submit" className="px-3 h-7 rounded bg-primary text-on-primary font-bold">
          Guardar cuotas
        </button>
      </div>
    </form>
  );
}

export function RadarCard({ m, onOpenTeam }: { m: any; onOpenTeam: (id: Id<"teams">) => void }) {
  const [editingOdds, setEditingOdds] = useState(false);
  const [open, setOpen] = useState(false);
  const P = m.markets.probabilities;
  const outcomes = [
    ["home", "1", m.home.name],
    ["draw", "X", "Empate"],
    ["away", "2", m.away.name],
  ] as const;
  const hit = m.result ? mostLikely(P) === m.result.outcome : null;

  return (
    <div className={card}>
      <div className="flex items-start justify-between gap-2">
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
        <ScoreRing value={m.studyScore} />
      </div>

      {/* 1X2: modelo (y mercado si hay cuotas) */}
      <div className="mt-2 flex h-6 rounded-lg overflow-hidden font-mono text-[10px] font-bold">
        <div className="bg-primary text-on-primary flex items-center justify-center" style={{ width: pct(P.home) }}>
          {pct(P.home)}
        </div>
        <div className="bg-secondary/70 text-black flex items-center justify-center" style={{ width: pct(P.draw) }}>
          {pct(P.draw)}
        </div>
        <div className="bg-tertiary text-black flex items-center justify-center" style={{ width: pct(P.away) }}>
          {pct(P.away)}
        </div>
      </div>
      {m.baseMarkets && (
        <p className="mt-1 font-mono text-[10px] text-error">
          Con las bajas. Sin ellas: 1 {pct(m.baseMarkets.probabilities.home)} · X {pct(m.baseMarkets.probabilities.draw)} · 2{" "}
          {pct(m.baseMarkets.probabilities.away)}
        </p>
      )}
      {m.fair && (
        <div className="grid grid-cols-3 gap-1 mt-1 font-mono text-[10px] text-center">
          {outcomes.map(([k, label]) => {
            const e = m.edges[k];
            return (
              <div key={k} className={`rounded py-0.5 ${e >= 0.05 ? "bg-primary/15 text-primary" : e <= -0.05 ? "bg-error/10 text-error" : "bg-surface-container text-on-surface-variant"}`}>
                {label} @{m.odds[k]} · merc. {pct(m.fair[k])} · {e >= 0 ? "+" : ""}
                {Math.round(e * 100)}
              </div>
            );
          })}
        </div>
      )}

      {/* Alertas */}
      {m.flags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {m.flags.map((f: any) => (
            <span key={f.code} title={f.detail} className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${TONE[f.tone]}`}>
              {f.label}
            </span>
          ))}
        </div>
      )}

      {m.result && (
        <p className={`mt-2 font-mono text-[10px] ${hit ? "text-primary" : "text-on-surface-variant"}`}>
          {hit ? "✓ El resultado más probable según el modelo se cumplió." : "✗ El resultado más probable no se cumplió."} (Probabilidad que el modelo daba
          a lo que pasó: {pct(P[m.result.outcome as "home" | "draw" | "away"])})
        </p>
      )}

      <div className="mt-2 flex items-center justify-between font-mono text-[10px]">
        <button onClick={() => setOpen(!open)} className="text-secondary">
          {open ? "Ocultar mercados" : "Ver mercados"}
        </button>
        {!m.result && (
          <button onClick={() => setEditingOdds(!editingOdds)} className="text-on-surface-variant hover:text-primary">
            {m.odds ? "Editar cuotas" : "+ Cuotas 1X2"}
          </button>
        )}
      </div>
      {editingOdds && <OddsEditor match={m} onDone={() => setEditingOdds(false)} />}

      {open && (
        <div className="mt-2 flex flex-col gap-2 font-mono text-[11px]">
          <div className="flex flex-col gap-2 p-2 rounded-lg bg-surface-container-low border border-secondary/20">
            <span className="text-[10px] uppercase text-secondary font-bold">Cómo juegan (narraciones previas)</span>
            <TeamNarrativeTrends teamId={m.home._id} teamName={m.home.name} beforeDate={m.date} compact />
            <TeamNarrativeTrends teamId={m.away._id} teamName={m.away.name} beforeDate={m.date} compact />
          </div>
          <p className="text-on-surface-variant text-[10px]">
            Goles esperados {m.markets.expectedGoals.home} – {m.markets.expectedGoals.away} · jugadores registrados {m.playersLogged.home} /{" "}
            {m.playersLogged.away}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              ["Más de 1.5", m.markets.over15],
              ["Más de 2.5", m.markets.over25],
              ["Más de 3.5", m.markets.over35],
              ["Ambos marcan", m.markets.btts],
              [`${m.home.name}: portería a cero`, m.markets.homeCleanSheet],
              [`${m.away.name}: portería a cero`, m.markets.awayCleanSheet],
            ].map(([label, p]) => (
              <div key={label as string} className="flex justify-between bg-surface-container rounded px-2 py-1">
                <span className="text-on-surface-variant truncate">{label}</span>
                <span className="text-on-surface font-bold">{pct(p as number)}</span>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-on-surface-variant">
            Goles totales: salen de la fuerza de los equipos (70 % goles + 30 % xG de cada partido). En 3.920 partidos de 5 ligas le gana a
            la frecuencia de la liga en +1,5, +2,5, +3,5 y ambos marcan; las cuotas de cierre siguen siendo mejores.
          </p>
          <div className="flex justify-between bg-surface-container rounded px-2 py-1">
            <span className="text-on-surface-variant">Descanso (estimado, sin validar)</span>
            <span>
              1 {pct(m.markets.halfTime.home)} · X {pct(m.markets.halfTime.draw)} · 2 {pct(m.markets.halfTime.away)} · 0-0 {pct(m.markets.halfTime.goalless)}
            </span>
          </div>
          <p className="text-on-surface-variant">
            Marcadores más probables: {m.markets.topScores.map((s: any) => `${s.home}-${s.away} (${pct(s.p)})`).join(" · ")}
          </p>
          {(["home", "away"] as const).map((side) => {
            const layer = m.players?.[side];
            const teamName = m[side].name;
            if (!layer) return null;
            return (
              <div key={side} className="flex flex-col gap-1 border-t border-surface-container-high pt-2">
                <div className="flex justify-between">
                  <span className="text-on-surface font-bold">{teamName}: jugadores</span>
                  <span className="text-[9px] text-on-surface-variant">
                    xG de sus jugadores {layer.playersXg} · cubren {pct(layer.coverage)} del equipo
                  </span>
                </div>
                {layer.list.length === 0 ? (
                  <p className="text-[10px] text-on-surface-variant">Sin jugadores con partidos registrados.</p>
                ) : (
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="text-on-surface-variant">
                        <th className="text-left font-normal">Jugador</th>
                        <th className="text-right font-normal">Min</th>
                        <th className="text-right font-normal">xG</th>
                        <th className="text-right font-normal">Marca</th>
                        <th className="text-right font-normal">≥1 tiro</th>
                        <th className="text-right font-normal">≥2</th>
                        <th className="text-right font-normal">Nota</th>
                      </tr>
                    </thead>
                    <tbody>
                      {layer.list.map((p: any) => (
                        <tr key={p.playerId} className="border-t border-surface-container-high/40">
                          <td className="py-0.5 text-on-surface truncate max-w-[120px]">
                            {p.name}
                            {p.returning && <span className="text-amber-300" title="Vuelve de lesión"> ↺</span>}
                            {p.ownMatches < 4 && <span className="text-on-surface-variant" title="Pocos partidos propios: pesa la base de su posición"> ·</span>}
                          </td>
                          <td className="text-right">{p.minutes}&apos;</td>
                          <td className="text-right">{p.xG}</td>
                          <td className="text-right text-primary font-bold">{pct(p.pScore)}</td>
                          <td className="text-right">{pct(p.pShot1)}</td>
                          <td className="text-right">{pct(p.pShot2)}</td>
                          <td className="text-right">{p.rating ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {layer.absent.length > 0 && (
                  <p className="text-[10px] text-error">
                    Bajas:{" "}
                    {layer.absent
                      .map((a: any) => `${a.name}${a.xgPerMatch !== null ? ` (${a.xgPerMatch} xG/partido)` : ""}${a.expectedReturn ? `, vuelve ${a.expectedReturn}` : ""}`)
                      .join(" · ")}
                  </p>
                )}
              </div>
            );
          })}
          <p className="text-[9px] text-on-surface-variant">
            "Marca" = 1 − e^(−xG) (a largo plazo, un gol por cada xG). Las bajas restan la mitad de su xG al ataque del equipo (el sustituto cubre
            el resto; suposición sin validar todavía). ↺ = vuelve de lesión.
          </p>
          <p className="text-[9px] text-on-surface-variant">
            Study Score = incertidumbre {pct(m.studyParts.uncertainty)}
            {m.studyParts.disagreement !== null ? ` · discrepancia con el mercado ${pct(m.studyParts.disagreement)}` : " · sin cuotas"} · datos{" "}
            {pct(m.studyParts.data)}
          </p>
        </div>
      )}
    </div>
  );
}

export function RadarView({ onOpenTeam }: RadarViewProps) {
  const [range, setRange] = useState<"today" | "7" | "30" | "past7" | "day">("7");
  const [day, setDay] = useState(iso(new Date()));
  const [competition, setCompetition] = useState("all");
  const [sort, setSort] = useState<"study" | "date" | "value">("study");
  const [adding, setAdding] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [mode, setMode] = useState<"matches" | "training">("matches");
  const snapshotRange = useMutation(api.radar.snapshotRange);

  const { fromDate, toDate } = useMemo(() => {
    if (range === "today") return { fromDate: addDays(0), toDate: addDays(0) };
    if (range === "7") return { fromDate: addDays(0), toDate: addDays(7) };
    if (range === "30") return { fromDate: addDays(0), toDate: addDays(30) };
    if (range === "past7") return { fromDate: addDays(-7), toDate: addDays(-1) };
    return { fromDate: day, toDate: day };
  }, [range, day]);

  const rows = useQuery(api.radar.getRadar, { fromDate, toDate, competition });

  // Foto previa de los partidos sin marcador que se están viendo (para el entrenamiento)
  useEffect(() => {
    const today = addDays(0);
    if (toDate < today) return;
    snapshotRange({ fromDate: fromDate < today ? today : fromDate, toDate }).catch(() => {});
  }, [fromDate, toDate, snapshotRange]);
  const leagues = useQuery(api.teams.getLeagues) ?? [];
  const teams = useQuery(api.teams.getTeams, {}) ?? [];

  const sorted = useMemo(() => {
    const list = [...(rows ?? [])];
    if (sort === "date") list.sort((a, b) => (a.date < b.date ? -1 : 1));
    if (sort === "value") list.sort((a, b) => (b.bestEdge?.edge ?? -1) - (a.bestEdge?.edge ?? -1));
    return list;
  }, [rows, sort]);

  const played = (rows ?? []).filter((r) => r.result);
  const hits = played.filter((r) => mostLikely(r.markets.probabilities) === r.result!.outcome).length;

  return (
    <div className="flex flex-col w-full gap-space-md">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-on-surface flex items-center gap-1.5">
            <span className="material-symbols-outlined text-primary">radar</span>
            Radar
          </h1>
          <p className="font-mono text-[10px] text-on-surface-variant">Probabilidades del modelo, cuotas y qué partidos estudiar</p>
        </div>
        <button onClick={() => setAdding(true)} className="px-2.5 py-1.5 rounded-lg bg-primary text-on-primary font-mono text-[11px] font-bold">
          + Partido
        </button>
      </div>

      <div className="flex gap-1 font-mono text-[11px] self-start bg-surface-container rounded-lg p-0.5 border border-surface-container-highest">
        {(
          [
            ["matches", "Partidos"],
            ["training", "Entrenamiento"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            className={`px-3 py-1 rounded ${mode === k ? "bg-primary text-on-primary font-bold" : "text-on-surface-variant"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "training" ? (
        <>
          <select value={competition} onChange={(e) => setCompetition(e.target.value)} className={input} aria-label="Competición">
            <option value="all">Todas las competiciones</option>
            {Array.from(new Set([...leagues.map((l: any) => l.code), ...COMPETITIONS.map((c) => c.code)])).map((c) => (
              <option key={c} value={c}>
                {competitionLabel(c) || c}
              </option>
            ))}
          </select>
          <RadarTraining competition={competition} />
        </>
      ) : (
      <>
      {/* Filtros */}
      <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
        {(
          [
            ["today", "Hoy"],
            ["7", "Próximos 7 días"],
            ["30", "30 días"],
            ["past7", "Últimos 7 días"],
            ["day", "Día…"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setRange(k)}
            className={`px-2.5 py-1 rounded-lg ${range === k ? "bg-primary text-on-primary font-bold" : "bg-surface-container text-on-surface-variant"}`}
          >
            {label}
          </button>
        ))}
        {range === "day" && <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={`${input} !w-auto h-7`} />}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select value={competition} onChange={(e) => setCompetition(e.target.value)} className={input} aria-label="Competición">
          <option value="all">Todas las competiciones</option>
          {Array.from(new Set([...leagues.map((l: any) => l.code), ...COMPETITIONS.map((c) => c.code)])).map((c) => (
            <option key={c} value={c}>
              {competitionLabel(c) || c}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as any)} className={input} aria-label="Ordenar">
          <option value="study">Ordenar: Study Score</option>
          <option value="date">Ordenar: fecha</option>
          <option value="value">Ordenar: valor frente al mercado</option>
        </select>
      </div>

      <button onClick={() => setShowRules(!showRules)} className="self-start font-mono text-[10px] text-secondary">
        {showRules ? "Ocultar" : "¿Cómo se calcula?"}
      </button>
      {showRules && (
        <div className={`${card} font-mono text-[10px] text-on-surface-variant flex flex-col gap-1`}>
          <p>
            <b className="text-on-surface">Probabilidades:</b> Poisson con la fuerza ataque/defensa de cada equipo (todo el histórico, más peso a lo
            reciente). Validado partido a partido con 1.324 partidos: 1X2 ~11–13 % mejor que la frecuencia de la liga.
          </p>
          <p>
            <b className="text-on-surface">Cuotas:</b> se quita el margen de la casa; "valor" = el modelo da ≥ 5 puntos más que el mercado.
          </p>
          <p>
            <b className="text-on-surface">Alertas:</b> favorito claro ≥ 60 %, empate vivo ≥ 29 %, sorpresa posible (no favorito ≥ 30 %), favorito
            frágil (el mercado lo ve ≥ 8 puntos más fuerte que el modelo), bajas por lesión.
          </p>
          <p>
            <b className="text-on-surface">Study Score:</b> incertidumbre del resultado + discrepancia con el mercado + jugadores registrados de los dos
            equipos.
          </p>
        </div>
      )}

      {played.length > 0 && (
        <p className="font-mono text-[10px] text-on-surface-variant">
          En este rango: {played.length} jugados, el más probable del modelo acertó {hits} ({pct(hits / played.length)}).
        </p>
      )}

      {rows === undefined ? (
        <div className={`${card} font-mono text-xs text-on-surface-variant`}>Calculando…</div>
      ) : sorted.length === 0 ? (
        <div className={`${card} font-mono text-xs text-on-surface-variant flex flex-col gap-2 items-start`}>
          No hay partidos en estas fechas. Prográmalos con "+ Partido" aquí o con "+ Próximo" en el perfil de cada equipo.
        </div>
      ) : (
        sorted.map((m) => <RadarCard key={m._id} m={m} onOpenTeam={onOpenTeam} />)
      )}

      </>
      )}

      {adding && <AddMatchModal teams={teams as any[]} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddMatchModal({ teams, onClose }: { teams: any[]; onClose: () => void }) {
  const addMatch = useMutation(api.radar.addRadarMatch);
  const [f, setF] = useState({ competition: "premier", home: "", away: "", date: addDays(0) });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain flex justify-center bg-black/80 backdrop-blur-sm p-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!f.home || !f.away) return setError("Elige local y visitante.");
          setBusy(true);
          setError(null);
          try {
            await addMatch({ homeTeamId: f.home as Id<"teams">, awayTeamId: f.away as Id<"teams">, date: f.date, competition: f.competition });
            onClose();
          } catch (err: any) {
            setError(err?.message ?? String(err));
          } finally {
            setBusy(false);
          }
        }}
        className="bg-surface-container-low border border-primary/40 rounded-2xl w-full max-w-md p-5 shadow-2xl my-auto flex flex-col gap-2"
      >
        <div className="flex items-center justify-between pb-2 border-b border-surface-container-high">
          <h3 className="font-bold text-base text-on-surface">Partido para el Radar</h3>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-container text-on-surface-variant">
            ✕
          </button>
        </div>
        <label className="font-mono text-[10px] text-on-surface-variant uppercase">
          Competición
          <select value={f.competition} onChange={(e) => setF({ ...f, competition: e.target.value, home: "", away: "" })} className={input}>
            {COMPETITIONS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <p className="font-mono text-[10px] text-on-surface-variant uppercase">Local</p>
        <RivalPicker teams={teams} excludeId={f.away} value={f.home} onChange={(id) => setF({ ...f, home: id })} competition={f.competition} placeholder="— Local —" required />
        <p className="font-mono text-[10px] text-on-surface-variant uppercase">Visitante</p>
        <RivalPicker teams={teams} excludeId={f.home} value={f.away} onChange={(id) => setF({ ...f, away: id })} competition={f.competition} placeholder="— Visitante —" required />
        <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={input} required />
        {error && <p className="font-mono text-[11px] text-error">{error}</p>}
        <div className="pt-2 border-t border-surface-container-high flex justify-end gap-2 sticky bottom-0 bg-surface-container-low">
          <button type="button" onClick={onClose} className="px-3 h-8 rounded-lg bg-surface-container text-on-surface-variant font-mono text-xs">
            Cancelar
          </button>
          <button type="submit" disabled={busy} className="px-4 h-8 rounded-lg bg-primary text-on-primary font-mono text-xs font-bold">
            {busy ? "Guardando…" : "Añadir"}
          </button>
        </div>
      </form>
    </div>
  );
}
