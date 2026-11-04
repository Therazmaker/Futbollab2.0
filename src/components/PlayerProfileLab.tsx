"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { INITIAL_PLAYER, PlayerData } from "@/data/mock-data";
import { syncEngine } from "@/lib/offline-sync";
import { BrainTargetRadar, PredictionMetricPoint } from "./BrainTargetRadar";

interface PlayerProfileLabProps {
  onBackToExplorer: () => void;
  onOpenTactics: () => void;
}

export function PlayerProfileLab({ onBackToExplorer, onOpenTactics }: PlayerProfileLabProps) {
  // Convex Reactive Hooks
  const profileData = useQuery(api.players.getPlayerProfile, {});
  const seedDemo = useMutation(api.players.seedBellinghamDemo);
  const calibrateMutation = useMutation(api.predictions.recordMatchAndCalibrate);
  const predictMutation = useMutation(api.predictions.calculateAndPredict);

  // Local state fallbacks & Interactive Sandbox
  const [player, setPlayer] = useState<PlayerData>(INITIAL_PLAYER);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [fatigueFactor, setFatigueFactor] = useState<number>(15);
  const [tacticalDepth, setTacticalDepth] = useState<number>(75);

  // Radar fixture switch state
  const [selectedRadarFixture, setSelectedRadarFixture] = useState<"p1" | "p2" | "p3">("p2");

  // Ingest / Calibrate Modal state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSubmittingMatch, setIsSubmittingMatch] = useState<boolean>(false);
  const [matchOpponent, setMatchOpponent] = useState<string>("Athletic Club (San Mamés)");
  const [matchIsAway, setMatchIsAway] = useState<boolean>(true);
  const [actualShots, setActualShots] = useState<number>(3);
  const [actualXg, setActualXg] = useState<number>(0.42);
  const [actualKeyPasses, setActualKeyPasses] = useState<number>(3);
  const [actualRating, setActualRating] = useState<number>(8.3);
  const [lastCalibrationNotice, setLastCalibrationNotice] = useState<string | null>(null);

  // Auto-seed demo on first mount if database is empty
  useEffect(() => {
    if (profileData === null) {
      seedDemo().catch(() => {});
    }
  }, [profileData, seedDemo]);

  // Sync profile data from Convex when available
  const activePlayer = profileData?.player;
  const activeWeights = profileData?.weights || [];
  const activeMatchLogs = profileData?.matchLogs || [];
  const latestPrediction = profileData?.latestPrediction;

  const currentPredictiveForm =
    latestPrediction?.predictedMetrics?.predictiveForm ?? player.predictiveForm;
  const currentConfidence =
    latestPrediction?.predictedMetrics?.confidence ?? player.confidence;

  const currentShotsPred =
    latestPrediction?.predictedMetrics?.shotsPredicted ?? player.metrics.shotsPredicted;
  const currentShotsObs =
    latestPrediction?.actualMetrics?.totalShots ?? player.metrics.shotsObserved;
  const shotsDelta = latestPrediction?.deltas?.totalShots ?? -0.3;

  const currentXgPred = latestPrediction?.predictedMetrics?.xG ?? 0.35;
  const currentXgObs = latestPrediction?.actualMetrics?.xG ?? 0.31;
  const xgDelta = latestPrediction?.deltas?.xG ?? -0.04;

  const currentKpPred =
    latestPrediction?.predictedMetrics?.keyPassesPredicted ?? player.metrics.keyPassesPredicted;
  const currentKpObs =
    latestPrediction?.actualMetrics?.keyPasses ?? player.metrics.keyPassesObserved;
  const kpDelta = latestPrediction?.deltas?.keyPasses ?? -0.3;

  // Radar Metrics calculation based on selected fixture / Convex state
  const radarMetrics: PredictionMetricPoint[] = useMemo(() => {
    if (selectedRadarFixture === "p1") {
      // Early training state (high variance / wide error dispersion)
      return [
        { id: "shots_p1", name: "Tiros", predicted: 3.4, actual: 2.0, matchIndex: 1, categoryAngle: 45 },
        { id: "xg_p1", name: "xG Gen", predicted: 0.52, actual: 0.25, matchIndex: 1, categoryAngle: 135 },
        { id: "kp_p1", name: "Pases Clave", predicted: 3.8, actual: 2.2, matchIndex: 1, categoryAngle: 225 },
        { id: "duels_p1", name: "Duelos %", predicted: 76, actual: 52, matchIndex: 1, categoryAngle: 315 },
      ];
    }

    if (selectedRadarFixture === "p3") {
      // Optimal converged forecast (tight bullseye cluster)
      return [
        { id: "shots_p3", name: "Tiros", predicted: 2.3, actual: 2.2, matchIndex: 3, categoryAngle: 45 },
        { id: "xg_p3", name: "xG Gen", predicted: 0.34, actual: 0.33, matchIndex: 3, categoryAngle: 135 },
        { id: "kp_p3", name: "Pases Clave", predicted: 2.9, actual: 2.9, matchIndex: 3, categoryAngle: 225 },
        { id: "duels_p3", name: "Duelos %", predicted: 67, actual: 65, matchIndex: 3, categoryAngle: 315 },
      ];
    }

    // Default: P2 (Current calibrated state using Convex values or latest log)
    return [
      {
        id: "shots_p2",
        name: "Tiros",
        predicted: currentShotsPred,
        actual: currentShotsObs,
        matchIndex: 2,
        categoryAngle: 45,
      },
      {
        id: "xg_p2",
        name: "xG Gen",
        predicted: currentXgPred,
        actual: currentXgObs,
        matchIndex: 2,
        categoryAngle: 135,
      },
      {
        id: "kp_p2",
        name: "Pases Clave",
        predicted: currentKpPred,
        actual: currentKpObs,
        matchIndex: 2,
        categoryAngle: 225,
      },
      {
        id: "duels_p2",
        name: "Duelos %",
        predicted: 68.4,
        actual: 64.0,
        matchIndex: 2,
        categoryAngle: 315,
      },
    ];
  }, [
    selectedRadarFixture,
    currentShotsPred,
    currentShotsObs,
    currentXgPred,
    currentXgObs,
    currentKpPred,
    currentKpObs,
  ]);

  const runPredictiveSimulation = async () => {
    setIsSimulating(true);
    await new Promise((r) => setTimeout(r, 400));

    if (activePlayer?._id) {
      try {
        await predictMutation({
          playerId: activePlayer._id,
          opponent: matchOpponent,
          isAway: matchIsAway,
          tacticalRole: "AM / Box-to-Box",
          contextFeatures: matchIsAway ? ["is_away"] : ["home_pitch_bias"],
        });
      } catch (e) {
        console.warn("Convex predict mutation fallback:", e);
      }
    }

    // Also queue via local-first engine
    await syncEngine.enqueue("SIMULATE_MATCH", `player_${player.id}`, {
      fatigueFactor,
      tacticalDepth,
      timestamp: Date.now(),
    });

    setIsSimulating(false);
  };

  // Submit actual match result and trigger gradient calibration P1 -> P2
  const handleRegisterMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingMatch(true);

    try {
      const response = await fetch("/api/ingest-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: activePlayer?._id,
          matchDate: new Date().toISOString().split("T")[0],
          opponent: matchOpponent,
          isAway: matchIsAway,
          minutesPlayed: 90,
          rawStats: {
            totalShots: actualShots,
            shotsOnTarget: Math.max(1, actualShots - 1),
            xG: actualXg,
            keyPasses: actualKeyPasses,
            rating: actualRating,
            touches: 78,
          },
        }),
      });

      const data = await response.json();
      if (data.success) {
        setLastCalibrationNotice(
          `¡Calibración exitosa! Delta disparos: ${data.calibration?.deltas?.totalShots ?? 0}. Peso recalculado: ${data.calibration?.calibratedWeight?.featureName} (${data.calibration?.calibratedWeight?.newValue})`
        );
        setSelectedRadarFixture("p2");
        setIsModalOpen(false);
      }
    } catch (err) {
      console.error("Match calibration error:", err);
    } finally {
      setIsSubmittingMatch(false);
    }
  };

  return (
    <div className="flex flex-col w-full gap-space-md">
      {/* Tactical Breadcrumbs & Live Model Status */}
      <div className="flex items-center justify-between px-space-xs text-on-surface-variant">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <button
            onClick={onBackToExplorer}
            className="flex items-center text-secondary hover:text-primary transition-colors text-[16px]"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          </button>
          <div className="flex items-center gap-1 truncate font-mono text-[11px] uppercase tracking-wider">
            <span className="text-on-surface-variant/70">LaLiga</span>
            <span className="text-outline-variant">/</span>
            <span className="text-on-surface-variant/70 cursor-pointer" onClick={onOpenTactics}>
              Real Madrid
            </span>
            <span className="text-outline-variant">/</span>
            <span className="text-primary font-semibold">
              {activePlayer?.name || player.name} #{player.number}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-surface-container-high px-2 py-0.5 rounded shadow-sm shrink-0 border border-primary/20">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
          <span className="font-mono text-[10px] text-primary font-bold">
            MODEL RUN: {currentConfidence}% CONF
          </span>
        </div>
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
                  src={activePlayer?.photoUrl || player.photoUrl}
                  alt={activePlayer?.name || player.name}
                  className="w-14 h-14 rounded-xl object-cover bg-surface-container shadow-md border border-primary/30"
                />
                <span className="absolute -bottom-1 -right-1 bg-surface-container-lowest text-secondary font-mono text-[10px] font-bold px-1.5 py-0.2 rounded shadow-sm border border-secondary/30">
                  #{player.number}
                </span>
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h2 className="text-lg font-bold text-on-surface tracking-tight truncate">
                    {activePlayer?.name || player.name}
                  </h2>
                  <span className="bg-surface-container-highest text-secondary font-mono text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold">
                    {player.nationality}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="bg-primary/10 text-primary font-mono text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wider border border-primary/20">
                    {activePlayer?.position || player.position}
                  </span>
                  <span className="text-on-surface-variant text-xs font-sans">
                    Age {player.age} • {player.height} cm
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setIsModalOpen(true)}
                title="Registrar resultado de partido para recalibrar pesos (P1 -> P2)"
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
                  Predictive Form
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
                  Pitch Bias Delta
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-ping"></span>
              </div>
              <div className="flex items-center gap-1 mt-1">
                <span className="bg-secondary/15 text-secondary font-mono text-[11px] px-1.5 py-0.2 rounded font-bold">
                  +{player.pitchBiasDelta}%
                </span>
                <span className="text-xs text-on-surface truncate">Home Advantage</span>
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
            <span>Active Contextual Weights (Convex Model)</span>
          </span>
          <span className="font-mono text-[10px] text-primary">GRADIENT LEARNING</span>
        </div>

        <div className="grid grid-cols-2 xs:grid-cols-4 gap-2">
          {activeWeights.length > 0 ? (
            activeWeights.map((w: any) => {
              const pct = (w.weightValue * 100).toFixed(1);
              const isPositive = w.weightValue >= 0;
              return (
                <div
                  key={w._id}
                  className="bg-surface-container-low rounded-lg p-2 border border-surface-container-high flex flex-col justify-between"
                >
                  <span className="font-mono text-[9px] text-on-surface-variant truncate uppercase">
                    {w.featureName.replace(/_/g, " ")}
                  </span>
                  <div className="flex items-baseline justify-between mt-1">
                    <span
                      className={`font-mono text-xs font-bold ${
                        isPositive ? "text-primary" : "text-tertiary"
                      }`}
                    >
                      {isPositive ? `+${pct}%` : `${pct}%`}
                    </span>
                    <span className="font-mono text-[9px] text-on-surface-variant">
                      {(w.confidenceScore * 100).toFixed(0)}% conf
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <>
              <div className="bg-surface-container-low rounded-lg p-2 border border-surface-container-high flex flex-col justify-between">
                <span className="font-mono text-[9px] text-on-surface-variant uppercase">is away</span>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="font-mono text-xs font-bold text-tertiary">-12.0%</span>
                  <span className="font-mono text-[9px] text-on-surface-variant">85% conf</span>
                </div>
              </div>
              <div className="bg-surface-container-low rounded-lg p-2 border border-surface-container-high flex flex-col justify-between">
                <span className="font-mono text-[9px] text-on-surface-variant uppercase">low block</span>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="font-mono text-xs font-bold text-tertiary">-8.0%</span>
                  <span className="font-mono text-[9px] text-on-surface-variant">72% conf</span>
                </div>
              </div>
              <div className="bg-surface-container-low rounded-lg p-2 border border-surface-container-high flex flex-col justify-between">
                <span className="font-mono text-[9px] text-on-surface-variant uppercase">partner rest</span>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="font-mono text-xs font-bold text-primary">+6.0%</span>
                  <span className="font-mono text-[9px] text-on-surface-variant">65% conf</span>
                </div>
              </div>
              <div className="bg-surface-container-low rounded-lg p-2 border border-surface-container-high flex flex-col justify-between">
                <span className="font-mono text-[9px] text-on-surface-variant uppercase">home pitch</span>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="font-mono text-xs font-bold text-primary">+8.4%</span>
                  <span className="font-mono text-[9px] text-on-surface-variant">90% conf</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 90-Minute Expected vs Observed Metric Grid */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between px-space-xs">
          <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider font-semibold">
            90-Minute Expected vs Observed & Error Deltas
          </span>
          <span className="font-mono text-[10px] text-secondary">CALIBRATED DELTAS</span>
        </div>

        <div className="grid grid-cols-2 gap-space-sm">
          {/* Shots */}
          <div className="bg-surface-container-low rounded-xl p-space-sm flex flex-col justify-between shadow-md border border-surface-container-high/60">
            <div className="flex items-center justify-between">
              <span className="text-xs text-on-surface-variant font-medium">Shots / 90</span>
              <span
                className={`font-mono text-[10px] px-1.5 py-0.2 rounded font-bold ${
                  shotsDelta >= 0 ? "bg-primary/10 text-primary" : "bg-tertiary/10 text-tertiary"
                }`}
              >
                {shotsDelta >= 0 ? `+${shotsDelta}` : `${shotsDelta}`} delta
              </span>
            </div>
            <div className="my-2">
              <div className="flex items-baseline justify-between font-mono text-lg font-bold">
                <span className="text-on-surface">{currentShotsObs}</span>
                <span className="text-xs text-on-surface-variant/80">pred {currentShotsPred}</span>
              </div>
              <div className="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden mt-1.5">
                <div
                  className="bg-secondary h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (currentShotsObs / Math.max(currentShotsPred, 1)) * 85)}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Key Passes */}
          <div className="bg-surface-container-low rounded-xl p-space-sm flex flex-col justify-between shadow-md border border-surface-container-high/60">
            <div className="flex items-center justify-between">
              <span className="text-xs text-on-surface-variant font-medium">Key Passes</span>
              <span
                className={`font-mono text-[10px] px-1.5 py-0.2 rounded font-bold ${
                  kpDelta >= 0 ? "bg-primary/10 text-primary" : "bg-tertiary/10 text-tertiary"
                }`}
              >
                {kpDelta >= 0 ? `+${kpDelta}` : `${kpDelta}`} delta
              </span>
            </div>
            <div className="my-2">
              <div className="flex items-baseline justify-between font-mono text-lg font-bold">
                <span className="text-on-surface">{currentKpObs}</span>
                <span className="text-xs text-on-surface-variant/80">pred {currentKpPred}</span>
              </div>
              <div className="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden mt-1.5">
                <div
                  className="bg-primary h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (currentKpObs / Math.max(currentKpPred, 1)) * 90)}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* xG Expected */}
          <div className="bg-surface-container-low rounded-xl p-space-sm flex flex-col justify-between shadow-md border border-surface-container-high/60">
            <div className="flex items-center justify-between">
              <span className="text-xs text-on-surface-variant font-medium">xG Generation</span>
              <span
                className={`font-mono text-[10px] px-1.5 py-0.2 rounded font-bold ${
                  xgDelta >= 0 ? "bg-primary/10 text-primary" : "bg-tertiary/10 text-tertiary"
                }`}
              >
                {xgDelta >= 0 ? `+${xgDelta}` : `${xgDelta}`} delta
              </span>
            </div>
            <div className="my-2">
              <div className="flex items-baseline justify-between font-mono text-lg font-bold">
                <span className="text-on-surface">{currentXgObs}</span>
                <span className="text-xs text-on-surface-variant/80">pred {currentXgPred}</span>
              </div>
              <div className="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden mt-1.5">
                <div
                  className="bg-primary h-full rounded-full transition-all duration-500"
                  style={{ width: "78%" }}
                ></div>
              </div>
            </div>
          </div>

          {/* Aerial Duel % / xT */}
          <div className="bg-surface-container-low rounded-xl p-space-sm flex flex-col justify-between shadow-md border border-surface-container-high/60">
            <div className="flex items-center justify-between">
              <span className="text-xs text-on-surface-variant font-medium">xT Threat p90</span>
              <span className="bg-secondary/10 text-secondary font-mono text-[10px] px-1.5 py-0.2 rounded font-bold">
                TOP 2%
              </span>
            </div>
            <div className="my-2">
              <div className="flex items-baseline justify-between font-mono text-lg font-bold">
                <span className="text-secondary">{player.metrics.xtThreat}</span>
                <span className="text-xs text-on-surface-variant/80">impact idx</span>
              </div>
              <div className="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden mt-1.5">
                <div className="bg-secondary h-full rounded-full" style={{ width: "94%" }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* BRAIN TARGET CONVERGENCE RADAR & FIXTURE SELECTOR */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-space-xs">
          <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider font-semibold flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px] text-primary">adjust</span>
            <span>Trayectoria de Convergencia del Modelo</span>
          </span>

          {/* Fixture Selector Switch */}
          <div className="flex items-center gap-1 bg-surface-container rounded-lg p-0.5 border border-surface-container-highest">
            <button
              onClick={() => setSelectedRadarFixture("p1")}
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all ${
                selectedRadarFixture === "p1"
                  ? "bg-surface-container-highest text-tertiary font-bold shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              P1 (Base)
            </button>
            <button
              onClick={() => setSelectedRadarFixture("p2")}
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all ${
                selectedRadarFixture === "p2"
                  ? "bg-primary text-on-primary font-bold shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              P2 (vs Athletic)
            </button>
            <button
              onClick={() => setSelectedRadarFixture("p3")}
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all ${
                selectedRadarFixture === "p3"
                  ? "bg-secondary text-on-secondary font-bold shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              P3 (Bullseye Core)
            </button>
          </div>
        </div>

        {/* Polar Bullseye Radar Component */}
        <BrainTargetRadar
          metrics={radarMetrics}
          selectedMatchLabel={
            selectedRadarFixture === "p1"
              ? "Dispersión Inicial (P1 Base)"
              : selectedRadarFixture === "p2"
              ? "Calibración en Vivo (P2 vs Athletic)"
              : "Convergencia Óptima (P3 Bullseye)"
          }
        />
      </div>

      {/* Match History & Prediction Calibration Log */}
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

        <div className="flex flex-col divide-y divide-surface-container-high/40">
          {activeMatchLogs.map((log: any) => (
            <div key={log._id} className="py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-5 h-5 rounded flex items-center justify-center font-mono text-[9px] font-bold shrink-0 ${
                    log.isAway
                      ? "bg-secondary/20 text-secondary border border-secondary/30"
                      : "bg-primary/20 text-primary border border-primary/30"
                  }`}
                >
                  {log.isAway ? "A" : "H"}
                </span>
                <div className="truncate">
                  <p className="font-semibold text-xs text-on-surface truncate">vs {log.opponent}</p>
                  <p className="font-mono text-[10px] text-on-surface-variant">
                    {log.matchDate} • {log.tacticalRole || "AM"} • {log.minutesPlayed}'
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0 font-mono text-xs">
                <div className="flex flex-col items-end">
                  <span className="text-on-surface font-bold">
                    {log.rawStats?.totalShots ?? log.rawStats?.shots ?? 0} shots
                  </span>
                  <span className="text-[10px] text-primary">
                    xG {log.rawStats?.xG ?? 0}
                  </span>
                </div>
                <div className="px-1.5 py-0.5 rounded bg-surface-container-highest text-primary font-bold">
                  {log.rawStats?.rating ?? 8.0}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Interactive Simulation Sliders */}
      <div className="bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60">
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-xs uppercase text-primary font-bold flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">tune</span>
            <span>Predictive Sandbox Controls</span>
          </span>
          <span className="font-mono text-[10px] text-on-surface-variant">Live Sensitivity</span>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <div className="flex items-center justify-between font-mono text-xs mb-1">
              <span className="text-on-surface-variant">Fatigue & Workload Load</span>
              <span className="text-secondary font-bold">{fatigueFactor}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={fatigueFactor}
              onChange={(e) => setFatigueFactor(Number(e.target.value))}
              className="w-full accent-secondary h-1.5 bg-surface-container-highest rounded-lg cursor-pointer"
            />
          </div>

          <div>
            <div className="flex items-center justify-between font-mono text-xs mb-1">
              <span className="text-on-surface-variant">Tactical Infiltration Depth</span>
              <span className="text-primary font-bold">{tacticalDepth}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={tacticalDepth}
              onChange={(e) => setTacticalDepth(Number(e.target.value))}
              className="w-full accent-primary h-1.5 bg-surface-container-highest rounded-lg cursor-pointer"
            />
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-surface-container-high/40 flex items-center justify-between">
          <p className="font-mono text-[11px] text-on-surface-variant">
            Ajustes guardados localmente e indexados en cola reactiva.
          </p>
          <button
            onClick={runPredictiveSimulation}
            className="px-3 py-1.5 bg-primary text-on-primary rounded-lg font-mono text-xs font-bold shadow-md hover:opacity-90 active:scale-95 transition-all"
          >
            Recalcular Forecast
          </button>
        </div>
      </div>

      {/* Modal: Registrar Siguiente Partido (Test del Loop P1 -> P2) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface-container-low border border-primary/40 rounded-2xl w-full max-w-md p-5 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-surface-container-high">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">add_circle</span>
                <h3 className="font-bold text-base text-on-surface">Registrar Siguiente Partido</h3>
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
                Ingesta de resultado para calcular error (<code className="text-primary">delta = actual - predicted</code>) y recalibrar pesos mediante descenso por gradiente.
              </p>

              <div>
                <label className="block text-[11px] font-mono text-on-surface-variant uppercase mb-1">
                  Rival del Partido
                </label>
                <input
                  type="text"
                  value={matchOpponent}
                  onChange={(e) => setMatchOpponent(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                  required
                />
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-mono cursor-pointer">
                  <input
                    type="radio"
                    checked={matchIsAway}
                    onChange={() => setMatchIsAway(true)}
                    className="accent-primary"
                  />
                  <span>Visitante (Away)</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-mono cursor-pointer">
                  <input
                    type="radio"
                    checked={!matchIsAway}
                    onChange={() => setMatchIsAway(false)}
                    className="accent-primary"
                  />
                  <span>Local (Home)</span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Disparos Totales
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={actualShots}
                    onChange={(e) => setActualShots(Number(e.target.value))}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                    required
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
                    onChange={(e) => setActualXg(Number(e.target.value))}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                    required
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
                    onChange={(e) => setActualKeyPasses(Number(e.target.value))}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                    required
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
                    onChange={(e) => setActualRating(Number(e.target.value))}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                    required
                  />
                </div>
              </div>

              {/* Quick Presets */}
              <div className="flex items-center gap-1.5 pt-1">
                <span className="text-[10px] font-mono text-on-surface-variant">Presets:</span>
                <button
                  type="button"
                  onClick={() => {
                    setActualShots(4);
                    setActualXg(0.65);
                    setActualKeyPasses(4);
                    setActualRating(8.8);
                  }}
                  className="px-2 py-0.5 rounded bg-surface-container text-[10px] font-mono text-primary hover:bg-surface-container-high"
                >
                  Masterclass (+Deltas)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActualShots(1);
                    setActualXg(0.12);
                    setActualKeyPasses(1);
                    setActualRating(7.1);
                  }}
                  className="px-2 py-0.5 rounded bg-surface-container text-[10px] font-mono text-tertiary hover:bg-surface-container-high"
                >
                  Partido Difícil (-Deltas)
                </button>
              </div>

              <div className="mt-3 pt-3 border-t border-surface-container-high flex items-center justify-end gap-2">
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
                      <span>CALIBRAR MODELO (P1 → P2)</span>
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
