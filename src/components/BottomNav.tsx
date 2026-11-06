"use client";

import React from "react";

export type TabKey = "explorer" | "radar" | "team" | "player";

interface BottomNavProps {
  activeTab: TabKey;
  onSelectTab: (tab: TabKey) => void;
  /** Nombres del último equipo/jugador abiertos (para que la pestaña diga a dónde va) */
  teamLabel?: string | null;
  playerLabel?: string | null;
}

export function BottomNav({ activeTab, onSelectTab, teamLabel, playerLabel }: BottomNavProps) {
  const short = (s?: string | null) => (s ? (s.length > 12 ? s.slice(0, 11) + "…" : s) : null);
  const tabs: Array<{ id: TabKey; label: string; icon: string }> = [
    { id: "explorer", label: "Ligas", icon: "sports_soccer" },
    { id: "radar", label: "Radar", icon: "radar" },
    { id: "team", label: short(teamLabel) ?? "Equipo", icon: "shield" },
    { id: "player", label: short(playerLabel) ?? "Jugador", icon: "psychology" },
  ];

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 bg-surface/95 backdrop-blur-xl border-t border-surface-container-high pb-safe">
      <div className="flex items-center justify-around px-margin py-2 max-w-lg mx-auto">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all relative ${
                isActive
                  ? "text-primary scale-105"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {isActive && (
                <span className="absolute -top-2 w-8 h-1 bg-primary rounded-full shadow-[0_0_8px_#4edea3]" />
              )}
              <span
                className="material-symbols-outlined text-[22px]"
                style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
              >
                {tab.icon}
              </span>
              <span
                className={`font-mono text-[10px] tracking-tight uppercase ${
                  isActive ? "font-bold text-primary" : "text-on-surface-variant"
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
