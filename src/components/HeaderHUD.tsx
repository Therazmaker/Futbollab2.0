"use client";

import React from "react";
import { useSyncTelemetry } from "@/lib/offline-sync";

interface HeaderHUDProps {
  currentTab: string;
  onSearchClick?: () => void;
  onFilterClick?: () => void;
}

export function HeaderHUD({ currentTab, onSearchClick, onFilterClick }: HeaderHUDProps) {
  const { isOnline, pendingCount, isSyncing, triggerManualSync } = useSyncTelemetry();

  const getTabLabel = () => {
    switch (currentTab) {
      case "explorer":
        return "Ligas";
      case "radar":
        return "Radar";
      case "team":
        return "Perfil de equipo";
      case "player":
        return "Perfil de jugador";
      default:
        return "Tactical HUD";
    }
  };

  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-surface/90 backdrop-blur-xl border-b border-surface-container-high/60 pt-safe">
      <div className="flex flex-col justify-between px-margin py-2 max-w-lg mx-auto">
        {/* Top Row: Brand & Profile */}
        <div className="flex items-center justify-between gap-space-sm pb-2">
          <div className="flex items-center gap-space-sm">
            <button
              aria-label="Toggle Module Navigation"
              className="w-10 h-10 flex items-center justify-center rounded-lg bg-surface-container-high/70 text-on-surface hover:text-primary transition-colors border border-outline-variant/30"
            >
              <span className="material-symbols-outlined text-[20px]">menu_open</span>
            </button>
            <div className="flex items-center gap-space-xs">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/30 to-secondary/20 flex items-center justify-center border border-primary/30">
                <span className="material-symbols-outlined text-primary text-[20px]">radar</span>
              </div>
              <div className="flex flex-col">
                <span className="font-sans font-semibold text-sm text-on-surface tracking-tight leading-none">
                  FutbolLab
                </span>
                <span className="font-mono text-[10px] text-secondary leading-none uppercase tracking-widest mt-0.5">
                  TACTICAL HUD
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-space-xs">
            {/* Live Status Badge */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-container/80 border border-surface-container-highest">
              <span
                className={`w-2 h-2 rounded-full ${
                  !isOnline
                    ? "bg-amber-500 animate-pulse"
                    : isSyncing
                    ? "bg-secondary animate-ping"
                    : "bg-primary animate-pulse"
                }`}
              />
              <span
                className={`font-mono text-[10px] font-semibold ${
                  !isOnline ? "text-amber-400" : isSyncing ? "text-secondary" : "text-primary"
                }`}
              >
                {!isOnline ? "OFFLINE" : isSyncing ? "SYNCING" : "ACTIVE"}
              </span>
            </div>

            <button
              onClick={onSearchClick}
              aria-label="Global Search"
              className="w-10 h-10 flex items-center justify-center rounded-lg bg-surface-container-high/70 text-on-surface-variant hover:text-primary transition-colors border border-outline-variant/30"
            >
              <span className="material-symbols-outlined text-[18px]">search</span>
            </button>
          </div>
        </div>

        {/* Bottom Row: Convex Realtime Telemetry, Offline Queue, Season */}
        <div className="flex items-center justify-between gap-space-sm pt-1 border-t border-surface-container/50">
          <div className="flex items-center gap-2">
            {/* Convex Realtime Sync Status */}
            <button
              onClick={triggerManualSync}
              title={!isOnline ? "Haz clic para reintentar sincronizar pendientes" : "Conexión reactiva en tiempo real"}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono transition-all ${
                !isOnline
                  ? "bg-amber-950/70 border border-amber-600/50 text-amber-300"
                  : pendingCount > 0
                  ? "bg-secondary/20 border border-secondary/40 text-secondary"
                  : "bg-surface-container-highest/80 text-on-surface-variant"
              }`}
            >
              <span className="text-primary font-bold">CONVEX</span>
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  !isOnline ? "bg-amber-400" : pendingCount > 0 ? "bg-secondary animate-spin" : "bg-primary animate-ping"
                }`}
              />
              <span>
                {!isOnline
                  ? `PENDIENTE (${pendingCount})`
                  : pendingCount > 0
                  ? `SINCRONIZANDO (${pendingCount})`
                  : "EN VIVO"}
              </span>
            </button>

            {/* Season Badge */}
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container-low text-secondary border border-outline-variant/20 font-mono text-[11px]">
              <span className="material-symbols-outlined text-[13px]">calendar_month</span>
              <span>24/25 SZN</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={onFilterClick}
              className="h-6 px-2 rounded bg-surface-container-high flex items-center gap-1 text-on-surface-variant hover:text-on-surface transition-colors text-[10px] font-mono uppercase"
            >
              <span className="material-symbols-outlined text-[13px]">tune</span>
              <span>Filter</span>
            </button>
            <div className="flex items-center px-2 py-0.5 rounded bg-surface-container-lowest text-primary font-mono text-[10px] tracking-wider uppercase border border-primary/20">
              {getTabLabel()}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
