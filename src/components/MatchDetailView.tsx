"use client";

import React, { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

interface MatchDetailViewProps {
  matchLog: any;
  playerName: string;
  playerNumber: number;
  onBack: () => void;
  onMatchUpdated?: () => void;
}

export function MatchDetailView({
  matchLog,
  playerName,
  playerNumber,
  onBack,
  onMatchUpdated,
}: MatchDetailViewProps) {
  const updateMutation = useMutation(api.players.updateMatchLog);
  const deleteMutation = useMutation(api.players.deleteMatchLog);

  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Edit form state
  const [opponent, setOpponent] = useState(matchLog.opponent || "");
  const [matchDate, setMatchDate] = useState(matchLog.matchDate || "");
  const [isAway, setIsAway] = useState<boolean>(matchLog.isAway ?? false);
  const [minutesPlayed, setMinutesPlayed] = useState<number>(matchLog.minutesPlayed || 90);
  const [tacticalRole, setTacticalRole] = useState(matchLog.tacticalRole || "Shadow Striker");

  // Raw stats
  const [totalShots, setTotalShots] = useState(matchLog.rawStats?.totalShots ?? 3);
  const [shotsOnTarget, setShotsOnTarget] = useState(matchLog.rawStats?.shotsOnTarget ?? 2);
  const [xg, setXg] = useState(matchLog.rawStats?.xG ?? 0.48);
  const [keyPasses, setKeyPasses] = useState(matchLog.rawStats?.keyPasses ?? 3);
  const [accuratePassesPct, setAccuratePassesPct] = useState(matchLog.rawStats?.accuratePassesPct ?? 88);
  const [touches, setTouches] = useState(matchLog.rawStats?.touches ?? 76);
  const [dribblesCompleted, setDribblesCompleted] = useState(matchLog.rawStats?.dribblesCompleted ?? 3);
  const [groundDuelsWon, setGroundDuelsWon] = useState(matchLog.rawStats?.groundDuelsWon ?? 7);
  const [aerialDuelsWon, setAerialDuelsWon] = useState(matchLog.rawStats?.aerialDuelsWon ?? 2);
  const [recoveries, setRecoveries] = useState(matchLog.rawStats?.recoveries ?? 5);
  const [rating, setRating] = useState(matchLog.rawStats?.rating ?? 8.6);

  const stats = matchLog.rawStats || {};

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await updateMutation({
        matchLogId: matchLog._id,
        opponent,
        matchDate,
        isAway,
        minutesPlayed,
        tacticalRole,
        rawStats: {
          ...stats,
          totalShots,
          shotsOnTarget,
          xG: xg,
          keyPasses,
          accuratePassesPct,
          touches,
          dribblesCompleted,
          groundDuelsWon,
          aerialDuelsWon,
          recoveries,
          rating,
        },
      });
      setIsEditing(false);
      if (onMatchUpdated) onMatchUpdated();
    } catch (err) {
      console.error("Error saving match:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar el registro de partido vs ${matchLog.opponent}?`)) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteMutation({ matchLogId: matchLog._id });
      onBack();
    } catch (err) {
      console.error("Error deleting match:", err);
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-col w-full gap-space-md animate-fadeIn">
      {/* Top Breadcrumbs & Back */}
      <div className="flex items-center justify-between px-space-xs text-on-surface-variant font-mono text-[11px]">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <button
            onClick={onBack}
            className="flex items-center text-secondary hover:text-primary transition-colors text-[16px]"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          </button>
          <span className="text-on-surface-variant/70 cursor-pointer" onClick={onBack}>
            {playerName} #{playerNumber}
          </span>
          <span className="text-outline-variant">/</span>
          <span className="text-on-surface-variant/70">Partidos</span>
          <span className="text-outline-variant">/</span>
          <span className="text-primary font-semibold truncate">vs {matchLog.opponent}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-surface-container-high hover:bg-surface-bright text-secondary font-mono text-[11px] border border-secondary/30 transition-all active:scale-95"
          >
            <span className="material-symbols-outlined text-[13px]">edit</span>
            <span>Editar</span>
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 font-mono text-[11px] border border-rose-600/40 transition-all active:scale-95"
          >
            <span className="material-symbols-outlined text-[13px]">delete</span>
            <span>{isDeleting ? "Borrando..." : "Borrar"}</span>
          </button>
        </div>
      </div>

      {/* Match Header Bento Card */}
      <div className="bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60 relative overflow-hidden shadow-xl">
        <div className="absolute -right-8 -top-8 w-44 h-44 rounded-full bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent blur-2xl pointer-events-none" />

        <div className="flex items-start justify-between relative z-10 gap-space-sm">
          <div className="flex items-center gap-space-sm">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center font-mono text-base font-bold shadow-md border ${
                matchLog.isAway
                  ? "bg-secondary/20 text-secondary border-secondary/40"
                  : "bg-primary/20 text-primary border-primary/40"
              }`}
            >
              {matchLog.isAway ? "AWAY" : "HOME"}
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-on-surface tracking-tight">
                  vs {matchLog.opponent}
                </h2>
                <span className="bg-surface-container-highest text-secondary font-mono text-[10px] px-1.5 py-0.2 rounded font-semibold">
                  {matchLog.isAway ? "Visitante" : "Local"}
                </span>
              </div>
              <p className="font-mono text-xs text-on-surface-variant flex items-center gap-2 mt-0.5">
                <span>{matchLog.matchDate}</span>
                <span>•</span>
                <span className="text-primary">{matchLog.tacticalRole || "Shadow Striker"}</span>
                <span>•</span>
                <span>{matchLog.minutesPlayed}' mins</span>
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-0.5">
            <span className="font-mono text-[9px] text-on-surface-variant uppercase">Sofascore Rating</span>
            <div className="flex items-center gap-1 bg-surface-container px-2 py-1 rounded border border-primary/30">
              <span className="material-symbols-outlined text-primary text-[14px]">star</span>
              <span className="font-mono text-sm font-bold text-primary">
                {stats.rating ?? 8.6}
              </span>
            </div>
          </div>
        </div>

        {/* Top 3 Impact Highlights */}
        <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-surface-container-high/40 font-mono">
          <div className="bg-surface-container/70 rounded-lg p-2 flex flex-col">
            <span className="text-[9px] text-on-surface-variant uppercase">Disparos / xG</span>
            <span className="text-xs font-bold text-primary mt-0.5">
              {stats.totalShots ?? 3} ({stats.shotsOnTarget ?? 2} al arco)
            </span>
            <span className="text-[9px] text-secondary">xG {stats.xG ?? 0.48}</span>
          </div>

          <div className="bg-surface-container/70 rounded-lg p-2 flex flex-col">
            <span className="text-[9px] text-on-surface-variant uppercase">Pases Clave</span>
            <span className="text-xs font-bold text-primary mt-0.5">
              {stats.keyPasses ?? 3} asist. pot.
            </span>
            <span className="text-[9px] text-on-surface-variant">
              {stats.accuratePassesPct ?? 88}% precisión
            </span>
          </div>

          <div className="bg-surface-container/70 rounded-lg p-2 flex flex-col">
            <span className="text-[9px] text-on-surface-variant uppercase">Duelos Ganados</span>
            <span className="text-xs font-bold text-secondary mt-0.5">
              {(stats.groundDuelsWon ?? 7) + (stats.aerialDuelsWon ?? 2)} totales
            </span>
            <span className="text-[9px] text-primary">
              {stats.dribblesCompleted ?? 3} regates
            </span>
          </div>
        </div>
      </div>

      {/* Detailed Category Bento Telemetry */}
      <div className="grid grid-cols-1 xs:grid-cols-3 gap-3">
        {/* Category 1: Attacking Telemetry */}
        <div className="bg-surface-container-low rounded-xl p-3 border border-surface-container-high/60 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-2 border-b border-surface-container-high">
            <span className="font-mono text-[10px] text-primary font-bold uppercase flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">sports_soccer</span>
              <span>Ataque & Definición</span>
            </span>
          </div>
          <div className="flex flex-col gap-1.5 mt-2 font-mono text-xs">
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">Tiros Totales</span>
              <span className="font-bold text-on-surface">{stats.totalShots ?? 3}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">A Puerta</span>
              <span className="font-bold text-primary">{stats.shotsOnTarget ?? 2}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">xG Esperado</span>
              <span className="font-bold text-secondary">{stats.xG ?? 0.48}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">Toques en Área</span>
              <span className="font-bold text-on-surface">{stats.boxTouches ?? 6}</span>
            </div>
          </div>
        </div>

        {/* Category 2: Creation & Distribution */}
        <div className="bg-surface-container-low rounded-xl p-3 border border-surface-container-high/60 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-2 border-b border-surface-container-high">
            <span className="font-mono text-[10px] text-secondary font-bold uppercase flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">alt_route</span>
              <span>Creación & Pases</span>
            </span>
          </div>
          <div className="flex flex-col gap-1.5 mt-2 font-mono text-xs">
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">Pases Clave</span>
              <span className="font-bold text-primary">{stats.keyPasses ?? 3}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">Precisión %</span>
              <span className="font-bold text-on-surface">{stats.accuratePassesPct ?? 88}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">Pases Últ. Tercio</span>
              <span className="font-bold text-secondary">{stats.finalThirdPasses ?? 12}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">Toques Totales</span>
              <span className="font-bold text-on-surface">{stats.touches ?? 76}</span>
            </div>
          </div>
        </div>

        {/* Category 3: Physical & Duels */}
        <div className="bg-surface-container-low rounded-xl p-3 border border-surface-container-high/60 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-2 border-b border-surface-container-high">
            <span className="font-mono text-[10px] text-primary font-bold uppercase flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">fitness_center</span>
              <span>Físico & Duelos</span>
            </span>
          </div>
          <div className="flex flex-col gap-1.5 mt-2 font-mono text-xs">
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">Duelos en Suelo</span>
              <span className="font-bold text-primary">{stats.groundDuelsWon ?? 7} ganados</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">Duelos Aéreos</span>
              <span className="font-bold text-on-surface">{stats.aerialDuelsWon ?? 2} ganados</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">Regates con Éxito</span>
              <span className="font-bold text-secondary">{stats.dribblesCompleted ?? 3}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">Recuperaciones</span>
              <span className="font-bold text-primary">{stats.recoveries ?? 5}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Future Expansion Slot ("Despues tendremos mas cosas ahi") */}
      <div className="rounded-xl bg-surface-container-low p-4 border border-dashed border-primary/30 flex flex-col items-center justify-center text-center">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-2">
          <span className="material-symbols-outlined text-[20px]">layers</span>
        </div>
        <p className="font-mono text-xs font-bold text-on-surface">
          Módulo de Expansión del Partido (Próximamente)
        </p>
        <p className="font-mono text-[10px] text-on-surface-variant max-w-sm mt-1">
          Aquí integraremos el <span className="text-primary">Shot Map 2D</span>, mapa de calor posicional GPS, clips de vídeo vinculados con IA y desglose táctico contra este rival.
        </p>
      </div>

      {/* Edit Match Modal */}
      {isEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface-container-low border border-primary/40 rounded-2xl w-full max-w-md p-5 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-surface-container-high">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">edit</span>
                <h3 className="font-bold text-base text-on-surface">Editar Partido</h3>
              </div>
              <button
                onClick={() => setIsEditing(false)}
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="flex flex-col gap-3 mt-3">
              <div>
                <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                  Rival
                </label>
                <input
                  type="text"
                  value={opponent}
                  onChange={(e) => setOpponent(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Fecha
                  </label>
                  <input
                    type="date"
                    value={matchDate}
                    onChange={(e) => setMatchDate(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Minutos Jugados
                  </label>
                  <input
                    type="number"
                    value={minutesPlayed}
                    onChange={(e) => setMinutesPlayed(Number(e.target.value))}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs font-mono cursor-pointer">
                  <input
                    type="radio"
                    checked={!isAway}
                    onChange={() => setIsAway(false)}
                    className="accent-primary"
                  />
                  <span>Local (Home)</span>
                </label>
                <label className="flex items-center gap-1.5 text-xs font-mono cursor-pointer">
                  <input
                    type="radio"
                    checked={isAway}
                    onChange={() => setIsAway(true)}
                    className="accent-primary"
                  />
                  <span>Visitante (Away)</span>
                </label>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                  Rol Táctico
                </label>
                <input
                  type="text"
                  value={tacticalRole}
                  onChange={(e) => setTacticalRole(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                />
              </div>

              <div className="border-t border-surface-container-high pt-2">
                <span className="font-mono text-[10px] text-primary uppercase font-bold">
                  Métricas de Rendimiento
                </span>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <label className="block text-[9px] font-mono text-on-surface-variant uppercase mb-0.5">
                      Disparos Totales
                    </label>
                    <input
                      type="number"
                      value={totalShots}
                      onChange={(e) => setTotalShots(Number(e.target.value))}
                      className="w-full h-8 px-2 rounded bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-mono text-on-surface-variant uppercase mb-0.5">
                      xG Generado
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={xg}
                      onChange={(e) => setXg(Number(e.target.value))}
                      className="w-full h-8 px-2 rounded bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-mono text-on-surface-variant uppercase mb-0.5">
                      Pases Clave
                    </label>
                    <input
                      type="number"
                      value={keyPasses}
                      onChange={(e) => setKeyPasses(Number(e.target.value))}
                      className="w-full h-8 px-2 rounded bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-mono text-on-surface-variant uppercase mb-0.5">
                      Rating Sofascore
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={rating}
                      onChange={(e) => setRating(Number(e.target.value))}
                      className="w-full h-8 px-2 rounded bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-surface-container-high flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface-variant font-mono text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-1.5 rounded-lg bg-primary text-on-primary font-mono text-xs font-bold shadow-lg flex items-center gap-1"
                >
                  {isSaving ? "Guardando..." : "Guardar Cambios"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
