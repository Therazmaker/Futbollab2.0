"use client";

import React, { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { parseMatchStats } from "@/lib/parse-match-stats";

interface MatchDetailViewProps {
  matchLog: any;
  playerName: string;
  playerNumber: number;
  /** Predicción pre-partido de este partido (del informe del modelo), si existe */
  prediction?: { stats: Record<string, { predicted: number; sd: number; actual: number }> } | null;
  onBack: () => void;
  onMatchUpdated?: () => void;
}

/** Etiquetas en español y grupos. Lo que no esté aquí sale en "Otras". */
const GROUPS: Array<{ title: string; icon: string; keys: Array<[string, string, string?]> }> = [
  {
    title: "General",
    icon: "info",
    keys: [
      ["rating", "Nota"],
      ["goals", "Goles"],
      ["xG", "Goles esperados (xG)"],
      ["assists", "Asistencias"],
      ["xA", "Asistencias esperadas (xA)"],
    ],
  },
  {
    title: "Tiro",
    icon: "sports_soccer",
    keys: [
      ["totalShots", "Tiros"],
      ["shotsOnTarget", "Tiros a puerta"],
      ["xGOT", "xG a puerta (xGOT)"],
      ["shotsOffTarget", "Tiros fuera"],
      ["shotsBlocked", "Tiros bloqueados"],
      ["bigChancesMissed", "Ocasiones claras falladas"],
      ["hitWoodwork", "Al palo"],
      ["offsides", "Fueras de juego"],
    ],
  },
  {
    title: "Pases",
    icon: "conversion_path",
    keys: [
      ["keyPasses", "Pases clave"],
      ["bigChancesCreated", "Ocasiones claras creadas"],
      ["accuratePasses", "Pases acertados", "totalPasses"],
      ["accuratePassesPct", "Precisión de pase", "%"],
      ["oppHalfPassesAccurate", "Pases en campo rival", "oppHalfPasses"],
      ["ownHalfPassesAccurate", "Pases en campo propio", "ownHalfPasses"],
      ["longBallsAccurate", "Balones largos", "longBalls"],
      ["crossesAccurate", "Centros acertados", "crosses"],
    ],
  },
  {
    title: "Regate y posesión",
    icon: "directions_run",
    keys: [
      ["touches", "Toques"],
      ["unsuccessfulTouches", "Malos controles"],
      ["dribblesCompleted", "Regates completados", "dribbles"],
      ["wasFouled", "Faltas recibidas"],
      ["possessionLost", "Pérdidas"],
      ["carries", "Conducciones"],
      ["progressiveCarries", "Conducciones progresivas"],
      ["carryDistanceM", "Distancia en conducción", "m"],
      ["progressiveCarryM", "Conducción progresiva", "m"],
      ["totalProgressionM", "Progresión total", "m"],
      ["longestProgressiveCarryM", "Conducción progresiva más larga", "m"],
    ],
  },
  {
    title: "Defensa",
    icon: "shield",
    keys: [
      ["defensiveContributions", "Contribuciones defensivas"],
      ["tacklesWon", "Entradas ganadas", "tackles"],
      ["interceptions", "Intercepciones"],
      ["clearances", "Despejes"],
      ["blockedShots", "Tiros bloqueados (def.)"],
      ["recoveries", "Recuperaciones"],
      ["groundDuelsWon", "Duelos en el suelo ganados", "groundDuels"],
      ["aerialDuelsWon", "Duelos aéreos ganados", "aerialDuels"],
      ["duelsWon", "Duelos ganados", "duels"],
      ["fouls", "Faltas cometidas"],
      ["dribbledPast", "Le regatearon"],
      ["yellowCards", "Amarillas"],
      ["redCards", "Rojas"],
    ],
  },
  {
    title: "Físico",
    icon: "speed",
    keys: [
      ["distanceKm", "Distancia recorrida", "km"],
      ["topSpeedKmh", "Velocidad máxima", "km/h"],
      ["sprints", "Sprints"],
      ["walkJogKm", "Andando + trotando", "km"],
      ["runningKm", "Corriendo", "km"],
      ["highSpeedKm", "Alta velocidad", "km"],
      ["sprintingKm", "Esprintando", "km"],
    ],
  },
  { title: "Portero", icon: "sports_handball", keys: [["saves", "Paradas"], ["goalsPrevented", "Goles evitados"]] },
];

/** Claves que solo se muestran junto a otra ("27/30"). */
const SECONDARY = new Set(
  GROUPS.flatMap((g) => g.keys.map((k) => k[2])).filter((k): k is string => !!k && !["%", "m", "km", "km/h"].includes(k))
);
const PCT_PAIRS: Record<string, string> = {
  walkJogKm: "walkJogPct",
  runningKm: "runningPct",
  highSpeedKm: "highSpeedPct",
  sprintingKm: "sprintingPct",
  oppHalfPassesAccurate: "oppHalfPassesPct",
  ownHalfPassesAccurate: "ownHalfPassesPct",
  longBallsAccurate: "longBallsPct",
};
const KNOWN = new Set([...GROUPS.flatMap((g) => g.keys.map((k) => k[0])), ...Array.from(SECONDARY), ...Object.values(PCT_PAIRS)]);

const MODEL_FIELDS: Array<[string, string, string]> = [
  ["totalShots", "Tiros", "1"],
  ["xG", "xG", "0.01"],
  ["keyPasses", "Pases clave", "1"],
  ["groundDuelsWon", "Duelos ganados", "1"],
  ["rating", "Nota", "0.1"],
];

const input =
  "w-full h-9 px-2.5 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary";

export function MatchDetailView({ matchLog, playerName, playerNumber, prediction, onBack, onMatchUpdated }: MatchDetailViewProps) {
  const updateMutation = useMutation(api.players.updateMatchLog);
  const deleteMutation = useMutation(api.players.deleteMatchLog);

  const stats: Record<string, number> = matchLog.rawStats || {};
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [opponent, setOpponent] = useState<string>(matchLog.opponent || "");
  const [matchDate, setMatchDate] = useState<string>(matchLog.matchDate || "");
  const [isAway, setIsAway] = useState<boolean>(matchLog.isAway ?? false);
  const [minutesPlayed, setMinutesPlayed] = useState<string>(String(matchLog.minutesPlayed ?? ""));
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(MODEL_FIELDS.map(([k]) => [k, stats[k] === undefined ? "" : String(stats[k])]))
  );
  const [pasteText, setPasteText] = useState("");
  const pasted = useMemo(() => (pasteText.trim() ? parseMatchStats(pasteText) : null), [pasteText]);

  const fmt = (v: number) => String(+Number(v).toFixed(2));
  const others = Object.entries(stats).filter(([k]) => !KNOWN.has(k));

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const mins = Number(minutesPlayed);
    if (!(mins > 0)) return setError("Los minutos jugados deben ser mayores que 0.");
    // Base: lo guardado + lo pegado; los campos del formulario mandan.
    const next: Record<string, number> = { ...stats, ...(pasted?.stats ?? {}) };
    for (const [k] of MODEL_FIELDS) {
      const raw = fields[k]?.trim() ?? "";
      if (raw === "") delete next[k]; // vacío = no se sabe (no se inventa)
      else if (Number.isFinite(Number(raw))) next[k] = Number(raw);
    }
    if (pasted) {
      for (const [k] of MODEL_FIELDS) {
        if (pasted.stats[k] !== undefined && fields[k] === (stats[k] === undefined ? "" : String(stats[k]))) {
          next[k] = pasted.stats[k];
        }
      }
    }
    setIsSaving(true);
    try {
      await updateMutation({
        matchLogId: matchLog._id,
        opponent,
        matchDate,
        isAway,
        minutesPlayed: pasted?.minutesPlayed ?? mins,
        rawStats: next,
      });
      setIsEditing(false);
      onMatchUpdated?.();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`¿Eliminar el partido vs ${matchLog.opponent}?`)) return;
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
    <div className="flex flex-col w-full gap-space-md">
      {/* Migas */}
      <div className="flex items-center justify-between px-space-xs font-mono text-[11px] text-on-surface-variant">
        <div className="flex items-center gap-1.5 min-w-0">
          <button onClick={onBack} className="flex items-center text-secondary hover:text-primary" aria-label="Volver">
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          </button>
          <button onClick={onBack} className="hover:text-primary truncate">
            {playerName}
            {playerNumber ? ` #${playerNumber}` : ""}
          </button>
          <span className="material-symbols-outlined text-[12px]">chevron_right</span>
          <span className="text-primary font-semibold truncate">vs {matchLog.opponent}</span>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="px-2 py-1 rounded bg-surface-container-high text-secondary text-[10px] border border-secondary/30"
          >
            {isEditing ? "Cancelar" : "Editar"}
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="px-2 py-1 rounded bg-surface-container-high text-error text-[10px] border border-error/30"
          >
            {isDeleting ? "…" : "Borrar"}
          </button>
        </div>
      </div>

      {/* Cabecera */}
      <div className="bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60 shadow-md flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-on-surface">vs {matchLog.opponent}</h2>
          <p className="font-mono text-xs text-on-surface-variant">
            {matchLog.matchDate} · {matchLog.isAway ? "Fuera" : "Casa"} · {matchLog.minutesPlayed}&apos;
            {matchLog.competition ? ` · ${String(matchLog.competition).toUpperCase()}` : ""}
          </p>
        </div>
        {stats.rating !== undefined && (
          <div className="px-3 py-1.5 rounded-lg bg-primary/15 text-primary font-mono text-xl font-bold border border-primary/30">
            {fmt(stats.rating)}
          </div>
        )}
      </div>

      {/* Predicción previa vs real */}
      {prediction && Object.keys(prediction.stats).length > 0 && (
        <div className="bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60">
          <p className="font-mono text-[10px] uppercase text-primary font-bold mb-2">Lo que el modelo esperaba antes del partido</p>
          <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
            {Object.entries(prediction.stats).map(([k, s]) => {
              const z = s.sd > 0 ? Math.abs(s.actual - s.predicted) / s.sd : 0;
              return (
                <div key={k} className="bg-surface-container rounded-lg p-2 flex justify-between">
                  <span className="text-on-surface-variant">{MODEL_FIELDS.find((f) => f[0] === k)?.[1] ?? k}</span>
                  <span>
                    <b className="text-on-surface">{fmt(s.actual)}</b>
                    <span className="text-on-surface-variant"> / {fmt(s.predicted)}</span>
                    <span className={z <= 1 ? "text-primary" : "text-tertiary"}> {z.toFixed(1)}σ</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Edición */}
      {isEditing && (
        <form onSubmit={handleSaveEdit} className="bg-surface-container-low rounded-xl p-space-md border border-secondary/40 flex flex-col gap-2">
          <input value={opponent} onChange={(e) => setOpponent(e.target.value)} className={input} placeholder="Rival" required />
          <div className="grid grid-cols-3 gap-2">
            <input type="date" value={matchDate} onChange={(e) => setMatchDate(e.target.value)} className={input} required />
            <select value={isAway ? "a" : "h"} onChange={(e) => setIsAway(e.target.value === "a")} className={input}>
              <option value="h">Casa</option>
              <option value="a">Fuera</option>
            </select>
            <input
              type="number"
              min="1"
              value={minutesPlayed}
              onChange={(e) => setMinutesPlayed(e.target.value)}
              className={input}
              placeholder="Minutos"
              required
            />
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {MODEL_FIELDS.map(([k, label, step]) => (
              <label key={k} className="font-mono text-[9px] text-on-surface-variant uppercase">
                {label}
                <input
                  type="number"
                  step={step}
                  value={fields[k]}
                  onChange={(e) => setFields({ ...fields, [k]: e.target.value })}
                  className={`${input} h-8 px-1.5`}
                />
              </label>
            ))}
          </div>
          <p className="font-mono text-[9px] text-on-surface-variant">Deja vacío lo que no sepas: no se rellena con nada.</p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={3}
            placeholder="Pegar estadísticas de Sofascore/FotMob para añadir o actualizar…"
            className="w-full px-2.5 py-2 rounded-lg bg-surface-container text-on-surface font-mono text-[11px] border border-surface-container-high focus:outline-none focus:border-secondary"
          />
          {pasted && (
            <p className="font-mono text-[10px] text-primary">{Object.keys(pasted.stats).length} estadísticas se añadirán al guardar.</p>
          )}
          {error && <p className="font-mono text-[11px] text-error">{error}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={isSaving} className="px-4 py-1.5 rounded-lg bg-secondary text-black font-mono text-xs font-bold">
              {isSaving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </form>
      )}

      {/* Todas las estadísticas guardadas */}
      {Object.keys(stats).length === 0 && (
        <p className="font-mono text-[11px] text-on-surface-variant">Este partido no tiene estadísticas guardadas.</p>
      )}
      {GROUPS.map((g) => {
        const rows = g.keys.filter(([k]) => stats[k] !== undefined);
        if (!rows.length) return null;
        return (
          <div key={g.title} className="bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60">
            <p className="font-mono text-[10px] uppercase text-secondary font-bold mb-1.5 flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">{g.icon}</span>
              {g.title}
            </p>
            <div className="flex flex-col divide-y divide-surface-container-high/40 font-mono text-[11px]">
              {rows.map(([k, label, extra]) => {
                const unit = extra && ["%", "m", "km", "km/h"].includes(extra) ? extra : "";
                const total = extra && !unit ? stats[extra] : undefined;
                const pctKey = PCT_PAIRS[k];
                return (
                  <div key={k} className="flex justify-between py-1">
                    <span className="text-on-surface-variant">{label}</span>
                    <span className="text-on-surface font-bold">
                      {fmt(stats[k])}
                      {total !== undefined ? `/${fmt(total)}` : ""}
                      {unit ? ` ${unit}` : ""}
                      {pctKey && stats[pctKey] !== undefined ? (
                        <span className="text-on-surface-variant font-normal"> ({fmt(stats[pctKey])}%)</span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {others.length > 0 && (
        <div className="bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60">
          <p className="font-mono text-[10px] uppercase text-secondary font-bold mb-1.5">Otras</p>
          <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
            {others.map(([k, v]) => (
              <span key={k} className="px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant">
                {k} <b className="text-on-surface">{fmt(v)}</b>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
