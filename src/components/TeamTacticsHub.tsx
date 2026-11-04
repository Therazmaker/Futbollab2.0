"use client";

import React, { useState } from "react";
import { ClubData, INITIAL_CLUBS } from "@/data/mock-data";
import { TacticalPitch } from "./TacticalPitch";
import { syncEngine } from "@/lib/offline-sync";

interface TeamTacticsHubProps {
  onBackToExplorer: () => void;
  onOpenPlayerRadar: () => void;
}

export function TeamTacticsHub({ onBackToExplorer, onOpenPlayerRadar }: TeamTacticsHubProps) {
  const [club, setClub] = useState<ClubData>(INITIAL_CLUBS[0]); // Real Madrid
  const [formation, setFormation] = useState<string>("4-3-1-2");
  const [winProb, setWinProb] = useState<number>(64.8);
  const [isSimulatingMatch, setIsSimulatingMatch] = useState<boolean>(false);

  const squadList = [
    { name: "Vinicius Jr", num: 7, pos: "LW/ST", fitness: 93, status: "STARTER" },
    { name: "Jude Bellingham", num: 5, pos: "CAM", fitness: 94, status: "STARTER" },
    { name: "Federico Valverde", num: 8, pos: "CM/RW", fitness: 99, status: "STARTER" },
    { name: "Antonio Rüdiger", num: 22, pos: "CB", fitness: 95, status: "STARTER" },
    { name: "Luka Modrić", num: 10, pos: "CM", fitness: 76, status: "SUB_IMPACT" },
    { name: "Brahim Díaz", num: 21, pos: "RW/CAM", fitness: 91, status: "SUB_IMPACT" },
  ];

  const handleFormationChange = async (newForm: string) => {
    setFormation(newForm);
    // Optimistic update
    setClub((prev) => ({ ...prev, formation: newForm }));

    // Queue mutation with offline engine
    await syncEngine.enqueue("UPDATE_TACTICS", `club_${club.id}`, {
      formation: newForm,
      updatedAt: Date.now(),
    });
  };

  const handleSimulateFixture = async () => {
    setIsSimulatingMatch(true);
    await new Promise((r) => setTimeout(r, 400));
    const newProb = +(60 + Math.random() * 12).toFixed(1);
    setWinProb(newProb);
    setIsSimulatingMatch(false);

    await syncEngine.enqueue("SIMULATE_MATCH", "fixture_athletic_rmd", {
      winProb: newProb,
      formation,
      timestamp: Date.now(),
    });
  };

  return (
    <div className="flex flex-col w-full gap-space-md">
      {/* Tactical Breadcrumbs & Engine Status */}
      <div className="flex items-center justify-between px-space-xs text-on-surface-variant font-mono text-[11px]">
        <div className="flex items-center gap-1.5 truncate">
          <button
            onClick={onBackToExplorer}
            className="text-on-surface-variant hover:text-primary transition-colors flex items-center"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          </button>
          <span className="text-on-surface-variant/70">LaLiga</span>
          <span className="material-symbols-outlined text-[12px] text-outline">chevron_right</span>
          <span className="text-on-surface font-semibold">{club.name}</span>
          <span className="material-symbols-outlined text-[12px] text-outline">chevron_right</span>
          <span className="text-secondary font-semibold">Tactical Hub</span>
        </div>
        <div className="flex items-center gap-1 bg-surface-container-high px-space-xs py-0.5 rounded text-primary border border-primary/20 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
          <span className="font-mono text-[10px] font-semibold">{club.predAccuracy}% CERTAINTY</span>
        </div>
      </div>

      {/* Club Header Bento Card */}
      <div className="relative overflow-hidden rounded-xl bg-surface-container-low p-space-md shadow-md border border-surface-container-high/60">
        <div className="absolute -right-8 -top-8 w-44 h-44 rounded-full bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent blur-2xl pointer-events-none"></div>
        <div className="flex items-start justify-between relative z-10 gap-space-sm">
          <div className="flex items-center gap-space-sm">
            <div className="relative w-14 h-14 rounded-xl bg-surface-container-highest flex items-center justify-center p-2 shadow-inner border border-primary/30">
              <img
                src={club.badgeUrl}
                alt={club.name}
                className="w-full h-full object-contain"
              />
              <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-primary text-on-primary rounded-full flex items-center justify-center font-mono text-[10px] font-bold">
                {club.rank}
              </span>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <h1 className="text-lg font-bold text-on-surface leading-tight tracking-tight">
                  {club.name}
                </h1>
                <span className="material-symbols-outlined text-[16px] text-primary">verified</span>
              </div>
              <p className="text-xs text-on-surface-variant flex items-center gap-1.5 mt-0.5 font-mono">
                <span className="text-primary font-semibold">1st in {club.leagueName}</span>
                <span className="text-outline-variant">•</span>
                <span>{club.points} Pts</span>
                <span className="text-outline-variant">•</span>
                <span className="text-secondary">GD +{club.goalDifference}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-wider">
              Form Rating
            </span>
            <div className="flex items-center gap-1 bg-surface-container px-2 py-0.5 rounded border border-surface-container-highest">
              <span className="w-2 h-2 rounded-full bg-primary"></span>
              <span className="font-mono text-xs text-primary font-bold">
                {club.form.join("-")}
              </span>
            </div>
          </div>
        </div>

        {/* Micro Stats Horizon Bar */}
        <div className="grid grid-cols-3 gap-2 mt-space-md pt-space-xs border-t border-surface-container-high/40">
          <div className="bg-surface-container/70 rounded-lg p-space-xs flex flex-col border border-outline-variant/20">
            <span className="font-mono text-[9px] text-on-surface-variant uppercase">Mean xG/90</span>
            <span className="font-mono text-sm font-bold text-primary mt-0.5">{club.meanXg}</span>
            <span className="font-mono text-[9px] text-primary mt-0.5 flex items-center gap-0.5">
              <span className="material-symbols-outlined text-[10px]">arrow_upward</span>+0.32 vs avg
            </span>
          </div>

          <div className="bg-surface-container/70 rounded-lg p-space-xs flex flex-col border border-outline-variant/20">
            <span className="font-mono text-[9px] text-on-surface-variant uppercase">PPDA Metric</span>
            <span className="font-mono text-sm font-bold text-secondary mt-0.5">{club.ppda}</span>
            <span className="font-mono text-[9px] text-secondary mt-0.5">High Pressing</span>
          </div>

          <div className="bg-surface-container/70 rounded-lg p-space-xs flex flex-col border border-outline-variant/20">
            <span className="font-mono text-[9px] text-on-surface-variant uppercase">Build-up Tempo</span>
            <span className="font-mono text-sm font-bold text-on-surface mt-0.5">{club.tempo}</span>
            <span className="font-mono text-[9px] text-on-surface-variant mt-0.5">Direct Vertical</span>
          </div>
        </div>
      </div>

      {/* Upcoming Fixture Tactical Simulation Card */}
      <div className="rounded-xl bg-surface-container-low p-space-md shadow-sm border border-surface-container-high/60">
        <div className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-secondary">sports_soccer</span>
            <span className="font-mono text-xs text-secondary uppercase font-semibold">
              Next Tactical Matchup
            </span>
          </div>
          <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-tertiary-container/20 text-tertiary font-medium">
            AWAY (-12% Impact factor)
          </span>
        </div>

        {/* Match Header Preview */}
        <div className="flex items-center justify-between py-1 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-surface-container-highest flex items-center justify-center p-1 shrink-0 border border-outline-variant/30">
              <span className="material-symbols-outlined text-secondary text-[20px]">shield</span>
            </div>
            <div className="truncate">
              <div className="text-sm font-bold text-on-surface truncate">vs Athletic Club</div>
              <div className="text-xs text-on-surface-variant flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">stadium</span>
                <span>San Mamés • Sun 21:00</span>
              </div>
            </div>
          </div>

          <button
            onClick={handleSimulateFixture}
            disabled={isSimulatingMatch}
            className="px-2.5 py-1.5 rounded-lg bg-primary text-on-primary font-mono text-xs font-bold hover:opacity-90 active:scale-95 transition-all shadow-md flex items-center gap-1"
          >
            <span
              className={`material-symbols-outlined text-[14px] ${
                isSimulatingMatch ? "animate-spin" : ""
              }`}
            >
              {isSimulatingMatch ? "refresh" : "play_arrow"}
            </span>
            <span>{isSimulatingMatch ? "SIMULANDO" : "SIMULAR"}</span>
          </button>
        </div>

        {/* Win Probability Bar */}
        <div className="mt-3 pt-2 border-t border-surface-container-high/40">
          <div className="flex items-center justify-between font-mono text-xs mb-1">
            <span className="text-on-surface-variant">Expected Win Probability</span>
            <span className="text-primary font-bold">{winProb}%</span>
          </div>
          <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden flex">
            <div className="bg-primary h-full" style={{ width: `${winProb}%` }}></div>
            <div className="bg-secondary h-full" style={{ width: "22%" }}></div>
            <div className="bg-error h-full" style={{ width: `${100 - winProb - 22}%` }}></div>
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono mt-1 text-on-surface-variant">
            <span className="text-primary">Win {winProb}%</span>
            <span className="text-secondary">Draw 22%</span>
            <span className="text-error">Loss {(100 - winProb - 22).toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* Tactical Lineup & Formation Switcher */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs uppercase text-primary font-bold flex items-center gap-1">
            <span className="material-symbols-outlined text-[16px]">grid_4x4</span>
            <span>Pitch Tactical Board</span>
          </span>

          {/* Formation Toggle */}
          <div className="flex items-center gap-1 bg-surface-container rounded-lg p-0.5 border border-surface-container-highest">
            {["4-3-1-2", "4-3-3"].map((fmt) => (
              <button
                key={fmt}
                onClick={() => handleFormationChange(fmt)}
                className={`px-2 py-0.5 rounded text-xs font-mono font-bold transition-all ${
                  formation === fmt
                    ? "bg-primary text-on-primary shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>
        </div>

        {/* 2D Interactive Pitch */}
        <TacticalPitch currentFormation={formation} />
      </div>

      {/* Squad Depth & Live Fitness Roster */}
      <div className="rounded-xl bg-surface-container-low p-space-md border border-surface-container-high/60">
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-xs uppercase text-on-surface font-bold flex items-center gap-1">
            <span className="material-symbols-outlined text-[16px] text-secondary">groups</span>
            <span>Squad Depth & Fitness Index</span>
          </span>
          <button
            onClick={onOpenPlayerRadar}
            className="font-mono text-[11px] text-secondary hover:text-primary transition-colors flex items-center gap-0.5"
          >
            <span>Ver Ficha Bellingham</span>
            <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
          </button>
        </div>

        <div className="flex flex-col divide-y divide-surface-container-high/40">
          {squadList.map((sq, i) => (
            <div key={i} className="py-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded bg-surface-container-highest text-secondary font-mono text-[10px] font-bold flex items-center justify-center">
                  #{sq.num}
                </span>
                <span className="text-xs font-semibold text-on-surface">{sq.name}</span>
                <span className="font-mono text-[10px] text-on-surface-variant">({sq.pos})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-primary">{sq.fitness}%</span>
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.2 rounded ${
                    sq.status === "STARTER"
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "bg-secondary/10 text-secondary border border-secondary/20"
                  }`}
                >
                  {sq.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
