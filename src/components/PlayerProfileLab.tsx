"use client";

import React, { useState } from "react";
import { INITIAL_PLAYER, PlayerData } from "@/data/mock-data";
import { syncEngine } from "@/lib/offline-sync";

interface PlayerProfileLabProps {
  onBackToExplorer: () => void;
  onOpenTactics: () => void;
}

export function PlayerProfileLab({ onBackToExplorer, onOpenTactics }: PlayerProfileLabProps) {
  const [player, setPlayer] = useState<PlayerData>(INITIAL_PLAYER);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulatedScore, setSimulatedScore] = useState<number>(player.predictiveForm);
  const [fatigueFactor, setFatigueFactor] = useState<number>(15);
  const [tacticalDepth, setTacticalDepth] = useState<number>(75);

  const runPredictiveSimulation = async () => {
    setIsSimulating(true);
    // Simulate algorithmic calculation
    await new Promise((r) => setTimeout(r, 450));
    const newRating = +(
      9.0 +
      Math.random() * 0.85 -
      (fatigueFactor / 100) * 0.4 +
      (tacticalDepth / 100) * 0.3
    ).toFixed(2);

    setSimulatedScore(newRating);
    setIsSimulating(false);

    // Enqueue mutation with offline support
    await syncEngine.enqueue("SIMULATE_MATCH", `player_${player.id}`, {
      simulatedRating: newRating,
      fatigueFactor,
      tacticalDepth,
      timestamp: Date.now(),
    });
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
            <span className="text-primary font-semibold">{player.name} #{player.number}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-surface-container-high px-2 py-0.5 rounded shadow-sm shrink-0 border border-primary/20">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
          <span className="font-mono text-[10px] text-primary font-bold">
            MODEL RUN: {player.confidence}% CONF
          </span>
        </div>
      </div>

      {/* Split Header Card: Player Identity & Predictive Rating */}
      <div className="bg-surface-container-low rounded-xl p-space-md relative overflow-hidden shadow-xl border border-surface-container-high/60">
        <div className="absolute -right-8 -top-8 w-36 h-36 bg-gradient-to-br from-primary/10 to-secondary/5 rounded-full blur-2xl pointer-events-none"></div>
        <div className="flex flex-col gap-space-md relative z-10">
          {/* Top Strip */}
          <div className="flex items-start justify-between gap-space-sm">
            <div className="flex items-center gap-space-md">
              <div className="relative shrink-0">
                <img
                  src={player.photoUrl}
                  alt={player.name}
                  className="w-14 h-14 rounded-xl object-cover bg-surface-container shadow-md border border-primary/30"
                />
                <span className="absolute -bottom-1 -right-1 bg-surface-container-lowest text-secondary font-mono text-[10px] font-bold px-1.5 py-0.2 rounded shadow-sm border border-secondary/30">
                  #{player.number}
                </span>
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h2 className="text-lg font-bold text-on-surface tracking-tight truncate">
                    {player.name}
                  </h2>
                  <span className="bg-surface-container-highest text-secondary font-mono text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold">
                    {player.nationality}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="bg-primary/10 text-primary font-mono text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wider border border-primary/20">
                    {player.position}
                  </span>
                  <span className="text-on-surface-variant text-xs font-sans">
                    Age {player.age} • {player.height} cm
                  </span>
                </div>
              </div>
            </div>

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

          {/* Telemetry Predictive Score & Variance */}
          <div className="grid grid-cols-2 gap-space-sm pt-space-xs">
            <div className="bg-surface-container rounded-lg p-space-sm flex items-center justify-between shadow-inner border border-outline-variant/20">
              <div className="flex flex-col">
                <span className="font-mono text-[9px] text-on-surface-variant uppercase tracking-wider">
                  Predictive Form
                </span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="font-mono text-2xl font-bold text-primary drop-shadow-[0_0_12px_rgba(78,222,163,0.45)]">
                    {simulatedScore}
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

      {/* 90-Minute Expected vs Observed Metric Grid */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between px-space-xs">
          <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider font-semibold">
            90-Minute Expected vs Observed
          </span>
          <span className="font-mono text-[10px] text-secondary">METRIC-SET: P90_OPT</span>
        </div>

        <div className="grid grid-cols-2 gap-space-sm">
          {/* Shots */}
          <div className="bg-surface-container-low rounded-xl p-space-sm flex flex-col justify-between shadow-md border border-surface-container-high/60">
            <div className="flex items-center justify-between">
              <span className="text-xs text-on-surface-variant font-medium">Shots / 90</span>
              <span className="bg-secondary/10 text-secondary font-mono text-[10px] px-1.5 py-0.2 rounded font-bold">
                +0.3
              </span>
            </div>
            <div className="my-2">
              <div className="flex items-baseline justify-between font-mono text-lg font-bold">
                <span className="text-on-surface">{player.metrics.shotsObserved}</span>
                <span className="text-xs text-on-surface-variant/80">pred {player.metrics.shotsPredicted}</span>
              </div>
              <div className="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden mt-1.5">
                <div className="bg-secondary h-full rounded-full" style={{ width: "87%" }}></div>
              </div>
            </div>
          </div>

          {/* Key Passes */}
          <div className="bg-surface-container-low rounded-xl p-space-sm flex flex-col justify-between shadow-md border border-surface-container-high/60">
            <div className="flex items-center justify-between">
              <span className="text-xs text-on-surface-variant font-medium">Key Passes</span>
              <span className="bg-primary/10 text-primary font-mono text-[10px] px-1.5 py-0.2 rounded font-bold">
                +0.3
              </span>
            </div>
            <div className="my-2">
              <div className="flex items-baseline justify-between font-mono text-lg font-bold">
                <span className="text-on-surface">{player.metrics.keyPassesObserved}</span>
                <span className="text-xs text-on-surface-variant/80">
                  pred {player.metrics.keyPassesPredicted}
                </span>
              </div>
              <div className="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden mt-1.5">
                <div className="bg-primary h-full rounded-full" style={{ width: "91%" }}></div>
              </div>
            </div>
          </div>

          {/* Aerial Duel % */}
          <div className="bg-surface-container-low rounded-xl p-space-sm flex flex-col justify-between shadow-md border border-surface-container-high/60">
            <div className="flex items-center justify-between">
              <span className="text-xs text-on-surface-variant font-medium">Aerial Duels</span>
              <span className="bg-primary/10 text-primary font-mono text-[10px] px-1.5 py-0.2 rounded font-bold">
                HIGH
              </span>
            </div>
            <div className="my-2">
              <div className="flex items-baseline justify-between font-mono text-lg font-bold">
                <span className="text-on-surface">{player.metrics.aerialDuelWinPct}%</span>
                <span className="text-xs text-on-surface-variant/80">Win Rate</span>
              </div>
              <div className="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden mt-1.5">
                <div className="bg-primary h-full rounded-full" style={{ width: "68%" }}></div>
              </div>
            </div>
          </div>

          {/* xT Threat */}
          <div className="bg-surface-container-low rounded-xl p-space-sm flex flex-col justify-between shadow-md border border-surface-container-high/60">
            <div className="flex items-center justify-between">
              <span className="text-xs text-on-surface-variant font-medium">xT Impact</span>
              <span className="bg-secondary/10 text-secondary font-mono text-[10px] px-1.5 py-0.2 rounded font-bold">
                TOP 2%
              </span>
            </div>
            <div className="my-2">
              <div className="flex items-baseline justify-between font-mono text-lg font-bold">
                <span className="text-secondary">{player.metrics.xtThreat}</span>
                <span className="text-xs text-on-surface-variant/80">p90 threat</span>
              </div>
              <div className="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden mt-1.5">
                <div className="bg-secondary h-full rounded-full" style={{ width: "94%" }}></div>
              </div>
            </div>
          </div>
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
            Recalcular Form
          </button>
        </div>
      </div>
    </div>
  );
}
