"use client";

import React, { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { competitionLabel } from "@/lib/competitions";

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
  const setScore = useMutation(api.teams.setMatchScore);
  const [editingScore, setEditingScore] = useState(false);
  const [score, setScoreState] = useState({ home: "", away: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasScore = data && data.match.homeGoals !== undefined && data.match.awayGoals !== undefined;
  const ownSide = data ? (data.home.teamId === teamId ? data.home : data.away) : null;
  const otherSide = data ? (data.home.teamId === teamId ? data.away : data.home) : null;

  const saveScore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (score.home === "" || score.away === "") return setError("Pon los goles de los dos equipos.");
    setBusy(true);
    setError(null);
    try {
      await setScore({ matchId, homeGoals: Number(score.home), awayGoals: Number(score.away) });
      setEditingScore(false);
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
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-container text-on-surface-variant hover:text-on-surface">
            ✕
          </button>
        </div>

        {data && (
          <>
            {/* Marcador */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
              <button onClick={() => onOpenTeam(data.home.teamId)} className="font-bold text-sm text-on-surface hover:text-primary">
                {data.home.name}
              </button>
              <button
                onClick={() => {
                  setScoreState({ home: fmt(data.match.homeGoals).replace("—", ""), away: fmt(data.match.awayGoals).replace("—", "") });
                  setEditingScore(true);
                }}
                className="px-3 py-1.5 rounded-lg bg-surface-container font-mono text-2xl font-bold text-primary"
                title="Editar marcador"
              >
                {hasScore ? `${data.match.homeGoals} - ${data.match.awayGoals}` : "? - ?"}
              </button>
              <button onClick={() => onOpenTeam(data.away.teamId)} className="font-bold text-sm text-on-surface hover:text-primary">
                {data.away.name}
              </button>
            </div>
            {!hasScore && !editingScore && (
              <p className="font-mono text-[10px] text-tertiary text-center">
                Sin marcador: toca "? - ?" para ponerlo (cuenta para la tabla si es de liga).
              </p>
            )}
            {editingScore && (
              <form onSubmit={saveScore} className="flex items-center justify-center gap-2 font-mono text-xs">
                <input
                  type="number"
                  min="0"
                  value={score.home}
                  onChange={(e) => setScoreState({ ...score, home: e.target.value })}
                  className="w-14 h-9 text-center rounded-lg bg-surface-container text-on-surface border border-surface-container-high"
                  aria-label={`Goles ${data.home.name}`}
                />
                <span>-</span>
                <input
                  type="number"
                  min="0"
                  value={score.away}
                  onChange={(e) => setScoreState({ ...score, away: e.target.value })}
                  className="w-14 h-9 text-center rounded-lg bg-surface-container text-on-surface border border-surface-container-high"
                  aria-label={`Goles ${data.away.name}`}
                />
                <button type="submit" disabled={busy} className="px-3 h-9 rounded-lg bg-primary text-on-primary font-bold">
                  {busy ? "…" : "Guardar"}
                </button>
                <button type="button" onClick={() => setEditingScore(false)} className="px-2 h-9 text-on-surface-variant">
                  Cancelar
                </button>
              </form>
            )}
            {error && <p className="font-mono text-[11px] text-error text-center">{error}</p>}

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
