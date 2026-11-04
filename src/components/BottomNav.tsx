"use client";

import React from "react";

export type TabKey = "explorer" | "tactics" | "players" | "predict";

interface BottomNavProps {
  activeTab: TabKey;
  onSelectTab: (tab: TabKey) => void;
}

export function BottomNav({ activeTab, onSelectTab }: BottomNavProps) {
  const tabs: Array<{ id: TabKey; label: string; icon: string }> = [
    { id: "explorer", label: "Explorer", icon: "sports_soccer" },
    { id: "tactics", label: "Tactics", icon: "stadium" },
    { id: "players", label: "Players", icon: "psychology" },
    { id: "predict", label: "Predict Lab", icon: "analytics" },
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
