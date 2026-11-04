"use client";

import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useSyncTelemetry } from "@/lib/offline-sync";

interface LeaguesExplorerProps {
  onSelectTeam: (teamId: Id<"teams">) => void;
}

interface TeamCard {
  id: Id<"teams">;
  name: string;
  shortName: string;
  leagueCode: string;
  leagueName: string;
  rank: number | null;
  points: number;
  played: number;
  goalDifference: number;
  goalsForPg: number | null;
  goalsAgainstPg: number | null;
  attack: number | null;
  defense: number | null;
  form: string[];
  badgeUrl?: string;
  competitions: string[];
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export function LeaguesExplorer({ onSelectTeam }: LeaguesExplorerProps) {
  const [selectedLeague, setSelectedLeague] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<"points" | "attack" | "defense" | "name">("points");
  const { isOnline } = useSyncTelemetry();

  // Convex Reactive Queries & Mutations
  const convexLeagues = useQuery(api.teams.getLeagues);
  const convexTeams = useQuery(api.teams.getTeams, { league: selectedLeague });
  const allTeams = useQuery(api.teams.getTeams, {});
  const createLeagueMutation = useMutation(api.teams.createLeague);
  const createTeamMutation = useMutation(api.teams.createTeam);
  const linkTeamMutation = useMutation(api.teams.linkTeamToCompetition);
  const legacyStatus = useQuery(api.legacy.legacyStatus);
  const importLegacy = useAction(api.legacy.importLegacyData);
  const [importState, setImportState] = useState<string | null>(null);

  const runLegacyImport = async () => {
    setImportState("Importando histórico… (1–2 min)");
    try {
      const r = await importLegacy({});
      setImportState(
        `Listo: ${r.matches} partidos, ${r.players} jugadores, ${r.teamsCreated} equipos nuevos (${r.teamsLinked} enlazados, ${r.teamsMerged} duplicados fusionados). Tablas y fuerza de equipos recalculadas.`
      );
    } catch (err: any) {
      setImportState(`Error al importar: ${err?.message ?? err}`);
    }
  };

  // Modal States
  const [isAddLeagueOpen, setIsAddLeagueOpen] = useState(false);
  const [isAddTeamOpen, setIsAddTeamOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State: Add League
  const [leagueName, setLeagueName] = useState("");
  const [leagueCode, setLeagueCode] = useState("");
  const [leagueCountry, setLeagueCountry] = useState("Europa");
  const [leagueIsTournament, setLeagueIsTournament] = useState(true);

  // Form State: Add Club
  const [teamName, setTeamName] = useState("");
  const [teamShortName, setTeamShortName] = useState("");
  const [teamDomesticLeague, setTeamDomesticLeague] = useState("seriea");
  const [teamLinkUcl, setTeamLinkUcl] = useState(true);
  const [teamFormation, setTeamFormation] = useState("3-5-2");

  // League selector list
  const leaguesList = useMemo(() => {
    interface LeagueTab {
      code: string;
      label: string;
      count: number;
      icon?: string;
      isTournament?: boolean;
    }

    const count = (code: string) =>
      (allTeams ?? []).filter((t: any) => t.league === code || t.competitions?.includes(code)).length;
    const base: LeagueTab[] = [
      { code: "all", label: "Todas las Ligas", count: allTeams?.length ?? 0, icon: "sports_soccer" },
      { code: "laliga", label: "LaLiga", count: count("laliga") },
      { code: "premier", label: "Premier League", count: count("premier") },
      { code: "seriea", label: "Serie A", count: count("seriea") },
      { code: "bundesliga", label: "Bundesliga", count: count("bundesliga") },
      { code: "ligue1", label: "Ligue 1", count: count("ligue1") },
      { code: "ucl", label: "Champions League (UCL)", count: count("ucl"), isTournament: true },
    ];

    if (!convexLeagues || convexLeagues.length === 0) return base;

    // Merge or prioritize Convex leagues
    const codes = new Set(base.map((b) => b.code));
    const extra: LeagueTab[] = convexLeagues
      .filter((lg: any) => !codes.has(lg.code.toLowerCase()))
      .map((lg: any) => ({
        code: lg.code.toLowerCase(),
        label: lg.name,
        count: count(lg.code.toLowerCase()),
        isTournament: lg.isTournament,
      }));

    return [...base, ...extra];
  }, [convexLeagues, allTeams]);

  // Equipos reales de Convex (sin datos de ejemplo)
  const displayClubs: TeamCard[] = useMemo(() => {
    const labels: Record<string, string> = {
      seriea: "Serie A",
      laliga: "LaLiga",
      premier: "Premier League",
      bundesliga: "Bundesliga",
      ligue1: "Ligue 1",
      ucl: "Champions League",
    };
    return (convexTeams ?? []).map((t: any) => {
      const played = t.played ?? 0;
      return {
        id: t._id,
        name: t.name,
        shortName: t.shortName || t.name.slice(0, 3).toUpperCase(),
        leagueCode: t.league,
        leagueName: labels[t.league?.toLowerCase()] ?? t.league,
        rank: t.rank ?? null,
        points: t.points ?? 0,
        played,
        goalDifference: t.goalDifference ?? 0,
        goalsForPg: played ? t.goalsFor / played : null,
        goalsAgainstPg: played ? t.goalsAgainst / played : null,
        attack: t.attackRating ?? null,
        defense: t.defenseRating ?? null,
        form: t.played ? t.form ?? [] : [],
        badgeUrl: t.crestUrl,
        competitions: t.competitions || [t.league],
      };
    });
  }, [convexTeams]);

  const filteredClubs = useMemo(() => {
    return displayClubs
      .filter((c) => {
        const matchesLeague =
          selectedLeague === "all" ||
          c.leagueCode.toLowerCase() === selectedLeague.toLowerCase() ||
          c.competitions?.includes(selectedLeague.toLowerCase());

        const matchesSearch =
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.shortName.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesLeague && matchesSearch;
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "attack") return (b.attack ?? 0) - (a.attack ?? 0);
        if (sortBy === "defense") return (a.defense ?? 9) - (b.defense ?? 9);
        return b.points - a.points || b.goalDifference - a.goalDifference || a.name.localeCompare(b.name);
      });
  }, [displayClubs, selectedLeague, searchQuery, sortBy]);

  const handleCreateLeagueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leagueName.trim() || !leagueCode.trim()) return;
    setIsSubmitting(true);
    try {
      await createLeagueMutation({
        name: leagueName.trim(),
        code: leagueCode.trim().toLowerCase(),
        country: leagueCountry.trim(),
        isTournament: leagueIsTournament,
      });
      setSelectedLeague(leagueCode.trim().toLowerCase());
      setIsAddLeagueOpen(false);
      setLeagueName("");
      setLeagueCode("");
    } catch (err) {
      console.error("Error creating league:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateClubSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamName.trim()) return;
    setIsSubmitting(true);
    try {
      const comps = [teamDomesticLeague.toLowerCase()];
      if (teamLinkUcl && !comps.includes("ucl")) {
        comps.push("ucl");
      }

      await createTeamMutation({
        name: teamName.trim(),
        shortName: teamShortName.trim().toUpperCase() || teamName.slice(0, 3).toUpperCase(),
        league: teamDomesticLeague.toLowerCase(),
        competitions: comps,
        formation: teamFormation,
      });

      setIsAddTeamOpen(false);
      setTeamName("");
      setTeamShortName("");
    } catch (err) {
      console.error("Error creating club:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLinkToUcl = async (teamId: any, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await linkTeamMutation({
        teamId,
        competitionCode: "ucl",
      });
    } catch (err) {
      console.error("Error linking to UCL:", err);
    }
  };

