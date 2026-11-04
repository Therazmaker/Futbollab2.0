"use client";

import React, { useState, useMemo } from "react";
import { ClubData, INITIAL_CLUBS } from "@/data/mock-data";
import { syncEngine, useSyncTelemetry } from "@/lib/offline-sync";

interface LeaguesExplorerProps {
  onSelectClub: (club: ClubData) => void;
  onNavigateToPlayer: () => void;
}

export function LeaguesExplorer({ onSelectClub, onNavigateToPlayer }: LeaguesExplorerProps) {
  const [selectedLeague, setSelectedLeague] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<"density" | "points" | "accuracy">("density");
  const [clubs, setClubs] = useState<ClubData[]>(INITIAL_CLUBS);
  const { isOnline } = useSyncTelemetry();

  const leaguesList = [
    { code: "all", label: "All Leagues", count: 110, icon: "sports_soccer" },
    { code: "laliga", label: "LaLiga", count: 20 },
    { code: "premier", label: "Premier League", count: 20 },
    { code: "seriea", label: "Serie A", count: 20 },
    { code: "ucl", label: "Champions League", count: 32 },
    { code: "bundesliga", label: "Bundesliga", count: 18 },
  ];

  const filteredClubs = useMemo(() => {
    return clubs
      .filter((c) => {
        const matchesLeague = selectedLeague === "all" || c.leagueCode === selectedLeague;
        const matchesSearch =
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.formation.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.shortName.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesLeague && matchesSearch;
      })
      .sort((a, b) => {
        if (sortBy === "points") return b.points - a.points;
        if (sortBy === "accuracy") return b.predAccuracy - a.predAccuracy;
        return b.density - a.density;
      });
  }, [clubs, selectedLeague, searchQuery, sortBy]);

  const handleQuickTacticalBoost = async (clubId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = clubs.map((c) => {
      if (c.id === clubId) {
        return {
          ...c,
          density: Math.min(99.9, +(c.density + 0.5).toFixed(1)),
          meanXg: +(c.meanXg + 0.05).toFixed(2),
        };
      }
      return c;
    });
    setClubs(updated);

    // Save action into offline sync queue / Convex
    await syncEngine.enqueue("UPDATE_TACTICS", `club_${clubId}`, {
      boostedAt: Date.now(),
      clubId,
    });
  };

  return (
    <div className="flex flex-col w-full gap-space-md">
      {/* Breadcrumb & Telemetry Status */}
      <div className="flex items-center justify-between gap-space-xs pt-space-xs">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="material-symbols-outlined text-secondary text-[16px] shrink-0">public</span>
          <span className="font-mono text-[10px] text-on-surface-variant truncate uppercase tracking-wider">
            Global Intelligence
          </span>
          <span className="text-outline-variant font-mono text-[10px]">/</span>
          <span className="font-mono text-[10px] text-primary font-semibold truncate uppercase">
            Clubs Explorer
          </span>
        </div>
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-container-high shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-ping"></span>
          <span className="font-mono text-[10px] text-secondary">24/25 SZN</span>
        </div>
      </div>

      {/* Real-time Hydration Banner */}
      <div className="w-full rounded-xl bg-surface-container-low px-space-sm py-2 shadow-sm flex items-center justify-between gap-space-xs border border-surface-container-high/40">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full bg-primary shrink-0 animate-pulse"></div>
          <p className="font-mono text-[11px] text-on-surface-variant truncate">
            Hydrating Real-time Opta / StatsBomb telemetry
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded bg-surface-container-lowest text-primary border border-primary/20">
          <span className="material-symbols-outlined text-[12px]">bolt</span>
          <span className="font-mono text-[12px] font-semibold text-primary">142ms</span>
        </div>
      </div>

      {/* League Selector Horizontal Rail */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] text-on-surface-variant uppercase tracking-wider">
            Monitored Leagues
          </span>
          <span className="font-mono text-[10px] text-secondary">5 Active</span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-margin px-margin no-scrollbar">
          {leaguesList.map((lg) => {
            const isSelected = selectedLeague === lg.code;
            return (
              <button
                key={lg.code}
                onClick={() => setSelectedLeague(lg.code)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl shrink-0 transition-transform active:scale-95 text-xs font-mono ${
                  isSelected
                    ? "bg-primary text-on-primary font-bold shadow-md shadow-primary/20"
                    : "bg-surface-container-high text-on-surface hover:text-primary"
                }`}
              >
                {lg.icon && (
                  <span className="material-symbols-outlined text-[16px]">{lg.icon}</span>
                )}
                <span>{lg.label}</span>
                <span
                  className={`px-1 rounded text-[10px] ${
                    isSelected ? "bg-on-primary/20 text-on-primary" : "bg-surface-container text-on-surface-variant"
                  }`}
                >
                  {lg.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search & Sorting Filters Toolbar */}
      <div className="grid grid-cols-1 gap-2">
        <div className="relative w-full">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-on-surface-variant">
            <span className="material-symbols-outlined text-[18px]">search</span>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by club, tactic, manager or xT..."
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-surface-container-low text-on-surface placeholder:text-outline text-sm focus:bg-surface-container-high focus:outline-none focus:ring-1 focus:ring-primary transition-all border border-surface-container-high"
          />
        </div>

        {/* Quick Sorting Chips */}
        <div className="flex items-center justify-between gap-1 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1 shrink-0">
            <span className="font-mono text-[10px] text-on-surface-variant uppercase mr-1">Sort:</span>
            {(["density", "points", "accuracy"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`px-2.5 py-1 rounded-lg font-mono text-[11px] flex items-center gap-1 active:scale-95 transition-colors ${
                  sortBy === s
                    ? "bg-surface-container-high text-primary font-bold border border-primary/30"
                    : "bg-surface-container text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <span className="capitalize">{s === "accuracy" ? "Pred. Acc" : s}</span>
                {sortBy === s && (
                  <span className="material-symbols-outlined text-[13px]">arrow_downward</span>
                )}
              </button>
            ))}
          </div>

          <button
            onClick={onNavigateToPlayer}
            className="px-2 py-1 rounded-lg bg-surface-container-high text-secondary hover:text-primary shrink-0 flex items-center gap-1 text-[11px] font-mono border border-secondary/20"
          >
            <span>Top Scout</span>
            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
          </button>
        </div>
      </div>

      {/* Club Cards Catalog List */}
      <div className="flex flex-col gap-3">
        {filteredClubs.map((club) => (
          <div
            key={club.id}
            onClick={() => onSelectClub(club)}
            className="bg-surface-container-low hover:bg-surface-container rounded-xl p-space-md border border-surface-container-high/60 transition-all cursor-pointer relative overflow-hidden group shadow-md"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative w-12 h-12 rounded-xl bg-surface-container-highest flex items-center justify-center p-2 shrink-0 border border-outline-variant/30">
                  <img
                    src={club.badgeUrl}
                    alt={club.name}
                    className="w-full h-full object-contain"
                  />
                  <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-primary text-on-primary rounded-full flex items-center justify-center font-mono text-[10px] font-bold">
                    {club.rank}
                  </span>
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-semibold text-base text-on-surface truncate group-hover:text-primary transition-colors">
                      {club.name}
                    </h3>
                    <span className="font-mono text-[10px] text-secondary font-bold px-1 rounded bg-secondary/10">
                      {club.leagueName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-on-surface-variant mt-0.5 font-mono">
                    <span className="text-primary font-semibold">{club.points} Pts</span>
                    <span>•</span>
                    <span>GD +{club.goalDifference}</span>
                    <span>•</span>
                    <span className="text-secondary font-semibold">{club.formation}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-1">
                <span className="font-mono text-[10px] text-on-surface-variant uppercase">Tactical Form</span>
                <div className="flex items-center gap-0.5">
                  {club.form.map((res, i) => (
                    <span
                      key={i}
                      className={`w-3.5 h-3.5 rounded-sm flex items-center justify-center font-mono text-[9px] font-bold ${
                        res === "W"
                          ? "bg-primary/20 text-primary border border-primary/30"
                          : res === "D"
                          ? "bg-secondary/20 text-secondary border border-secondary/30"
                          : "bg-error/20 text-error border border-error/30"
                      }`}
                    >
                      {res}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Metrics Rail */}
            <div className="grid grid-cols-3 gap-2 mt-3 pt-2 border-t border-surface-container-high/40">
              <div className="bg-surface-container/60 rounded-lg p-1.5 flex flex-col">
                <span className="font-mono text-[9px] text-on-surface-variant uppercase">xG / 90</span>
                <span className="font-mono text-xs font-bold text-primary mt-0.5">{club.meanXg}</span>
              </div>
              <div className="bg-surface-container/60 rounded-lg p-1.5 flex flex-col">
                <span className="font-mono text-[9px] text-on-surface-variant uppercase">PPDA Metric</span>
                <span className="font-mono text-xs font-bold text-secondary mt-0.5">{club.ppda}</span>
              </div>
              <div className="bg-surface-container/60 rounded-lg p-1.5 flex flex-col">
                <span className="font-mono text-[9px] text-on-surface-variant uppercase">Pred. Acc</span>
                <span className="font-mono text-xs font-bold text-on-surface mt-0.5">
                  {club.predAccuracy}%
                </span>
              </div>
            </div>

            {/* Quick Action Button for Instant/Offline Simulation */}
            <div className="mt-2.5 flex items-center justify-between">
              <span className="font-mono text-[10px] text-on-surface-variant flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                <span>Tempo: {club.tempo}</span>
              </span>

              <button
                onClick={(e) => handleQuickTacticalBoost(club.id, e)}
                title="Aplica ajuste táctico (optimistic update con sync offline)"
                className="px-2 py-0.5 rounded bg-surface-container-highest hover:bg-primary hover:text-on-primary text-secondary text-[10px] font-mono transition-colors flex items-center gap-1 border border-outline-variant/30"
              >
                <span className="material-symbols-outlined text-[12px]">tune</span>
                <span>Optimizar Táctica</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
