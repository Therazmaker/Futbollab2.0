"use client";

import React, { useState } from "react";
import { HeaderHUD } from "@/components/HeaderHUD";
import { BottomNav, TabKey } from "@/components/BottomNav";
import { LeaguesExplorer } from "@/components/LeaguesExplorer";
import { PlayerProfileLab } from "@/components/PlayerProfileLab";
import { TeamTacticsHub } from "@/components/TeamTacticsHub";
import { useSyncTelemetry } from "@/lib/offline-sync";
import { ClubData } from "@/data/mock-data";

export default function FutbolLabApp() {
  const [activeTab, setActiveTab] = useState<TabKey>("explorer");
  const [selectedClub, setSelectedClub] = useState<ClubData | null>(null);
  const { isOnline, pendingCount, isSyncing, triggerManualSync } = useSyncTelemetry();

  const handleSelectClub = (club: ClubData) => {
    setSelectedClub(club);
    setActiveTab("tactics");
  };

  return (
    <div className="flex flex-col min-h-screen w-full bg-background text-on-surface overflow-x-hidden">
      {/* Top HUD Header */}
      <HeaderHUD currentTab={activeTab} />

      {/* Main Responsive Content Shell */}
      <main className="flex-1 max-w-lg w-full mx-auto px-4 pt-32 pb-36 flex flex-col">
        {/* Offline & Pending Banner Alert */}
        {(!isOnline || pendingCount > 0) && (
          <div
            className={`mb-3 p-2.5 rounded-xl border flex items-center justify-between text-xs font-mono transition-all shadow-lg ${
              !isOnline
                ? "bg-amber-950/60 border-amber-600/60 text-amber-200"
                : "bg-secondary/15 border-secondary/40 text-secondary"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  !isOnline ? "bg-amber-400 animate-pulse" : "bg-secondary animate-ping"
                }`}
              />
              <div>
                <p className="font-bold">
                  {!isOnline ? "Modo Offline Activo" : "Sincronizando con Convex"}
                </p>
                <p className="text-[10px] opacity-80">
                  {pendingCount === 0
                    ? "Tus cambios se guardan localmente en IndexedDB."
                    : `${pendingCount} acción(es) pendiente(s) por subir a la nube.`}
                </p>
              </div>
            </div>

            {isOnline && pendingCount > 0 && (
              <button
                onClick={triggerManualSync}
                disabled={isSyncing}
                className="px-2.5 py-1 rounded bg-secondary text-black font-bold text-[10px] hover:opacity-90 active:scale-95 transition-transform"
              >
                {isSyncing ? "Subiendo..." : "Sincronizar Ya"}
              </button>
            )}
          </div>
        )}

        {/* Tab 1: Leagues & Teams Explorer */}
        {activeTab === "explorer" && (
          <LeaguesExplorer
            onSelectClub={handleSelectClub}
            onNavigateToPlayer={() => setActiveTab("players")}
          />
        )}

        {/* Tab 2: Tactics & Squad Hub */}
        {activeTab === "tactics" && (
          <TeamTacticsHub
            onBackToExplorer={() => setActiveTab("explorer")}
            onOpenPlayerRadar={() => setActiveTab("players")}
          />
        )}

        {/* Tab 3: Player Profile & Predictive Lab */}
        {activeTab === "players" && (
          <PlayerProfileLab
            onBackToExplorer={() => setActiveTab("explorer")}
            onOpenTactics={() => setActiveTab("tactics")}
          />
        )}

        {/* Tab 4: Direct Predictive Monte Carlo */}
        {activeTab === "predict" && (
          <PlayerProfileLab
            onBackToExplorer={() => setActiveTab("explorer")}
            onOpenTactics={() => setActiveTab("tactics")}
          />
        )}
      </main>

      {/* Persistent Bottom Tab Navigation */}
      <BottomNav activeTab={activeTab} onSelectTab={(tab) => setActiveTab(tab)} />
    </div>
  );
}