  return (
    <div className="flex flex-col w-full gap-space-md">
      {/* Histórico del FutbolLab viejo */}
      {legacyStatus && legacyStatus.needsImport && (
        <div className="p-2.5 rounded-xl border border-secondary/40 bg-secondary/10 flex items-center justify-between gap-2 font-mono text-[11px]">
          <span className="text-on-surface">
            {importState ??
              (legacyStatus.duplicateTeams > 0
                ? `Hay ${legacyStatus.duplicateTeams} equipos duplicados de la importación anterior (p. ej. dos Aston Villa). Pulsa para fusionarlos y recalcular las tablas.`
                : `Hay ${legacyStatus.availableMatches} partidos del FutbolLab anterior (Serie A, Premier, Bundesliga, Ligue 1) listos para importar.`)}
          </span>
          {!importState?.startsWith("Importando") && (
            <button
              onClick={runLegacyImport}
              className="shrink-0 px-2.5 py-1 rounded bg-secondary text-black font-bold text-[10px] hover:opacity-90 active:scale-95"
            >
              Importar histórico
            </button>
          )}
        </div>
      )}
      {importState && legacyStatus && !legacyStatus.needsImport && (
        <div className="p-2 rounded-xl border border-primary/30 bg-primary/10 font-mono text-[10px] text-primary">{importState}</div>
      )}

      {/* Breadcrumb & Actions Bar */}
      <div className="flex items-center justify-between gap-space-xs pt-space-xs">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="material-symbols-outlined text-secondary text-[16px] shrink-0">public</span>
          <span className="font-mono text-[10px] text-on-surface-variant truncate uppercase tracking-wider">
            Global Intelligence
          </span>
          <span className="text-outline-variant font-mono text-[10px]">/</span>
          <span className="font-mono text-[10px] text-primary font-semibold truncate uppercase">
            Clubs & Competitions Hub
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setIsAddLeagueOpen(true)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-secondary text-[11px] font-mono border border-secondary/30 transition-all active:scale-95 shadow-sm"
          >
            <span className="material-symbols-outlined text-[13px]">add_circle</span>
            <span>+ Liga / Torneo</span>
          </button>
          <button
            onClick={() => setIsAddTeamOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-on-primary text-[11px] font-mono font-bold transition-all active:scale-95 shadow-md shadow-primary/20"
          >
            <span className="material-symbols-outlined text-[13px]">shield</span>
            <span>+ Agregar Club</span>
          </button>
        </div>
      </div>

      {/* Non-Duplication Architecture Info Banner */}
      <div className="w-full rounded-xl bg-surface-container-low px-space-sm py-2 shadow-sm flex items-center justify-between gap-space-xs border border-surface-container-high/40">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full bg-cyan-400 shrink-0 animate-pulse"></div>
          <p className="font-mono text-[11px] text-on-surface-variant truncate">
            Arquitectura Multi-Competición: Los clubes pertenecen a su liga local y se vinculan a torneos (Champions League) sin duplicar datos.
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded bg-surface-container-lowest text-cyan-400 border border-cyan-400/20">
          <span className="material-symbols-outlined text-[12px]">link</span>
          <span className="font-mono text-[11px] font-semibold">Zero-Duplicate</span>
        </div>
      </div>

      {/* League Selector Horizontal Rail */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] text-on-surface-variant uppercase tracking-wider">
            Competiciones Monitoreadas
          </span>
          <span className="font-mono text-[10px] text-secondary">
            {leaguesList.length} Registradas
          </span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 w-full no-scrollbar">
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
                {lg.code === "ucl" ? (
                  <span className="text-[14px]">🏆</span>
                ) : lg.icon ? (
                  <span className="material-symbols-outlined text-[16px]">{lg.icon}</span>
                ) : null}
                <span>{lg.label}</span>
                {lg.isTournament && (
                  <span className="px-1 py-0.2 rounded text-[9px] bg-cyan-400/20 text-cyan-300 font-bold">
                    TORNEO
                  </span>
                )}
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
            placeholder="Buscar club..."
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-surface-container-low text-on-surface placeholder:text-outline text-sm focus:bg-surface-container-high focus:outline-none focus:ring-1 focus:ring-primary transition-all border border-surface-container-high"
          />
        </div>

        {/* Quick Sorting Chips */}
        <div className="flex items-center justify-between gap-1 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1 shrink-0">
            <span className="font-mono text-[10px] text-on-surface-variant uppercase mr-1">Ordenar:</span>
            {(["points", "attack", "defense", "name"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`px-2.5 py-1 rounded-lg font-mono text-[11px] flex items-center gap-1 active:scale-95 transition-colors ${
                  sortBy === s
                    ? "bg-surface-container-high text-primary font-bold border border-primary/30"
                    : "bg-surface-container text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <span>{{ points: "Puntos", attack: "Ataque", defense: "Defensa", name: "A-Z" }[s]}</span>
                {sortBy === s && (
                  <span className="material-symbols-outlined text-[13px]">arrow_downward</span>
                )}
              </button>
            ))}
          </div>


        </div>
      </div>

      {/* Club Cards Catalog List */}
      <div className="flex flex-col gap-3">
        {convexTeams === undefined ? (
          <div className="p-6 text-center bg-surface-container-low rounded-xl border border-surface-container-high/60 font-mono text-xs text-on-surface-variant">
            Cargando equipos…
          </div>
        ) : filteredClubs.length === 0 ? (
          <div className="p-8 text-center bg-surface-container-low rounded-xl border border-surface-container-high/60 flex flex-col items-center justify-center gap-2">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant">search_off</span>
            <p className="text-sm font-mono text-on-surface-variant">
              No hay clubes vinculados a esta competición o filtro.
            </p>
            <button
              onClick={() => setIsAddTeamOpen(true)}
              className="mt-2 px-3 py-1.5 rounded-lg bg-primary text-on-primary font-mono text-xs font-bold"
            >
              + Agregar Club y Vincular
            </button>
          </div>
        ) : (
          filteredClubs.map((club) => {
            const playsUcl = club.competitions?.includes("ucl");
            return (
              <div
                key={club.id}
                onClick={() => onSelectTeam(club.id)}
                className="bg-surface-container-low hover:bg-surface-container rounded-xl p-space-md border border-surface-container-high/60 transition-all cursor-pointer relative overflow-hidden group shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative w-12 h-12 rounded-xl bg-surface-container-highest flex items-center justify-center p-2 shrink-0 border border-outline-variant/30">
                      {club.badgeUrl ? (
                        <img src={club.badgeUrl} alt={club.name} className="w-full h-full object-contain" />
                      ) : (
                        <span className="font-mono text-[11px] font-bold text-secondary">{club.shortName}</span>
                      )}
                      {club.rank !== null && (
                        <span className="absolute -bottom-1 -right-1 min-w-4 h-4 px-0.5 bg-primary text-on-primary rounded-full flex items-center justify-center font-mono text-[10px] font-bold">
                          {club.rank}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="font-semibold text-base text-on-surface truncate group-hover:text-primary transition-colors">
                          {club.name}
                        </h3>
                        {/* Domestic League Badge */}
                        <span className="font-mono text-[10px] text-secondary font-bold px-1.5 py-0.2 rounded bg-secondary/10">
                          {club.leagueName}
                        </span>
                        {/* Champions League Linked Badge */}
                        {playsUcl && (
                          <span className="font-mono text-[10px] text-cyan-300 font-bold px-1.5 py-0.2 rounded bg-cyan-950/70 border border-cyan-800/60 flex items-center gap-0.5">
                            <span>🏆 UCL</span>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-on-surface-variant mt-0.5 font-mono">
                        <span className="text-primary font-semibold">{club.points} Pts</span>
                        <span>•</span>
                        <span>{club.played} PJ</span>
                        <span>•</span>
                        <span>DG {signed(club.goalDifference)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <span className="font-mono text-[10px] text-on-surface-variant uppercase">Forma</span>
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

                {/* Métricas reales */}
                <div className="grid grid-cols-3 gap-2 mt-3 pt-2 border-t border-surface-container-high/40">
                  <div className="bg-surface-container/60 rounded-lg p-1.5 flex flex-col">
                    <span className="font-mono text-[9px] text-on-surface-variant uppercase">Goles / PJ</span>
                    <span className="font-mono text-xs font-bold text-primary mt-0.5">
                      {club.goalsForPg !== null ? `${club.goalsForPg.toFixed(2)} : ${club.goalsAgainstPg!.toFixed(2)}` : "—"}
                    </span>
                  </div>
                  <div className="bg-surface-container/60 rounded-lg p-1.5 flex flex-col">
                    <span className="font-mono text-[9px] text-on-surface-variant uppercase">Ataque</span>
                    <span className="font-mono text-xs font-bold text-secondary mt-0.5">{club.attack?.toFixed(2) ?? "—"}</span>
                  </div>
                  <div className="bg-surface-container/60 rounded-lg p-1.5 flex flex-col">
                    <span className="font-mono text-[9px] text-on-surface-variant uppercase">Defensa</span>
                    <span className="font-mono text-xs font-bold text-on-surface mt-0.5">{club.defense?.toFixed(2) ?? "—"}</span>
                  </div>
                </div>

                <div className="mt-2.5 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-on-surface-variant flex items-center gap-1">
                    Ver perfil y plantilla
                    <span className="material-symbols-outlined text-[13px]">chevron_right</span>
                  </span>

                <div className="flex items-center gap-1.5">
                    {!playsUcl && (
                      <button
                        onClick={(e) => handleLinkToUcl(club.id, e)}
                        title="Vincular a Champions League (sin duplicar)"
                        className="px-2 py-0.5 rounded bg-cyan-950/60 hover:bg-cyan-900 text-cyan-300 text-[10px] font-mono transition-colors border border-cyan-800/40 flex items-center gap-1"
                      >
                        <span>+ Vincular UCL</span>
                      </button>
                    )}

                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal: Crear Liga o Torneo */}
      {isAddLeagueOpen && (
        <div className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain flex justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface-container-low border border-secondary/40 rounded-2xl w-full max-w-md p-5 shadow-2xl my-auto relative">
            <div className="flex items-center justify-between pb-3 border-b border-surface-container-high">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-[22px]">public</span>
                <h3 className="font-bold text-base text-on-surface">Crear Liga o Torneo</h3>
              </div>
              <button
                onClick={() => setIsAddLeagueOpen(false)}
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateLeagueSubmit} className="flex flex-col gap-3 mt-3">
              <p className="text-xs text-on-surface-variant">
                Define ligas domésticas (ej. Serie A, LaLiga) o torneos continentales (ej. Champions League) que vinculan clubes existentes.
              </p>

              <div>
                <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                  Nombre de la Competición
                </label>
                <input
                  type="text"
                  placeholder="ej. UEFA Champions League, Serie A"
                  value={leagueName}
                  onChange={(e) => setLeagueName(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-secondary"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Código Único
                  </label>
                  <input
                    type="text"
                    placeholder="ej. ucl, seriea"
                    value={leagueCode}
                    onChange={(e) => setLeagueCode(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-secondary"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    País / Región
                  </label>
                  <input
                    type="text"
                    placeholder="ej. Europa, Italia"
                    value={leagueCountry}
                    onChange={(e) => setLeagueCountry(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-secondary"
                    required
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-surface-container/70 border border-surface-container-high/60 mt-1">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-mono">
                  <input
                    type="checkbox"
                    checked={leagueIsTournament}
                    onChange={(e) => setLeagueIsTournament(e.target.checked)}
                    className="accent-secondary w-4 h-4"
                  />
                  <div>
                    <span className="font-bold text-on-surface">Torneo Continental / Copa</span>
                    <p className="text-[10px] text-on-surface-variant">
                      Permite vincular equipos de ligas domésticas sin duplicar sus registros.
                    </p>
                  </div>
                </label>
              </div>

              <div className="mt-3 pt-3 pb-1 border-t border-surface-container-high flex items-center justify-end gap-2 sticky bottom-0 bg-surface-container-low z-10">
                <button
                  type="button"
                  onClick={() => setIsAddLeagueOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface-variant font-mono text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 rounded-lg bg-secondary text-black font-mono text-xs font-bold shadow-lg"
                >
                  {isSubmitting ? "Creando..." : "Crear Competición"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Agregar Club y Vincular Competiciones */}
      {isAddTeamOpen && (
        <div className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain flex justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface-container-low border border-primary/40 rounded-2xl w-full max-w-md p-5 shadow-2xl my-auto relative">
            <div className="flex items-center justify-between pb-3 border-b border-surface-container-high">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[22px]">shield</span>
                <h3 className="font-bold text-base text-on-surface">Agregar Club (Sin Duplicados)</h3>
              </div>
              <button
                onClick={() => setIsAddTeamOpen(false)}
                className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateClubSubmit} className="flex flex-col gap-3 mt-3">
              <p className="text-xs text-on-surface-variant">
                El club pertenecerá a su liga doméstica y estará vinculado a torneos como la Champions League con un único registro.
              </p>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Nombre del Club
                  </label>
                  <input
                    type="text"
                    placeholder="ej. Inter de Milán"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Sigla (3)
                  </label>
                  <input
                    type="text"
                    maxLength={4}
                    placeholder="INT"
                    value={teamShortName}
                    onChange={(e) => setTeamShortName(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high uppercase"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Liga Doméstica Principal
                  </label>
                  <select
                    value={teamDomesticLeague}
                    onChange={(e) => setTeamDomesticLeague(e.target.value)}
                    className="w-full h-9 px-2 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary"
                  >
                    <option value="seriea">🇮🇹 Serie A</option>
                    <option value="laliga">🇪🇸 LaLiga</option>
                    <option value="premier">🇬🇧 Premier League</option>
                    <option value="bundesliga">🇩🇪 Bundesliga</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-on-surface-variant uppercase mb-1">
                    Formación
                  </label>
                  <input
                    type="text"
                    value={teamFormation}
                    onChange={(e) => setTeamFormation(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
                  />
                </div>
              </div>

              {/* Champions League Linking Checkbox */}
              <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-800/50 mt-1">
                <label className="flex items-center gap-2.5 cursor-pointer text-xs font-mono">
                  <input
                    type="checkbox"
                    checked={teamLinkUcl}
                    onChange={(e) => setTeamLinkUcl(e.target.checked)}
                    className="accent-cyan-400 w-4 h-4 rounded"
                  />
                  <div>
                    <span className="font-bold text-cyan-300 flex items-center gap-1">
                      <span>🏆 Participa en Champions League (UCL)</span>
                    </span>
                    <p className="text-[10px] text-cyan-200/70 mt-0.5">
                      Se vinculará a la Champions League sin duplicar el club en la base de datos.
                    </p>
                  </div>
                </label>
              </div>

              <p className="font-mono text-[10px] text-on-surface-variant">
                Puntos, forma y fuerza se calculan solos con los resultados que registres en su perfil.
              </p>

              <div className="mt-3 pt-3 pb-1 border-t border-surface-container-high flex items-center justify-end gap-2 sticky bottom-0 bg-surface-container-low z-10">
                <button
                  type="button"
                  onClick={() => setIsAddTeamOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface-variant font-mono text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 rounded-lg bg-primary text-on-primary font-mono text-xs font-bold shadow-lg"
                >
                  {isSubmitting ? "Guardando..." : "Guardar y Vincular"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
