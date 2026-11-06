"use client";

import React, { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { COMPETITIONS, competitionLabel } from "@/lib/competitions";
import { NarrativePanel } from "./NarrativePanel";

interface TeamMatchSheetProps {
  matchId: Id<"matches">;
  /** Equipo desde el que se abrió (su lado se muestra primero) */
  teamId: Id<"teams">;
  onClose: () => void;
  onOpenPlayer: (playerId: Id<"players">, teamId: Id<"teams">) => void;
  onOpenTeam: (teamId: Id<"teams">) => void;
}

const PLAYER_COLS: Array<[string, string]> = [
  ["totalShots", "Tiros"],
  ["xG", "xG"],
  ["keyPasses", "PC"],
  ["groundDuelsWon", "Duel"],
  ["rating", "Nota"],
];

const TOTALS: Array<[string, string, string?]> = [
  ["goals", "Goles"],
  ["assists", "Asistencias"],
  ["xG", "xG"],
  ["xA", "xA"],
  ["totalShots", "Tiros"],
  ["shotsOnTarget", "A puerta"],
  ["bigChancesMissed", "Ocasiones falladas"],
  ["keyPasses", "Pases clave"],
  ["accuratePasses", "Pases acertados", "totalPasses"],
  ["accuratePassesPct", "Precisión de pase %"],
  ["touches", "Toques"],
  ["dribblesCompleted", "Regates", "dribbles"],
  ["tacklesWon", "Entradas ganadas", "tackles"],
  ["interceptions", "Intercepciones"],
  ["recoveries", "Recuperaciones"],
  ["groundDuelsWon", "Duelos suelo ganados", "groundDuels"],
  ["aerialDuelsWon", "Duelos aéreos ganados", "aerialDuels"],
  ["fouls", "Faltas"],
  ["distanceKm", "Distancia (km)"],
  ["sprints", "Sprints"],
];

const fmt = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(+Number(v).toFixed(2)));

