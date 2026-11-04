"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { HeaderHUD } from "@/components/HeaderHUD";
import { BottomNav, TabKey } from "@/components/BottomNav";
import { LeaguesExplorer } from "@/components/LeaguesExplorer";
import { PlayerProfileLab } from "@/components/PlayerProfileLab";
import { TeamProfile } from "@/components/TeamProfile";

/**
 * Navegación: Ligas → Equipo → Jugador.
 * El estado vive en la URL (?view=team&team=… / ?view=player&player=…), así que
 * el botón "atrás" del navegador funciona y un enlace abre la misma pantalla.
 */
interface NavState {
  view: TabKey;
  teamId?: Id<"teams">;
  playerId?: Id<"players">;
}

function readUrl(): NavState {
  if (typeof window === "undefined") return { view: "explorer" };
  const q = new URLSearchParams(window.location.search);
  const view = (q.get("view") as TabKey) || "explorer";
  return {
    view: ["explorer", "team", "player"].includes(view) ? view : "explorer",
    teamId: (q.get("team") as Id<"teams">) || undefined,
    playerId: (q.get("player") as Id<"players">) || undefined,
  };
}

function writeUrl(s: NavState, replace = false) {
  const q = new URLSearchParams();
  if (s.view !== "explorer") q.set("view", s.view);
  if (s.teamId) q.set("team", s.teamId);
  if (s.playerId) q.set("player", s.playerId);
  const url = `${window.location.pathname}${q.toString() ? `?${q}` : ""}`;
  if (replace) window.history.replaceState(s, "", url);
  else window.history.pushState(s, "", url);
}

export default function FutbolLabApp() {
  const [nav, setNav] = useState<NavState>({ view: "explorer" });

  useEffect(() => {
    setNav(readUrl());
    const onPop = () => setNav(readUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((next: NavState) => {
    setNav(next);
    writeUrl(next);
    window.scrollTo({ top: 0 });
  }, []);

  const team = useQuery(api.teams.getTeamProfile, nav.teamId ? { teamId: nav.teamId } : "skip");
  const player = useQuery(api.players.getPlayerProfile, nav.playerId ? { playerId: nav.playerId } : "skip");

  const openTeam = (teamId: Id<"teams">) => go({ ...nav, view: "team", teamId });
  const openPlayer = (playerId: Id<"players">, teamId?: Id<"teams">) =>
    go({ view: "player", playerId, teamId: teamId ?? nav.teamId });

  const selectTab = (tab: TabKey) => go({ ...nav, view: tab });

  return (
    <div className="flex flex-col min-h-screen w-full bg-background text-on-surface overflow-x-hidden">
      <HeaderHUD currentTab={nav.view} />

      <main className="flex-1 max-w-lg w-full mx-auto px-4 pt-32 pb-36 flex flex-col">
        {nav.view === "explorer" && <LeaguesExplorer onSelectTeam={openTeam} />}

        {nav.view === "team" &&
          (nav.teamId ? (
            <TeamProfile
              teamId={nav.teamId}
              onBack={() => go({ ...nav, view: "explorer" })}
              onOpenTeam={openTeam}
              onOpenPlayer={(id) => openPlayer(id, nav.teamId)}
            />
          ) : (
            <EmptyState
              icon="shield"
              text="Elige un equipo en Ligas para ver su perfil y su plantilla."
              action="Ir a Ligas"
              onAction={() => go({ view: "explorer" })}
            />
          ))}

        {nav.view === "player" && (
          <PlayerProfileLab
            playerId={nav.playerId}
            onSelectPlayer={(id, teamId) => go({ view: "player", playerId: id, teamId })}
            onOpenTeam={openTeam}
            onBack={() => (nav.teamId ? go({ ...nav, view: "team" }) : go({ view: "explorer" }))}
          />
        )}
      </main>

      <BottomNav
        activeTab={nav.view}
        onSelectTab={selectTab}
        teamLabel={team?.team.name}
        playerLabel={player?.player?.name}
      />
    </div>
  );
}

function EmptyState({ icon, text, action, onAction }: { icon: string; text: string; action: string; onAction: () => void }) {
  return (
    <div className="p-8 text-center bg-surface-container-low rounded-xl border border-surface-container-high/60 flex flex-col items-center gap-3">
      <span className="material-symbols-outlined text-4xl text-on-surface-variant">{icon}</span>
      <p className="text-sm font-mono text-on-surface-variant">{text}</p>
      <button onClick={onAction} className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-mono text-xs font-bold">
        {action}
      </button>
    </div>
  );
}
