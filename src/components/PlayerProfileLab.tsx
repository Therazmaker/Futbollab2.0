"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { INITIAL_PLAYER, PlayerData } from "@/data/mock-data";
import { BrainTargetRadar, PredictionMetricPoint } from "./BrainTargetRadar";
import { LearningCurve } from "./LearningCurve";
import { parseMatchStats } from "@/lib/parse-match-stats";
import { COMPETITIONS, competitionLabel } from "@/lib/competitions";
import type { Id } from "../../convex/_generated/dataModel";
import { MatchDetailView } from "./MatchDetailView";

interface PlayerProfileLabProps {
  /** Jugador a mostrar. Sin él, se abre el primero de la base. */
  playerId?: Id<"players">;
  onSelectPlayer: (playerId: Id<"players">, teamId?: Id<"teams">) => void;
  onOpenTeam: (teamId: Id<"teams">) => void;
  onBack: () => void;
}

const STAT_ORDER = [
  { key: "totalShots", name: "Tiros", angle: 45 },
  { key: "xG", name: "xG", angle: 135 },
  { key: "keyPasses", name: "Pases Clave", angle: 225 },
  { key: "groundDuelsWon", name: "Duelos", angle: 315 },
] as const;

const fmt = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : String(+Number(x).toFixed(d));
const signed = (x: number, d = 2) => (x >= 0 ? `+${fmt(x, d)}` : fmt(x, d));
const pct = (x: number, d = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;

export function PlayerProfileLab({ playerId, onSelectPlayer, onOpenTeam, onBack }: PlayerProfileLabProps) {
  // Jugador seleccionado (viene de la URL; por defecto, el primero de la base)
  const selectedPlayerId = playerId;
  const [playerSearch, setPlayerSearch] = useState<string>("");

  // Convex Reactive Hooks
  const profileData = useQuery(api.players.getPlayerProfile, selectedPlayerId ? { playerId: selectedPlayerId } : {});
  const report = useQuery(api.predictions.getModelReport, selectedPlayerId ? { playerId: selectedPlayerId } : {});
  const playerOptions = useQuery(api.players.listPlayers, { search: playerSearch || undefined, limit: 25 }) || [];
  const registeredTeams = useQuery(api.teams.getTeams, {}) || [];
  const seedDemo = useMutation(api.players.seedBellinghamDemo);
  const predictMutation = useMutation(api.predictions.calculateAndPredict);
  const deleteMatchMutation = useMutation(api.players.deleteMatchLog);
  const updateMatchMutation = useMutation(api.players.updateMatchLog);

  // La ficha de demo (foto, nacionalidad...) solo se usa para el jugador de ejemplo
  const player: PlayerData = INITIAL_PLAYER;

  // Selected Match for Full Detail View Screen
  const [selectedMatchLog, setSelectedMatchLog] = useState<any | null>(null);

  // Quick edit modal on the list
  const [editingLog, setEditingLog] = useState<any | null>(null);
  // Edición de la ficha del jugador (posición, dorsal, edad, nombre)
  const updatePlayerMutation = useMutation(api.players.updatePlayer);
  const [editingPlayer, setEditingPlayer] = useState<{ name: string; position: string; number: string; age: string } | null>(null);
  const [savingPlayer, setSavingPlayer] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Partido seleccionado en el radar (índice en report.points; null = el último)
  const [radarIndex, setRadarIndex] = useState<number | null>(null);
  const [radarMode, setRadarMode] = useState<"match" | "all" | "last5">("match");

  // Próximo partido (pronóstico)
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [nextOpponentTeamId, setNextOpponentTeamId] = useState<string>("");
  const [nextOpponent, setNextOpponent] = useState<string>("");
  const [nextIsAway, setNextIsAway] = useState<boolean>(false);
  const [nextMinutes, setNextMinutes] = useState<string>("");

  // Ingest / Calibrate Modal state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSubmittingMatch, setIsSubmittingMatch] = useState<boolean>(false);
  const [matchOpponent, setMatchOpponent] = useState<string>("");
  const [selectedOpponentTeamId, setSelectedOpponentTeamId] = useState<string>("");
  const [matchCompetition, setMatchCompetition] = useState<string>("laliga");
  const [matchDate, setMatchDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [matchIsAway, setMatchIsAway] = useState<boolean>(false);
  const [matchMinutes, setMatchMinutes] = useState<number>(90);
  const [actualShots, setActualShots] = useState<string>("");
  const [actualXg, setActualXg] = useState<string>("");
  const [actualKeyPasses, setActualKeyPasses] = useState<string>("");
  const [actualDuels, setActualDuels] = useState<string>("");
  const [actualRating, setActualRating] = useState<string>("");
  // Stats pegadas desde Sofascore/FotMob (se guardan todas con el partido)
  const [pastedText, setPastedText] = useState<string>("");
  // Partido del equipo elegido (si otro jugador ya lo registró) y marcador opcional
  const [selectedTeamMatch, setSelectedTeamMatch] = useState<any | null>(null);
  const [teamGoals, setTeamGoals] = useState<string>("");
  const [opponentGoals, setOpponentGoals] = useState<string>("");
  const [pastedStats, setPastedStats] = useState<Record<string, number> | null>(null);
  const [pasteInfo, setPasteInfo] = useState<string | null>(null);

  const applyPastedStats = (text: string) => {
    setPastedText(text);
    if (!text.trim()) {
      setPastedStats(null);
      setPasteInfo(null);
      return;
    }
    const parsed = parseMatchStats(text);
    const n = Object.keys(parsed.stats).length;
    if (!n) {
      setPastedStats(null);
      setPasteInfo("No reconozco estadísticas en ese texto. Formato esperado: etiqueta en una línea y valor en la siguiente.");
      return;
    }
    const st = parsed.stats;
    const str = (v: number | undefined) => (v === undefined ? undefined : String(v));
    // Rellena los campos del modelo con lo que venga (lo que no venga se deja igual)
    if (st.totalShots !== undefined) setActualShots(str(st.totalShots)!);
    if (st.xG !== undefined) setActualXg(str(st.xG)!);
    if (st.keyPasses !== undefined) setActualKeyPasses(str(st.keyPasses)!);
    if (st.groundDuelsWon !== undefined) setActualDuels(str(st.groundDuelsWon)!);
    if (st.rating !== undefined) setActualRating(str(st.rating)!);
    if (parsed.minutesPlayed) setMatchMinutes(parsed.minutesPlayed);
    setPastedStats(st);
    const missing = [
      st.totalShots === undefined && "tiros",
      st.xG === undefined && "xG",
      st.keyPasses === undefined && "pases clave",
      st.groundDuelsWon === undefined && "duelos ganados",
    ].filter(Boolean);
    setPasteInfo(
      `${n} estadísticas leídas${parsed.unknownLines.length ? ` (${parsed.unknownLines.length} con nombre no estándar, se guardan igual)` : ""}.` +
        (parsed.minutesPlayed ? ` Minutos: ${parsed.minutesPlayed}.` : " Revisa los minutos jugados: no venían en el texto.") +
        (missing.length ? ` Faltan para el modelo: ${missing.join(", ")}.` : "")
    );
  };
  const [lastCalibrationNotice, setLastCalibrationNotice] = useState<string | null>(null);

  // Auto-seed demo on first mount if database is empty
  useEffect(() => {
    if (profileData === null && !selectedPlayerId) {
      seedDemo().catch(() => {});
    }
  }, [profileData, seedDemo, selectedPlayerId]);

  useEffect(() => setRadarIndex(null), [selectedPlayerId]);

  const activePlayer = profileData?.player;
  const isDemoPlayer = !!activePlayer && !(activePlayer as any).legacyId && activePlayer.name === INITIAL_PLAYER.name;
  const activeTeam = profileData?.team;
  const teamRecentMatches =
    useQuery(
      api.teams.recentMatches,
      isModalOpen && activeTeam ? { teamId: activeTeam._id, playerId: activePlayer?._id, limit: 12 } : "skip"
    ) ?? [];

  const pickTeamMatch = (m: any | null) => {
    setSelectedTeamMatch(m);
    if (!m) return;
    setMatchDate(m.date);
    setMatchOpponent(m.opponent);
    setSelectedOpponentTeamId(m.opponentId);
    setMatchIsAway(!m.isHome);
    setMatchCompetition(m.competition);
    setTeamGoals(m.goalsFor === null ? "" : String(m.goalsFor));
    setOpponentGoals(m.goalsAgainst === null ? "" : String(m.goalsAgainst));
  };

  // El formulario de partido arranca en la liga del equipo del jugador
  useEffect(() => {
    if (activeTeam?.league) setMatchCompetition(activeTeam.league);
  }, [activeTeam?.league]);
  const activeWeights = profileData?.weights || [];
  const activeMatchLogs = profileData?.matchLogs || [];
  const latestPrediction = profileData?.latestPrediction;
  const forecastMetrics: any =
    latestPrediction?.kind === "forecast" ? latestPrediction.predictedMetrics : null;

  const points = report?.points ?? [];
  const summary = report?.summary;
  const profile = report?.profile;
  const selIdx = radarIndex ?? points.length - 1;
  const selectedPoint: any = points[selIdx] ?? null;

  const currentPredictiveForm = forecastMetrics?.predictiveForm ?? profile?.rating ?? "—";
  const currentConfidence =
    forecastMetrics?.confidence ?? (selectedPoint ? Math.round(selectedPoint.dataShare * 100) : 0);
  const awayEffect = profile?.effects.find((e: any) => e.feature === "is_away");

  // Radar: un partido, o el acumulado (todos / últimos 5) en σ
  const radarMetrics: PredictionMetricPoint[] = useMemo(() => {
    if (radarMode !== "match") {
      const subset = radarMode === "last5" ? points.slice(-5) : points;
      const r2 = (x: number) => +x.toFixed(2);
      return STAT_ORDER.map((s) => {
        const rows = subset.map((p: any) => p.stats[s.key]).filter((st: any) => st && st.sd > 0);
        if (!rows.length) return null;
        const n = rows.length;
        const mean = (f: (st: any) => number) => rows.reduce((a: number, st: any) => a + f(st), 0) / n;
        return {
          id: `${s.key}_${radarMode}`,
          name: s.name,
          predicted: r2(mean((st) => st.predicted)),
          actual: r2(mean((st) => st.actual)),
          meanAbsSigma: mean((st) => Math.abs(st.actual - st.predicted) / st.sd),
          bias: mean((st) => (st.actual - st.predicted) / st.sd),
          count: n,
          matchIndex: 0,
          categoryAngle: s.angle,
        } as PredictionMetricPoint;
      }).filter(Boolean) as PredictionMetricPoint[];
    }
    if (!selectedPoint) return [];
    return STAT_ORDER.filter((s) => selectedPoint.stats[s.key]).map((s) => {
      const st = selectedPoint.stats[s.key];
      return {
        id: `${s.key}_${selIdx}`,
        name: s.name,
        predicted: st.predicted,
        actual: st.actual,
        sd: st.sd,
        matchIndex: selIdx + 1,
        categoryAngle: s.angle,
      };
    });
  }, [selectedPoint, selIdx, radarMode, points]);

  const teamName = (id: string) => (registeredTeams as any[]).find((t: any) => t._id === id)?.name ?? "";

  const runPredictiveSimulation = async () => {
    if (!activePlayer?._id) return;
    const opponent = nextOpponent || teamName(nextOpponentTeamId) || "Próximo rival";
    setIsSimulating(true);
    try {
      await predictMutation({
        playerId: activePlayer._id,
        opponent,
        isAway: nextIsAway,
        opponentTeamId: (nextOpponentTeamId || undefined) as any,
        expectedMinutes: nextMinutes ? Number(nextMinutes) : undefined,
      });
    } catch (e) {
      console.warn("Convex predict mutation error:", e);
    } finally {
      setIsSimulating(false);
    }
  };

  const handleRegisterMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingMatch(true);

    // Todas las stats pegadas + los campos del formulario (que mandan si se editaron).
    // Solo se envía lo que hay: nada inventado.
    const rawStats: Record<string, number> = { ...(pastedStats ?? {}) };
    const put = (k: string, v: string) => {
      if (v.trim() !== "" && Number.isFinite(Number(v))) rawStats[k] = Number(v);
    };
    put("totalShots", actualShots);
    put("xG", actualXg);
    put("keyPasses", actualKeyPasses);
    put("groundDuelsWon", actualDuels);
    put("rating", actualRating);

    try {
      const response = await fetch("/api/ingest-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: activePlayer?._id,
          matchDate: matchDate || new Date().toISOString().split("T")[0],
          opponent: matchOpponent,
          opponentTeamId: selectedOpponentTeamId || undefined,
          competition: matchCompetition || "laliga",
          isAway: matchIsAway,
          minutesPlayed: matchMinutes,
          rawStats,
          matchId: selectedTeamMatch?._id,
          teamGoals: teamGoals === "" ? undefined : Number(teamGoals),
          opponentGoals: opponentGoals === "" ? undefined : Number(opponentGoals),
        }),
      });

      const data = await response.json();
      if (data.success) {
        const err = data.calibration?.error;
        const w = data.calibration?.calibratedWeight;
        setLastCalibrationNotice(
          err
            ? `Partido registrado. Error de la predicción previa: ${fmt(err.model)} (ingenuo ${fmt(err.naive)}, ruido ${fmt(err.noiseFloor)}). Efecto visitante ahora ${pct(w?.newValue ?? 0)}.`
            : "Partido registrado."
        );
        setRadarIndex(null);
        setIsModalOpen(false);
        setActualShots("");
        setActualXg("");
        setActualKeyPasses("");
        setActualDuels("");
        setPastedText("");
        setPastedStats(null);
        setPasteInfo(null);
        setSelectedTeamMatch(null);
        setTeamGoals("");
        setOpponentGoals("");
        setActualRating("");
      } else {
        setLastCalibrationNotice(`No se registró: ${data.error}`);
      }
    } catch (err) {
      console.error("Match calibration error:", err);
    } finally {
      setIsSubmittingMatch(false);
    }
  };

  const handleDeleteMatch = async (matchLogId: any, opponentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`¿Eliminar partido vs ${opponentName}?`)) return;

    try {
      await deleteMatchMutation({ matchLogId });
    } catch (err) {
      console.error("Error deleting match:", err);
    }
  };

  const handleQuickEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLog) return;
    setIsSavingEdit(true);
    try {
      await updateMatchMutation({
        matchLogId: editingLog._id,
        opponent: editingLog.opponent,
        matchDate: editingLog.matchDate,
        isAway: editingLog.isAway,
        minutesPlayed: editingLog.minutesPlayed,
        tacticalRole: editingLog.tacticalRole,
        competition: editingLog.competition,
        opponentTeamId: editingLog.opponentTeamId ?? null,
        rawStats: editingLog.rawStats,
      });
      setEditingLog(null);
    } catch (err) {
      console.error("Error updating match:", err);
    } finally {
      setIsSavingEdit(false);
    }
  };

  // If a specific match is selected, render the dedicated Match Detail Screen!
  if (selectedMatchLog) {
    return (
      <MatchDetailView
        matchLog={selectedMatchLog}
        prediction={(points as any[]).find((pt: any) => pt.logId === selectedMatchLog._id) ?? null}
        playerName={activePlayer?.name || player.name}
        playerNumber={(activePlayer as any)?.number ?? (isDemoPlayer ? player.number : 0)}
        onBack={() => setSelectedMatchLog(null)}
        onMatchUpdated={() => {
          setSelectedMatchLog(null);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col w-full gap-space-md">
      {/* Tactical Breadcrumbs & Live Model Status */}
      <div className="flex items-center justify-between px-space-xs text-on-surface-variant">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <button
            onClick={onBack}
            className="flex items-center text-secondary hover:text-primary transition-colors text-[16px]"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          </button>
          <div className="flex items-center gap-1 truncate font-mono text-[11px] uppercase tracking-wider">
            <span className="text-on-surface-variant/70">{profileData?.team?.league ?? ""}</span>
            <span className="text-outline-variant">/</span>
            <span
              className="text-on-surface-variant/70 cursor-pointer hover:text-primary"
              onClick={() => activeTeam && onOpenTeam(activeTeam._id)}
            >
              {profileData?.team?.name ?? ""}
            </span>
            <span className="text-outline-variant">/</span>
            <span className="text-primary font-semibold">{activePlayer?.name ?? "…"}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-surface-container-high px-2 py-0.5 rounded shadow-sm shrink-0 border border-primary/20">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
          <span className="font-mono text-[10px] text-primary font-bold">
            DATOS PROPIOS: {currentConfidence}%
          </span>
        </div>
      </div>

      {/* Selector de jugador (incluye los importados del histórico) */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={playerSearch}
            onChange={(e) => setPlayerSearch(e.target.value)}
            placeholder="Buscar jugador…"
            className="flex-1 h-8 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
          />
          <select
            value={selectedPlayerId ?? ""}
            onChange={(e) => {
              const p = (playerOptions as any[]).find((x: any) => x._id === e.target.value);
              if (p) onSelectPlayer(p._id, p.teamId);
            }}
            className="flex-1 h-8 px-2 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
          >
            <option value="">{activePlayer ? `${activePlayer.name} (actual)` : "Elegir jugador"}</option>
            {(playerOptions as any[]).map((p: any) => (
              <option key={p._id} value={p._id}>
                {p.hasMatches ? "● " : ""}
                {p.name} · {p.teamName} ({p.position})
              </option>
            ))}
          </select>
        </div>
        <p className="font-mono text-[9px] text-on-surface-variant px-1">
          ● = tiene partidos registrados. Sin partidos, el perfil parte de la tasa base de su posición
          {` `}(y de sus goles/minutos de temporada si vienen del histórico).
        </p>
      </div>

      {/* Calibration Notification Banner */}
      {lastCalibrationNotice && (
        <div className="bg-primary/10 border border-primary/40 rounded-xl p-2.5 flex items-center justify-between text-xs font-mono text-primary animate-fadeIn">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">verified</span>
            <span>{lastCalibrationNotice}</span>
          </div>
          <button
            onClick={() => setLastCalibrationNotice(null)}
            className="text-on-surface hover:text-primary"
          >
            ✕
          </button>
        </div>
      )}

      {/* Split Header Card: Player Identity & Predictive Rating */}
      <div className="bg-surface-container-low rounded-xl p-space-md relative overflow-hidden shadow-xl border border-surface-container-high/60">
        <div className="absolute -right-8 -top-8 w-36 h-36 bg-gradient-to-br from-primary/10 to-secondary/5 rounded-full blur-2xl pointer-events-none"></div>
        <div className="flex flex-col gap-space-md relative z-10">
          {/* Top Strip */}
          <div className="flex items-start justify-between gap-space-sm">
            <div className="flex items-center gap-space-md">
              <div className="relative shrink-0">
                <img
                  src={activePlayer?.photoUrl || (isDemoPlayer ? player.photoUrl : "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=128&q=60")}
                  alt={activePlayer?.name || player.name}
                  className="w-14 h-14 rounded-xl object-cover bg-surface-container shadow-md border border-primary/30"
                />
                <span className="absolute -bottom-1 -right-1 bg-surface-container-lowest text-secondary font-mono text-[10px] font-bold px-1.5 py-0.2 rounded shadow-sm border border-secondary/30">
                  #{(activePlayer as any)?.number ?? (isDemoPlayer ? player.number : "–")}
                </span>
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h2 className="text-lg font-bold text-on-surface tracking-tight truncate">
                    {activePlayer?.name || player.name}
                  </h2>
                  {isDemoPlayer && (
                    <span className="bg-surface-container-highest text-secondary font-mono text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold">
                      {player.nationality}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <button
                    onClick={() => {
                      if (!activePlayer) return;
                      setPlayerError(null);
                      setEditingPlayer({
                        name: activePlayer.name,
                        position: activePlayer.position || "MF",
                        number: (activePlayer as any).number != null ? String((activePlayer as any).number) : "",
                        age: (activePlayer as any).age != null ? String((activePlayer as any).age) : "",
                      });
                    }}
                    title="Editar posición, dorsal, edad y nombre"
                    className="bg-primary/10 text-primary font-mono text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wider border border-primary/20 flex items-center gap-1 hover:bg-primary/20"
                  >
                    {activePlayer?.position || player.position}
                    <span className="material-symbols-outlined text-[12px]">edit</span>
                  </button>
                  <span className="text-on-surface-variant text-xs font-sans">
                    {(activePlayer as any)?.age
                      ? `${(activePlayer as any).age} años`
                      : isDemoPlayer
                      ? `Age ${player.age} • ${player.height} cm`
                      : ""}
                    {profile ? ` • ${profile.matches} partidos` : ""}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setIsModalOpen(true)}
                title="Registrar un partido jugado: se compara con la predicción previa y se recalibra el perfil"
                className="flex items-center gap-1 bg-primary text-on-primary font-mono text-[11px] font-bold px-2.5 py-1.5 rounded transition-transform active:scale-95 shadow-md hover:opacity-90"
              >
                <span className="material-symbols-outlined text-[14px]">add_circle</span>
                <span>PARTIDO +</span>
              </button>

              <button
                onClick={runPredictiveSimulation}
                disabled={isSimulating}
                className="flex items-center gap-1 bg-surface-container-high hover:bg-surface-bright text-secondary hover:text-primary font-mono text-[11px] px-2.5 py-1.5 rounded transition-transform active:scale-95 shadow-sm border border-secondary/30"
              >
                <span
                  className={`material-symbols-outlined text-[14px] ${
                    isSimulating ? "animate-spin text-primary" : ""
                  }`}
                >
                  {isSimulating ? "progress_activity" : "psychology"}
                </span>
                <span>{isSimulating ? "CALC..." : "SIMULATE"}</span>
              </button>
            </div>
          </div>

          {/* Telemetry Predictive Score & Variance */}
          <div className="grid grid-cols-2 gap-space-sm pt-space-xs">
            <div className="bg-surface-container rounded-lg p-space-sm flex items-center justify-between shadow-inner border border-outline-variant/20">
              <div className="flex flex-col">
                <span className="font-mono text-[9px] text-on-surface-variant uppercase tracking-wider">
                  Rating esperado
                </span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="font-mono text-2xl font-bold text-primary drop-shadow-[0_0_12px_rgba(78,222,163,0.45)]">
                    {currentPredictiveForm}
                  </span>
                  <span className="font-mono text-xs text-on-surface-variant/70">/ 10</span>
                </div>
              </div>
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-[18px]">trending_up</span>
              </div>
            </div>

            <div className="bg-surface-container rounded-lg p-space-sm flex flex-col justify-between shadow-inner border border-outline-variant/20">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] text-on-surface-variant uppercase tracking-wider">
                  Efecto visitante
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-ping"></span>
              </div>
              <div className="flex items-center gap-1 mt-1">
                <span className="bg-secondary/15 text-secondary font-mono text-[11px] px-1.5 py-0.2 rounded font-bold">
                  {awayEffect ? pct(awayEffect.impact) : "—"}
                </span>
                <span className="text-[10px] text-on-surface-variant truncate font-mono">
                  {awayEffect ? `80%: ${pct(awayEffect.low, 0)} a ${pct(awayEffect.high, 0)}` : "sin datos"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Active Contextual Weights (Dynamic Calibration Badges) */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between px-space-xs">
          <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider font-semibold flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px] text-secondary">tune</span>
            <span>Modus operandi: efectos de contexto</span>
          </span>
          <span className="font-mono text-[10px] text-primary">BAYES + NEWTON</span>
        </div>

        <div className="grid grid-cols-2 xs:grid-cols-4 gap-2">
          {activeWeights.length > 0 ? (
            activeWeights.map((w: any) => {
              const isElasticity = w.featureName === "opponent_defense";
              const pct = isElasticity
                ? `elast. ${Math.log(1 + w.weightValue).toFixed(2)}`
                : `${(w.weightValue * 100).toFixed(1)}%`;
              const isPositive = w.weightValue >= 0;
              return (
                <div
                  key={w._id}
                  className="bg-surface-container-low rounded-lg p-2 border border-surface-container-high flex flex-col justify-between"
                >
                  <span className="font-mono text-[9px] text-on-surface-variant truncate uppercase">
                    {w.featureName === "is_away"
                      ? "visitante"
                      : w.featureName === "opponent_defense"
                      ? "defensa rival"
                      : w.featureName.replace(/_/g, " ")}
                  </span>
                  <div className="flex items-baseline justify-between mt-1">
                    <span
                      className={`font-mono text-xs font-bold ${
                        isPositive ? "text-primary" : "text-tertiary"
                      }`}
                    >
                      {isPositive && !isElasticity ? `+${pct}` : pct}
                    </span>
                    <span
                      className="font-mono text-[9px] text-on-surface-variant"
                      title="Qué parte de este efecto sale de los partidos del jugador (el resto es la tasa base)"
                    >
                      {(w.confidenceScore * 100).toFixed(0)}% datos · {w.matches ?? 0}p
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="col-span-full font-mono text-[10px] text-on-surface-variant">
              Aún no hay efectos calculados. Se calculan al registrar partidos o pronosticar.
            </p>
          )}
        </div>
      </div>

      {/* Perfil por 90' + último partido: predicho (antes del partido) vs real */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between px-space-xs">
          <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider font-semibold">
            {selectedPoint
              ? `Partido ${selIdx + 1}/${points.length}: predicho antes vs real`
              : "Perfil por 90 minutos"}
          </span>
          <span className="font-mono text-[10px] text-secondary">
            {selectedPoint ? `${selectedPoint.matchDate} · ${selectedPoint.minutes}'` : "SIN PARTIDOS"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-space-sm">
          {STAT_ORDER.map((s) => {
            const st = selectedPoint?.stats?.[s.key];
            const p90 = profile?.per90?.[s.key];
            const delta = st ? st.actual - st.predicted : null;
            const z = st && st.sd > 0 ? Math.abs(st.actual - st.predicted) / st.sd : null;
            return (
              <div
                key={s.key}
                className="bg-surface-container-low rounded-xl p-space-sm flex flex-col justify-between shadow-md border border-surface-container-high/60"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-on-surface-variant font-medium">{s.name}</span>
                  {delta !== null && (
                    <span
                      className={`font-mono text-[10px] px-1.5 py-0.2 rounded font-bold ${
                        z !== null && z <= 1 ? "bg-primary/10 text-primary" : "bg-tertiary/10 text-tertiary"
                      }`}
                      title="real − predicho (y en desviaciones σ)"
                    >
                      {signed(delta)} {z !== null ? `· ${z.toFixed(1)}σ` : ""}
                    </span>
                  )}
                </div>
                <div className="my-2">
                  {st ? (
                    <div className="flex items-baseline justify-between font-mono text-lg font-bold">
                      <span className="text-on-surface">{fmt(st.actual)}</span>
                      <span className="text-xs text-on-surface-variant/80">
                        pred {fmt(st.predicted)} ± {fmt(st.sd, 1)}
                      </span>
                    </div>
                  ) : (
                    <div className="font-mono text-xs text-on-surface-variant">sin dato en este partido</div>
                  )}
                  {p90 && (
                    <div className="mt-1.5">
                      <div className="flex justify-between font-mono text-[9px] text-on-surface-variant">
                        <span>
                          /90: <span className="text-secondary">{fmt(p90.rate)}</span> (base {fmt(p90.prior)})
                        </span>
                        <span>{Math.round(p90.dataShare * 100)}% datos</span>
                      </div>
                      <div className="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden mt-1">
                        <div
                          className="bg-secondary h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.round(p90.dataShare * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* RADAR + CURVA DE APRENDIZAJE (datos reales, validación partido a partido) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-space-xs">
          <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider font-semibold flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px] text-primary">adjust</span>
            <span>Trayectoria de convergencia</span>
          </span>

          {points.length > 0 && radarMode === "match" && (
            <div className="flex items-center gap-1 bg-surface-container rounded-lg p-0.5 border border-surface-container-highest font-mono text-[10px]">
              <button
                onClick={() => setRadarIndex(0)}
                className={`px-2 py-0.5 rounded ${selIdx === 0 ? "bg-surface-container-highest text-tertiary font-bold" : "text-on-surface-variant"}`}
              >
                Primero
              </button>
              <button
                onClick={() => setRadarIndex(Math.max(0, selIdx - 1))}
                className="px-1.5 py-0.5 rounded text-on-surface-variant hover:text-on-surface"
                aria-label="Partido anterior"
              >
                ‹
              </button>
              <span className="px-1 text-on-surface">
                {selIdx + 1}/{points.length}
              </span>
              <button
                onClick={() => setRadarIndex(Math.min(points.length - 1, selIdx + 1))}
                className="px-1.5 py-0.5 rounded text-on-surface-variant hover:text-on-surface"
                aria-label="Partido siguiente"
              >
                ›
              </button>
              <button
                onClick={() => setRadarIndex(null)}
                className={`px-2 py-0.5 rounded ${selIdx === points.length - 1 ? "bg-primary text-on-primary font-bold" : "text-on-surface-variant"}`}
              >
                Último
              </button>
            </div>
          )}
        </div>

        {points.length > 0 && (
          <div className="flex items-center gap-1 self-start bg-surface-container rounded-lg p-0.5 border border-surface-container-highest font-mono text-[10px]">
            {(
              [
                ["match", "Partido"],
                ["all", `Acumulado (${points.length})`],
                ["last5", "Últimos 5"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setRadarMode(m)}
                className={`px-2.5 py-1 rounded ${radarMode === m ? "bg-primary text-on-primary font-bold" : "text-on-surface-variant hover:text-on-surface"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {radarMetrics.length > 0 ? (
          <BrainTargetRadar
            metrics={radarMetrics}
            selectedMatchLabel={
              radarMode === "all"
                ? `Acumulado · ${points.length} partidos`
                : radarMode === "last5"
                ? `Últimos ${Math.min(5, points.length)} partidos`
                : selectedPoint
                ? `#${selIdx + 1} vs ${selectedPoint.opponent ?? "?"} (${selectedPoint.isAway ? "fuera" : "casa"})`
                : ""
            }
            description={
              radarMode === "match"
                ? undefined
                : "Error medio de las predicciones pre-partido, en σ. Con un perfil bien calibrado los puntos rondan 0.8σ (dentro del anillo de 1σ): algo de error siempre hay por el azar. Si un punto se aleja, esa stat está mal estimada; el desvío del punto indica si el modelo predice de más o de menos."
            }
          />
        ) : (
          <div className="bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60 font-mono text-[11px] text-on-surface-variant">
            Registra el primer partido de este jugador para ver el radar de error.
          </div>
        )}

        {radarMode !== "match" && radarMetrics.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
            {radarMetrics.map((m) => {
              const b = m.bias ?? 0;
              const verdict =
                (m.count ?? 0) < 4
                  ? "pocos datos"
                  : (m.meanAbsSigma ?? 0) > 1.3
                  ? "mal calibrado"
                  : Math.abs(b) > 0.5
                  ? b > 0
                    ? "lo subestima"
                    : "lo sobreestima"
                  : "bien";
              return (
                <div key={m.id} className="bg-surface-container-low rounded-lg p-2 border border-surface-container-high">
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">{m.name}</span>
                    <span className={verdict === "bien" ? "text-primary font-bold" : "text-tertiary font-bold"}>{verdict}</span>
                  </div>
                  <p className="text-on-surface">
                    {(m.meanAbsSigma ?? 0).toFixed(2)}σ · sesgo {b >= 0 ? "+" : ""}
                    {b.toFixed(2)}σ · {m.count}p
                  </p>
                  <p className="text-on-surface-variant text-[9px]">
                    prom. real {m.actual} vs pred {m.predicted}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        <LearningCurve
          points={points}
          selectedIndex={radarMode === "match" ? selIdx : undefined}
          onSelect={(i) => {
            setRadarMode("match");
            setRadarIndex(i);
          }}
        />

        {summary && summary.matches > 0 && (
          <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
            <div className="bg-surface-container-low rounded-lg p-2 border border-surface-container-high">
              <span className="text-on-surface-variant uppercase text-[9px]">Error modelo</span>
              <p className="text-primary font-bold text-sm">{fmt(summary.modelError)}</p>
            </div>
            <div className="bg-surface-container-low rounded-lg p-2 border border-surface-container-high">
              <span className="text-on-surface-variant uppercase text-[9px]">Error ingenuo</span>
              <p className="text-on-surface font-bold text-sm">{fmt(summary.naiveError)}</p>
            </div>
            <div className="bg-surface-container-low rounded-lg p-2 border border-surface-container-high">
              <span className="text-on-surface-variant uppercase text-[9px]">Piso de ruido</span>
              <p className="text-on-surface-variant font-bold text-sm">{fmt(summary.noiseFloor)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Match History & Prediction Calibration Log with Click-to-Detail, Edit & Delete */}
      <div className="bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60">
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-xs uppercase text-primary font-bold flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">history_edu</span>
            <span>Match Ingestion & Recalibration History</span>
          </span>
          <span className="font-mono text-[10px] text-on-surface-variant">
            {activeMatchLogs.length} Partidos Registrados
          </span>
        </div>

        <p className="font-mono text-[10px] text-on-surface-variant mb-2">
          Haz clic en cualquier partido para abrir su pantalla de telemetría completa, o usa los botones para editar o borrar.
        </p>

        <div className="flex flex-col divide-y divide-surface-container-high/40">
          {activeMatchLogs.map((log: any) => (
            <div
              key={log._id}
              onClick={() => setSelectedMatchLog(log)}
              className="py-2.5 px-2 -mx-2 rounded-lg hover:bg-surface-container/70 transition-all cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-6 h-6 rounded flex items-center justify-center font-mono text-[9px] font-bold shrink-0 ${
                    log.isAway
                      ? "bg-secondary/20 text-secondary border border-secondary/30"
                      : "bg-primary/20 text-primary border border-primary/30"
                  }`}
                >
                  {log.isAway ? "A" : "H"}
                </span>
                <div className="truncate">
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold text-xs text-on-surface truncate group-hover:text-primary transition-colors">
                      vs {log.opponent}
                    </p>
                    {log.competition && (
                      <span
                        className={`font-mono text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                          log.competition === "ucl"
                            ? "bg-cyan-950/70 text-cyan-400 border border-cyan-800/50"
                            : "bg-emerald-950/70 text-emerald-400 border border-emerald-800/50"
                        }`}
                      >
                        {log.competition === "ucl" ? "UCL" : competitionLabel(log.competition)}
                      </span>
                    )}
                    <span className="material-symbols-outlined text-[13px] text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity">
                      arrow_forward
                    </span>
                  </div>
                  <p className="font-mono text-[10px] text-on-surface-variant">
                    {log.matchDate} • {log.tacticalRole || activePlayer?.position || ""} • {log.minutesPlayed}'
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0 font-mono text-xs">
                <div className="flex flex-col items-end">
                  <span className="text-on-surface font-bold">
                    {log.rawStats?.totalShots ?? log.rawStats?.shots ?? "—"} tiros
                  </span>
                  <span className="text-[10px] text-primary">
                    xG {log.rawStats?.xG ?? "—"}
                  </span>
                </div>
                <div className="px-2 py-0.5 rounded bg-surface-container-highest text-primary font-bold border border-primary/20">
                  {log.rawStats?.rating ?? "—"}
                </div>

                {/* Edit & Delete Quick Action Buttons */}
                <div className="flex items-center gap-1 ml-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => setEditingLog(log)}
                    title="Editar datos de este partido"
                    className="w-7 h-7 rounded bg-surface-container hover:bg-surface-bright flex items-center justify-center text-on-surface-variant hover:text-secondary transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px]">edit</span>
                  </button>
                  <button
                    onClick={(e) => handleDeleteMatch(log._id, log.opponent, e)}
                    title="Eliminar este partido"
                    className="w-7 h-7 rounded bg-surface-container hover:bg-rose-950/60 flex items-center justify-center text-on-surface-variant hover:text-rose-400 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pronóstico del próximo partido (distribución, no un número suelto) */}
      <div className="bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60">
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-xs uppercase text-primary font-bold flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">online_prediction</span>
            <span>Próximo partido</span>
          </span>
          <span className="font-mono text-[10px] text-on-surface-variant">intervalo 80%</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select
            value={nextOpponentTeamId}
            onChange={(e) => {
              setNextOpponentTeamId(e.target.value);
              setNextOpponent(teamName(e.target.value));
            }}
            className="col-span-2 h-9 px-2.5 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
          >
            <option value="">-- Rival (si está en la base se usa su fuerza defensiva) --</option>
            {(registeredTeams as any[]).map((tm: any) => (
              <option key={tm._id} value={tm._id}>
                {tm.name} ({tm.league?.toUpperCase()}
                {tm.defenseRating ? ` · def ${Number(tm.defenseRating).toFixed(2)}` : ""})
              </option>
            ))}
          </select>
          <div className="flex items-center gap-3 font-mono text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={!nextIsAway} onChange={() => setNextIsAway(false)} className="accent-primary" />
              Local
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={nextIsAway} onChange={() => setNextIsAway(true)} className="accent-primary" />
              Visitante
            </label>
          </div>
          <input
            type="number"
            min="1"
            max="120"
            value={nextMinutes}
            onChange={(e) => setNextMinutes(e.target.value)}
            placeholder={`Minutos (≈${profile?.expectedMinutes ?? 80})`}
            className="h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
          />
        </div>

        {forecastMetrics?.distribution && (
          <div className="mt-3 flex flex-col gap-1 font-mono text-[11px]">
            <p className="text-[10px] text-on-surface-variant">
              vs {forecastMetrics.opponent} ({forecastMetrics.isAway ? "fuera" : "casa"}) · {forecastMetrics.expectedMinutes}' ·
              contexto ×{fmt(forecastMetrics.contextMultiplier)} · {forecastMetrics.matchesUsed} partidos usados
            </p>
            {STAT_ORDER.map((s) => {
              const d = forecastMetrics.distribution[s.key];
              if (!d) return null;
              return (
                <div key={s.key} className="flex items-center justify-between border-b border-surface-container-high/40 py-1">
                  <span className="text-on-surface-variant">{s.name}</span>
                  <span>
                    <span className="text-primary font-bold">{fmt(d.mean)}</span>
                    <span className="text-on-surface-variant"> [{fmt(d.low, 1)}–{fmt(d.high, 1)}]</span>
                    {d.pAtLeast?.["1"] !== undefined && (
                      <span className="text-secondary">
                        {" "}
                        P(≥1) {Math.round(d.pAtLeast["1"] * 100)}% · P(≥2) {Math.round(d.pAtLeast["2"] * 100)}%
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-surface-container-high/40 flex items-center justify-between">
          <p className="font-mono text-[10px] text-on-surface-variant">
            Media por 90 del perfil × minutos × contexto, con la incertidumbre del perfil.
          </p>
          <button
            onClick={runPredictiveSimulation}
            disabled={isSimulating || !activePlayer}
            className="px-3 py-1.5 bg-primary text-on-primary rounded-lg font-mono text-xs font-bold shadow-md hover:opacity-90 active:scale-95 transition-all"
          >
            {isSimulating ? "Calculando…" : "Pronosticar"}
          </button>
        </div>
      </div>

      {/* Modal: editar ficha del jugador */}
      {editingPlayer && activePlayer && (
        <div className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain flex justify-center bg-black/80 backdrop-blur-sm p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setPlayerError(null);
              setSavingPlayer(true);
              try {
                await updatePlayerMutation({
                  playerId: activePlayer._id,
                  name: editingPlayer.name,
                  position: editingPlayer.position,
                  number: editingPlayer.number === "" ? null : Number(editingPlayer.number),
                  age: editingPlayer.age === "" ? null : Number(editingPlayer.age),
                });
                setEditingPlayer(null);
              } catch (err: any) {
                setPlayerError(err?.message ?? String(err));
              } finally {
                setSavingPlayer(false);
              }
            }}
            className="bg-surface-container-low border border-primary/40 rounded-2xl w-full max-w-md p-5 shadow-2xl my-auto flex flex-col gap-3"
          >
            <div className="flex items-center justify-between pb-3 border-b border-surface-container-high">
              <h3 className="font-bold text-base text-on-surface">Ficha del jugador</h3>
              <button
                type="button"
                onClick={() => setEditingPlayer(null)}
                className="w-8 h-8 rounded-lg bg-surface-container text-on-surface-variant hover:text-on-surface"
              >
                ✕
              </button>
            </div>
            <input
              value={editingPlayer.name}
              onChange={(e) => setEditingPlayer({ ...editingPlayer, name: e.target.value })}
              className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
              placeholder="Nombre"
              required
            />
            <div>
              <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">Posición</label>
              <div className="grid grid-cols-5 gap-1">
                {(
                  [
                    ["GK", "Portero"],
                    ["DF", "Defensa"],
                    ["MF", "Medio"],
                    ["AM", "Mediapunta"],
                    ["FW", "Delantero"],
                  ] as const
                ).map(([code, label]) => {
                  const selected = editingPlayer.position.toUpperCase().startsWith(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setEditingPlayer({ ...editingPlayer, position: code })}
                      className={`py-1.5 rounded-lg font-mono text-[10px] border ${
                        selected
                          ? "bg-primary text-on-primary font-bold border-primary"
                          : "bg-surface-container text-on-surface-variant border-surface-container-high"
                      }`}
                    >
                      <span className="block font-bold">{code}</span>
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="font-mono text-[9px] text-on-surface-variant mt-1">
                Tasa base por 90&apos; (antes de sus propios partidos):{" "}
                {
                  {
                    GK: "0 tiros · 0.00 xG · 0.1 pases clave",
                    DF: "0.6 tiros · 0.05 xG · 0.6 pases clave",
                    MF: "1.2 tiros · 0.10 xG · 1.2 pases clave",
                    AM: "2.2 tiros · 0.25 xG · 1.9 pases clave",
                    FW: "2.6 tiros · 0.38 xG · 1.1 pases clave",
                  }[editingPlayer.position.toUpperCase().slice(0, 2)] ?? "según el texto de la posición"
                }
                . Al cambiarla, el perfil se recalcula.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min="1"
                value={editingPlayer.number}
                onChange={(e) => setEditingPlayer({ ...editingPlayer, number: e.target.value })}
                placeholder="Dorsal"
                className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
              />
              <input
                type="number"
                min="14"
                value={editingPlayer.age}
                onChange={(e) => setEditingPlayer({ ...editingPlayer, age: e.target.value })}
                placeholder="Edad"
                className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
              />
            </div>
            {playerError && <p className="font-mono text-[11px] text-error">{playerError}</p>}
            <div className="pt-3 border-t border-surface-container-high flex justify-end gap-2 sticky bottom-0 bg-surface-container-low">
              <button
                type="button"
                onClick={() => setEditingPlayer(null)}
                className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface-variant font-mono text-xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingPlayer}
                className="px-4 py-1.5 rounded-lg bg-primary text-on-primary font-mono text-xs font-bold"
              >
                {savingPlayer ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Quick Edit Modal */}
      {editingLog && (
        <div className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain flex justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface-container-low border border-secondary/40 rounded-2xl w-full max-w-md p-5 shadow-2xl my-auto relative">
            <div className="flex items-center justify-between pb-3 border-b border-surface-container-high">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-[20px]">edit</span>
                <h3 className="font-bold text-base text-on-surface">Editar Partido</h3>
              </div>
              <button
                onClick={() => setEditingLog(null)}
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleQuickEditSubmit} className="flex flex-col gap-3 mt-3">
              <div>
                <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                  Rival
                </label>
                <input
                  type="text"
                  value={editingLog.opponent}
                  onChange={(e) => setEditingLog({ ...editingLog, opponent: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">Competición</label>
                  <select
                    value={editingLog.competition ?? ""}
                    onChange={(e) => setEditingLog({ ...editingLog, competition: e.target.value })}
                    className="w-full h-9 px-2 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
                  >
                    {!COMPETITIONS.some((c) => c.code === editingLog.competition) && (
                      <option value={editingLog.competition ?? ""}>{editingLog.competition || "—"}</option>
                    )}
                    {COMPETITIONS.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">Local / visitante</label>
                  <select
                    value={editingLog.isAway ? "a" : "h"}
                    onChange={(e) => setEditingLog({ ...editingLog, isAway: e.target.value === "a" })}
                    className="w-full h-9 px-2 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
                  >
                    <option value="h">Local</option>
                    <option value="a">Visitante</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                  Equipo rival (usa su fuerza defensiva)
                </label>
                <select
                  value={editingLog.opponentTeamId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value || null;
                    const found = (registeredTeams as any[]).find((t: any) => t._id === id);
                    setEditingLog({ ...editingLog, opponentTeamId: id, opponent: found ? found.name : editingLog.opponent });
                  }}
                  className="w-full h-9 px-2 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
                >
                  <option value="">— Sin vincular (solo el nombre) —</option>
                  {(registeredTeams as any[])
                    .filter((tm: any) => tm._id !== activeTeam?._id)
                    .sort((x: any, y: any) => x.name.localeCompare(y.name))
                    .map((tm: any) => (
                      <option key={tm._id} value={tm._id}>
                        {tm.name} ({tm.league?.toUpperCase()})
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Fecha
                  </label>
                  <input
                    type="date"
                    value={editingLog.matchDate}
                    onChange={(e) => setEditingLog({ ...editingLog, matchDate: e.target.value })}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Minutos
                  </label>
                  <input
                    type="number"
                    value={editingLog.minutesPlayed}
                    onChange={(e) => setEditingLog({ ...editingLog, minutesPlayed: Number(e.target.value) })}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["keyPasses", "Pases clave", "1"],
                    ["groundDuelsWon", "Duelos", "1"],
                  ] as const
                ).map(([k, label, step]) => (
                  <div key={k}>
                    <label className="block text-[9px] font-mono text-on-surface-variant uppercase mb-0.5">{label}</label>
                    <input
                      type="number"
                      step={step}
                      value={editingLog.rawStats?.[k] ?? ""}
                      onChange={(e) =>
                        setEditingLog({
                          ...editingLog,
                          rawStats: {
                            ...editingLog.rawStats,
                            [k]: e.target.value === "" ? undefined : Number(e.target.value),
                          },
                        })
                      }
                      className="w-full h-8 px-2 rounded bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-[9px] font-mono text-on-surface-variant uppercase mb-0.5">
                    Tiros
                  </label>
                  <input
                    type="number"
                    value={editingLog.rawStats?.totalShots ?? 0}
                    onChange={(e) =>
                      setEditingLog({
                        ...editingLog,
                        rawStats: { ...editingLog.rawStats, totalShots: Number(e.target.value) },
                      })
                    }
                    className="w-full h-8 px-2 rounded bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-mono text-on-surface-variant uppercase mb-0.5">
                    xG
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingLog.rawStats?.xG ?? 0}
                    onChange={(e) =>
                      setEditingLog({
                        ...editingLog,
                        rawStats: { ...editingLog.rawStats, xG: Number(e.target.value) },
                      })
                    }
                    className="w-full h-8 px-2 rounded bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-mono text-on-surface-variant uppercase mb-0.5">
                    Rating
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingLog.rawStats?.rating ?? ""}
                    onChange={(e) =>
                      setEditingLog({
                        ...editingLog,
                        rawStats: { ...editingLog.rawStats, rating: Number(e.target.value) },
                      })
                    }
                    className="w-full h-8 px-2 rounded bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
                  />
                </div>
              </div>

              <div className="mt-3 pt-3 pb-1 border-t border-surface-container-high flex items-center justify-end gap-2 sticky bottom-0 bg-surface-container-low z-10">
                <button
                  type="button"
                  onClick={() => setEditingLog(null)}
                  className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface-variant font-mono text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="px-4 py-1.5 rounded-lg bg-secondary text-black font-mono text-xs font-bold shadow-lg"
                >
                  {isSavingEdit ? "Guardando..." : "Actualizar Partido"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Registrar Siguiente Partido (Test del Loop P1 -> P2) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain flex justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface-container-low border border-primary/40 rounded-2xl w-full max-w-md p-5 shadow-2xl my-auto relative">
            <div className="flex items-center justify-between pb-3 border-b border-surface-container-high">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">add_circle</span>
                <h3 className="font-bold text-base text-on-surface">Registrar partido jugado</h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRegisterMatch} className="flex flex-col gap-3 mt-3">
              <p className="text-xs text-on-surface-variant">
                Se compara con la predicción que el modelo hacía <b>antes</b> de este partido y el perfil se
                recalcula con todos los partidos. Deja vacío lo que no tengas: no se inventa nada.
              </p>

              {/* Partido del equipo: elegir uno ya creado o crear uno nuevo */}
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 flex flex-col gap-1.5">
                <span className="flex items-center gap-1 text-[10px] font-mono text-primary uppercase">
                  <span className="material-symbols-outlined text-[14px]">event</span>
                  Partido de {activeTeam?.name ?? "su equipo"}
                </span>
                {selectedTeamMatch ? (
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-on-surface">
                      {selectedTeamMatch.date} · {selectedTeamMatch.isHome ? "vs" : "en"} {selectedTeamMatch.opponent} ·{" "}
                      {competitionLabel(selectedTeamMatch.competition)}
                    </span>
                    <button type="button" onClick={() => pickTeamMatch(null)} className="text-secondary text-[10px]">
                      cambiar
                    </button>
                  </div>
                ) : (
                  <>
                    {teamRecentMatches.length > 0 && (
                      <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
                        {(teamRecentMatches as any[]).map((m: any) => (
                          <button
                            key={m._id}
                            type="button"
                            disabled={m.loggedByPlayer}
                            onClick={() => pickTeamMatch(m)}
                            className="flex items-center justify-between px-2 py-1.5 rounded bg-surface-container hover:bg-surface-container-high text-left font-mono text-[10px] disabled:opacity-40"
                          >
                            <span className="truncate">
                              {m.date} · {m.isHome ? "vs" : "en"} {m.opponent}
                              <span className="text-on-surface-variant"> · {competitionLabel(m.competition)}</span>
                            </span>
                            <span className="shrink-0 ml-2 text-on-surface-variant">
                              {m.goalsFor !== null ? `${m.goalsFor}-${m.goalsAgainst}` : "s/m"}
                              {m.playersLogged ? ` · ${m.playersLogged}👤` : ""}
                              {m.loggedByPlayer ? " · ya registrado" : ""}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="font-mono text-[9px] text-on-surface-variant">
                      {teamRecentMatches.length
                        ? "Toca un partido para reutilizarlo (fecha, rival y competición se rellenan solos), o completa los datos de abajo para uno nuevo."
                        : "Completa los datos de abajo: se creará el partido en el perfil del equipo."}
                    </p>
                  </>
                )}
                {(!selectedTeamMatch || selectedTeamMatch.goalsFor === null) && (
                  <div className="flex items-center gap-2 font-mono text-[10px] text-on-surface-variant">
                    <span>Marcador (opcional):</span>
                    <input
                      type="number"
                      min="0"
                      value={teamGoals}
                      onChange={(e) => setTeamGoals(e.target.value)}
                      placeholder={activeTeam?.shortName ?? "Equipo"}
                      className="w-16 h-8 px-2 rounded bg-surface-container text-on-surface border border-surface-container-high"
                    />
                    <span>-</span>
                    <input
                      type="number"
                      min="0"
                      value={opponentGoals}
                      onChange={(e) => setOpponentGoals(e.target.value)}
                      placeholder="Rival"
                      className="w-16 h-8 px-2 rounded bg-surface-container text-on-surface border border-surface-container-high"
                    />
                  </div>
                )}
                {!selectedTeamMatch && !selectedOpponentTeamId && (
                  <p className="font-mono text-[9px] text-tertiary">
                    Elige el rival de la lista para que el partido quede también en el perfil del equipo.
                  </p>
                )}
              </div>

              {/* Pegar estadísticas de Sofascore / FotMob */}
              <div className="rounded-lg border border-secondary/30 bg-secondary/5 p-2.5 flex flex-col gap-1.5">
                <label className="flex items-center justify-between text-[10px] font-mono text-secondary uppercase">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">content_paste</span>
                    Pegar estadísticas (Sofascore / FotMob)
                  </span>
                  {pastedStats && (
                    <button
                      type="button"
                      onClick={() => applyPastedStats("")}
                      className="normal-case text-on-surface-variant hover:text-on-surface"
                    >
                      limpiar
                    </button>
                  )}
                </label>
                <textarea
                  value={pastedText}
                  onChange={(e) => applyPastedStats(e.target.value)}
                  placeholder={"General\nGoals\n0\nExpected goals (xG)\n1.24\n…"}
                  rows={4}
                  className="w-full px-2.5 py-2 rounded-lg bg-surface-container text-on-surface font-mono text-[11px] border border-surface-container-high focus:outline-none focus:border-secondary resize-y"
                />
                {pasteInfo && (
                  <p className={`font-mono text-[10px] ${pastedStats ? "text-primary" : "text-tertiary"}`}>{pasteInfo}</p>
                )}
                {pastedStats && (
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {Object.entries(pastedStats).map(([k, v]) => (
                      <span
                        key={k}
                        className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant"
                      >
                        {k} <b className="text-on-surface">{v}</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Competición y Fecha */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Competición / Torneo
                  </label>
                  <select
                    value={matchCompetition}
                    disabled={!!selectedTeamMatch}
                    onChange={(e) => setMatchCompetition(e.target.value)}
                    className="w-full h-9 px-2 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                  >
                    {COMPETITIONS.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Fecha de Partido
                  </label>
                  <input
                    type="date"
                    value={matchDate}
                    disabled={!!selectedTeamMatch}
                    onChange={(e) => setMatchDate(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                    required
                  />
                </div>
              </div>

              {/* Rival Selection (con vinculación a clubes registrados en Convex) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase">
                    Rival del Partido
                  </label>
                  <span className="text-[10px] font-mono text-secondary">
                    elegirlo de la lista usa su fuerza defensiva
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <select
                    value={selectedOpponentTeamId}
                    disabled={!!selectedTeamMatch}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelectedOpponentTeamId(id);
                      if (id) {
                        const found = (registeredTeams as any[]).find((t: any) => t._id === id);
                        if (found) setMatchOpponent(found.name);
                      }
                    }}
                    className="w-full h-9 px-2.5 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                  >
                    <option value="">-- Seleccionar club existente o escribir manual --</option>
                    {(registeredTeams as any[])
                      .filter((tm: any) => tm._id !== activeTeam?._id)
                      .sort(
                        (x: any, y: any) =>
                          Number(y.league === activeTeam?.league) - Number(x.league === activeTeam?.league) ||
                          x.name.localeCompare(y.name)
                      )
                      .map((tm: any) => (
                        <option key={tm._id} value={tm._id}>
                          {tm.name} ({tm.league?.toUpperCase()})
                        </option>
                      ))}
                  </select>

                  <input
                    type="text"
                    value={matchOpponent}
                    disabled={!!selectedTeamMatch}
                    onChange={(e) => setMatchOpponent(e.target.value)}
                    placeholder="Nombre del rival..."
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <label className="flex items-center gap-2 text-xs font-mono cursor-pointer">
                  <input
                    type="radio"
                    checked={matchIsAway}
                    disabled={!!selectedTeamMatch}
                    onChange={() => setMatchIsAway(true)}
                    className="accent-primary"
                  />
                  <span>Visitante (Away)</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-mono cursor-pointer">
                  <input
                    type="radio"
                    checked={!matchIsAway}
                    disabled={!!selectedTeamMatch}
                    onChange={() => setMatchIsAway(false)}
                    className="accent-primary"
                  />
                  <span>Local</span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Minutos jugados
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max="130"
                    value={matchMinutes}
                    onChange={(e) => setMatchMinutes(Number(e.target.value))}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Duelos ganados
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={actualDuels}
                    onChange={(e) => setActualDuels(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Disparos Totales
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={actualShots}
                    onChange={(e) => setActualShots(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                    
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    xG Generado
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={actualXg}
                    onChange={(e) => setActualXg(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                    
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Pases Clave
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={actualKeyPasses}
                    onChange={(e) => setActualKeyPasses(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                    
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Rating Sofascore
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    max="10"
                    value={actualRating}
                    onChange={(e) => setActualRating(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                    
                  />
                </div>
              </div>

              <div className="mt-3 pt-3 pb-1 border-t border-surface-container-high flex items-center justify-end gap-2 sticky bottom-0 bg-surface-container-low z-10">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface-variant font-mono text-xs hover:text-on-surface"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingMatch}
                  className="px-4 py-1.5 rounded-lg bg-primary text-on-primary font-mono text-xs font-bold shadow-lg hover:opacity-90 active:scale-95 transition-all flex items-center gap-1"
                >
                  {isSubmittingMatch ? (
                    <>
                      <span className="material-symbols-outlined text-[14px] animate-spin">
                        progress_activity
                      </span>
                      <span>CALIBRANDO...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[14px]">bolt</span>
                      <span>REGISTRAR Y RECALIBRAR</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