export function TeamMatchSheet({ matchId, teamId, onClose, onOpenPlayer, onOpenTeam }: TeamMatchSheetProps) {
  const data = useQuery(api.teams.getMatchDetail, { matchId });
  const updateMatch = useMutation(api.teams.updateMatch);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ competition: "", date: "", home: "", away: "", swap: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasScore = data && data.match.homeGoals !== undefined && data.match.awayGoals !== undefined;
  const ownSide = data ? (data.home.teamId === teamId ? data.home : data.away) : null;
  const otherSide = data ? (data.home.teamId === teamId ? data.away : data.home) : null;

  const openEdit = () => {
    if (!data) return;
    setError(null);
    setForm({
      competition: data.competition,
      date: data.match.date,
      home: data.match.homeGoals === undefined ? "" : String(data.match.homeGoals),
      away: data.match.awayGoals === undefined ? "" : String(data.match.awayGoals),
      swap: false,
    });
    setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((form.home === "") !== (form.away === "")) return setError("Pon los goles de los dos equipos, o deja los dos vacíos.");
    setBusy(true);
    setError(null);
    try {
      // Los goles del formulario están en el orden que se ve (tras intercambiar, si se marcó)
      await updateMatch({
        matchId,
        competition: form.competition,
        date: form.date,
        swapHomeAway: form.swap,
        homeGoals: form.home === "" ? null : Number(form.home),
        awayGoals: form.away === "" ? null : Number(form.away),
      });
      setEditing(false);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain flex justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-surface-container-low border border-primary/40 rounded-2xl w-full max-w-md p-5 shadow-2xl my-auto flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase text-secondary">
            {data ? `${competitionLabel(data.competition)} · ${data.match.date}` : "Cargando…"}
          </span>
          <div className="flex items-center gap-1.5">
            {data && !editing && (
              <button
                onClick={openEdit}
                className="px-2.5 h-8 rounded-lg bg-surface-container-high text-secondary font-mono text-[11px] border border-secondary/30 flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">edit</span>
                Editar
              </button>
            )}
            <button onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-container text-on-surface-variant hover:text-on-surface">
              ✕
            </button>
          </div>
        </div>

        {data && (
          <>
            {/* Marcador */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
              <button onClick={() => onOpenTeam(data.home.teamId)} className="font-bold text-sm text-on-surface hover:text-primary">
                {data.home.name}
              </button>
              <button
                onClick={openEdit}
                className="px-3 py-1.5 rounded-lg bg-surface-container font-mono text-2xl font-bold text-primary"
                title="Editar marcador"
              >
                {hasScore ? `${data.match.homeGoals} - ${data.match.awayGoals}` : "? - ?"}
              </button>
              <button onClick={() => onOpenTeam(data.away.teamId)} className="font-bold text-sm text-on-surface hover:text-primary">
                {data.away.name}
              </button>
            </div>
            {!hasScore && !editing && (
              <p className="font-mono text-[10px] text-tertiary text-center">
                Sin marcador: toca "? - ?" o "Editar" para ponerlo (cuenta para la tabla si es de liga).
              </p>
            )}
            {editing && (
              <form onSubmit={save} className="flex flex-col gap-2 p-3 rounded-xl border border-secondary/40 bg-surface-container font-mono text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[10px] text-on-surface-variant uppercase">
                    Competición
                    <select
                      value={form.competition}
                      onChange={(e) => setForm({ ...form, competition: e.target.value })}
                      className="w-full h-9 px-2 mt-0.5 rounded-lg bg-surface-container-low text-on-surface border border-surface-container-high normal-case"
                    >
                      {!COMPETITIONS.some((c) => c.code === form.competition) && (
                        <option value={form.competition}>{competitionLabel(form.competition) || form.competition}</option>
                      )}
                      {COMPETITIONS.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[10px] text-on-surface-variant uppercase">
                    Fecha
                    <input
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm({ ...form, date: e.target.value })}
                      className="w-full h-9 px-2 mt-0.5 rounded-lg bg-surface-container-low text-on-surface border border-surface-container-high"
                      required
                    />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-[11px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.swap}
                    onChange={(e) => setForm({ ...form, swap: e.target.checked, home: form.away, away: form.home })}
                  />
                  Intercambiar local y visitante (local: {form.swap ? data.away.name : data.home.name})
                </label>
                <div className="flex items-center justify-center gap-2">
                  <span className="truncate text-right flex-1">{form.swap ? data.away.name : data.home.name}</span>
                  <input
                    type="number"
                    min="0"
                    value={form.home}
                    onChange={(e) => setForm({ ...form, home: e.target.value })}
                    className="w-14 h-9 text-center rounded-lg bg-surface-container-low text-on-surface border border-surface-container-high"
                    aria-label="Goles local"
                  />
                  <span>-</span>
                  <input
                    type="number"
                    min="0"
                    value={form.away}
                    onChange={(e) => setForm({ ...form, away: e.target.value })}
                    className="w-14 h-9 text-center rounded-lg bg-surface-container-low text-on-surface border border-surface-container-high"
                    aria-label="Goles visitante"
                  />
                  <span className="truncate flex-1">{form.swap ? data.home.name : data.away.name}</span>
                </div>
                <p className="text-[10px] text-on-surface-variant">
                  Deja los goles vacíos si aún no se jugó. Los partidos de los jugadores de este partido se actualizan
                  igual, y se recalculan la tabla y la fuerza de las ligas afectadas.
                </p>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setEditing(false)} className="px-3 h-8 rounded-lg text-on-surface-variant">
                    Cancelar
                  </button>
                  <button type="submit" disabled={busy} className="px-4 h-8 rounded-lg bg-primary text-on-primary font-bold">
                    {busy ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </form>
            )}
            {error && <p className="font-mono text-[11px] text-error text-center">{error}</p>}

            {hasScore && <NarrativePanel matchId={matchId} homeName={data.home.name} awayName={data.away.name} />}

            {[ownSide!, otherSide!].map((side) => (
              <div key={side.teamId} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between border-b border-surface-container-high pb-1">
                  <span className="font-mono text-xs uppercase text-primary font-bold">{side.name}</span>
                  <span className="font-mono text-[10px] text-on-surface-variant">
                    {side.players.length} jugadores{side.ratingAvg !== null ? ` · nota media ${side.ratingAvg}` : ""}
                  </span>
                </div>
                {side.players.length === 0 ? (
                  <p className="font-mono text-[10px] text-on-surface-variant">
                    Nadie registrado todavía. Desde el perfil de un jugador → PARTIDO + puedes elegir este partido.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full font-mono text-[10px]">
                      <thead>
                        <tr className="text-on-surface-variant">
                          <th className="text-left font-normal py-1">Jugador</th>
                          <th className="text-right font-normal">Min</th>
                          {PLAYER_COLS.map(([, l]) => (
                            <th key={l} className="text-right font-normal">
                              {l}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {side.players.map((p: any) => (
                          <tr
                            key={p.logId}
                            onClick={() => onOpenPlayer(p.playerId, side.teamId)}
                            className="border-t border-surface-container-high/40 cursor-pointer hover:bg-surface-container"
                          >
                            <td className="py-1 text-on-surface">
                              {p.number ? <span className="text-secondary">{p.number} </span> : null}
                              {p.name}
                              <span className="text-on-surface-variant"> · {p.position}</span>
                            </td>
                            <td className="text-right">{p.minutesPlayed}&apos;</td>
                            {PLAYER_COLS.map(([k]) => (
                              <td key={k} className="text-right text-on-surface">
                                {fmt(p.rawStats[k])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {side.players.length > 0 && (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] mt-1">
                    {TOTALS.filter(([k]) => side.totals[k] !== undefined).map(([k, label, total]) => (
                      <div key={k} className="flex justify-between border-b border-surface-container-high/30 py-0.5">
                        <span className="text-on-surface-variant">{label}</span>
                        <span className="text-on-surface font-bold">
                          {fmt(side.totals[k])}
                          {total && side.totals[total] !== undefined ? `/${fmt(side.totals[total])}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <p className="font-mono text-[9px] text-on-surface-variant">
              Totales = suma de los jugadores registrados (no del equipo entero si faltan jugadores).
            </p>
          </>
        )}
      </div>
    </div>
  );
}
