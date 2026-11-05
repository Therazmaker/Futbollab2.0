"use client";

import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useSyncTelemetry } from "@/lib/offline-sync";
import { currentSeason } from "../../convex/lib/season";

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
    // UCL specifics
    uclRank?: number;
    uclPoints?: number;
    uclPlayed?: number;
    uclWins?: number;
    uclDraws?: number;
    uclLosses?: number;
    uclGoalsFor?: number;
    uclGoalsAgainst?: number;
    uclGoalDifference?: number;
    uclForm?: string[];
    uclPhase?: "direct_round_16" | "qualification_playoff" | "eliminated";
    season?: string;
    noLeague?: boolean;
    competitionSeason?: string;
    lastSeason?: { season: string; rank: number; points: number; played: number } | null;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export function LeaguesExplorer({ onSelectTeam }: LeaguesExplorerProps) {
  const [selectedLeague, setSelectedLeague] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<"points" | "attack" | "defense" | "name">("points");
  const { isOnline } = useSyncTelemetry();

  // UCL View Filter
  const [uclFilter, setUclFilter] = useState<"all" | "top8" | "playoffs" | "eliminated" | "bracket">("all");
  const [isSyncingUcl, setIsSyncingUcl] = useState(false);
  const [uclSyncMessage, setUclSyncMessage] = useState<string | null>(null);

  // Convex Reactive Queries & Mutations
  const convexLeagues = useQuery(api.teams.getLeagues);
  const convexTeams = useQuery(api.teams.getTeams, { league: selectedLeague });
  const allTeams = useQuery(api.teams.getTeams, {});
  const createLeagueMutation = useMutation(api.teams.createLeague);
  const createTeamMutation = useMutation(api.teams.createTeam);
  const linkTeamMutation = useMutation(api.teams.linkTeamToCompetition);
  const seedUclMutation = useMutation(api.teams.seedChampionsLeagueRound4);
  const uclStandings = useQuery(api.teams.getChampionsLeagueStandings);

  const legacyStatus = useQuery(api.legacy.legacyStatus);
  const importLegacy = useAction(api.legacy.importLegacyData);
  const [importState, setImportState] = useState<string | null>(null);
  const seasonStatus = useQuery(api.legacy.seasonStatus);
  const recomputeSeason = useMutation(api.legacy.recomputeSeason);
  const [seasonState, setSeasonState] = useState<string | null>(null);
  const unlinkedLogs = useQuery(api.players.unlinkedLogsCount);
  const linkLogs = useMutation(api.players.linkUnlinkedLogs);
  const [linkState, setLinkState] = useState<string | null>(null);
  const runLinkLogs = async () => {
    setLinkState("Vinculando…");
    try {
      const r = await linkLogs({});
      setLinkState(
        `${r.linked} partidos vinculados a su partido de equipo.` +
          (r.pending ? ` ${r.pending} sin rival reconocible: edítalos y elige el rival de la lista.` : "")
      );
    } catch (err: any) {
      setLinkState(`Error: ${err?.message ?? err}`);
    }
  };

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

  const handleSyncUclRound4 = async () => {
    setIsSyncingUcl(true);
    setUclSyncMessage("Inscribiendo los 36 clubes de la fase liga…");
    try {
      const res = await seedUclMutation();
      setUclSyncMessage(
        `Listo: ${res.total} clubes inscritos en la UCL (${res.updatedCount} ya existían, ${res.createdCount} nuevos). La clasificación sale de los partidos que registres.`
      );
    } catch (err: any) {
      setUclSyncMessage(`Error: ${err?.message ?? err}`);
    } finally {
      setIsSyncingUcl(false);
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
  const [teamIntlComp, setTeamIntlComp] = useState("ucl");
  const [createError, setCreateError] = useState<string | null>(null);
  const noLeague = teamDomesticLeague === "intl";
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
      (allTeams ?? []).filter((t: any) => t.league === code || t.competitions?.includes(code) || (code === "ucl" && t.uclRank !== undefined)).length;

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

  // Equipos reales de Convex (adaptando métricas si estamos en UCL)
  const displayClubs: TeamCard[] = useMemo(() => {
    const labels: Record<string, string> = {
      seriea: "Serie A",
      laliga: "LaLiga",
      premier: "Premier League",
      bundesliga: "Bundesliga",
      ligue1: "Ligue 1",
      primeira_liga: "Primeira Liga",
      eredivisie: "Eredivisie",
      ucl: "Champions League",
      intl: "Sin liga",
    };
    const isUcl = selectedLeague === "ucl";
    const compLabel: Record<string, string> = { ucl: "UCL", uel: "UEL", uecl: "UECL" };
    return (convexTeams ?? []).map((t: any) => {
      const played = isUcl && t.uclPlayed !== undefined ? t.uclPlayed : t.played ?? 0;
      const rank = isUcl && t.uclRank !== undefined ? t.uclRank : t.rank ?? null;
      const points = isUcl && t.uclPoints !== undefined ? t.uclPoints : t.points ?? 0;
      const goalDiff = isUcl && t.uclGoalDifference !== undefined ? t.uclGoalDifference : t.goalDifference ?? 0;
      const form = isUcl && t.uclForm ? t.uclForm : t.played ? t.form ?? [] : [];

      return {
        id: t._id,
        name: t.name,
        shortName: t.shortName || t.name.slice(0, 3).toUpperCase(),
        leagueCode: t.league,
        leagueName:
          t.league === "intl"
            ? `Solo ${(t.competitions ?? []).map((c: string) => compLabel[c] ?? c.toUpperCase()).join("/")} ${t.competitionSeason ?? ""}`.trim()
            : labels[t.league?.toLowerCase()] ?? t.league,
        rank,
        points,
        played,
        goalDifference: goalDiff,
        goalsForPg: played ? (isUcl && t.uclGoalsFor !== undefined ? t.uclGoalsFor / played : t.goalsFor / played) : null,
        goalsAgainstPg: played ? (isUcl && t.uclGoalsAgainst !== undefined ? t.uclGoalsAgainst / played : t.goalsAgainst / played) : null,
        attack: t.attackRating ?? null,
        defense: t.defenseRating ?? null,
        form,
        badgeUrl: t.crestUrl,
        competitions: t.competitions || [t.league],
        uclRank: t.uclRank,
        uclPoints: t.uclPoints,
        uclPlayed: t.uclPlayed,
        uclWins: t.uclWins,
        uclDraws: t.uclDraws,
        uclLosses: t.uclLosses,
        uclGoalsFor: t.uclGoalsFor,
        uclGoalsAgainst: t.uclGoalsAgainst,
        uclGoalDifference: t.uclGoalDifference,
        uclForm: t.uclForm,
        uclPhase: t.uclPhase ?? (t.uclRank ? (t.uclRank <= 8 ? "direct_round_16" : t.uclRank <= 24 ? "qualification_playoff" : "eliminated") : undefined),
        season: t.season,
        noLeague: t.noLeague,
        competitionSeason: t.competitionSeason,
        lastSeason: t.lastSeason,
      };
    });
  }, [convexTeams, selectedLeague]);

  const filteredClubs = useMemo(() => {
    return displayClubs
      .filter((c) => {
        const matchesLeague =
          selectedLeague === "all" ||
          c.leagueCode.toLowerCase() === selectedLeague.toLowerCase() ||
          c.competitions?.includes(selectedLeague.toLowerCase()) ||
          (selectedLeague === "ucl" && c.uclRank !== undefined);

        const matchesSearch =
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.shortName.toLowerCase().includes(searchQuery.toLowerCase());

        // UCL specific phase filtering
        if (selectedLeague === "ucl" && uclFilter !== "all" && uclFilter !== "bracket") {
          if (uclFilter === "top8") return matchesLeague && matchesSearch && (c.rank !== null && c.rank <= 8);
          if (uclFilter === "playoffs") return matchesLeague && matchesSearch && (c.rank !== null && c.rank >= 9 && c.rank <= 24);
          if (uclFilter === "eliminated") return matchesLeague && matchesSearch && (c.rank !== null && c.rank >= 25);
        }

        return matchesLeague && matchesSearch;
      })
      .sort((a, b) => {
        if (selectedLeague === "ucl") {
          return (a.rank ?? 999) - (b.rank ?? 999);
        }
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "attack") return (b.attack ?? 0) - (a.attack ?? 0);
        if (sortBy === "defense") return (a.defense ?? 9) - (b.defense ?? 9);
        return (
          b.points - a.points ||
          b.goalDifference - a.goalDifference ||
          (a.lastSeason?.rank ?? 99) - (b.lastSeason?.rank ?? 99) ||
          a.name.localeCompare(b.name)
        );
      });
  }, [displayClubs, selectedLeague, searchQuery, sortBy, uclFilter]);

  // Playoff Bracket matches (Rank 9-16 vs Rank 17-24)
  const playoffBracket = useMemo(() => {
    if (selectedLeague !== "ucl") return [];
    const playoffsTeams = displayClubs
      .filter((c) => c.rank !== null && c.rank >= 9 && c.rank <= 24)
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

    // Seeds: 9-16 vs Non-seeds: 24 down to 17
    const seeds = playoffsTeams.filter((c) => c.rank! >= 9 && c.rank! <= 16);
    const nonSeeds = playoffsTeams.filter((c) => c.rank! >= 17 && c.rank! <= 24);

    const ties = [];
    for (let i = 0; i < seeds.length; i++) {
      const homeSeed = seeds[i];
      // Match inverse pairing: 9th vs 24th, 10th vs 23rd, 11th vs 22nd, etc.
      const awayOpponent = nonSeeds[nonSeeds.length - 1 - i] || nonSeeds[i];
      if (homeSeed && awayOpponent) {
        ties.push({
          index: i + 1,
          seeded: homeSeed,
          unseeded: awayOpponent,
        });
      }
    }
    return ties;
  }, [displayClubs, selectedLeague]);

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
    setCreateError(null);
    try {
      // Sin liga: solo la competición internacional elegida (esta temporada)
      const comps = noLeague ? [teamIntlComp] : [teamDomesticLeague.toLowerCase()];
      if (!noLeague && teamLinkUcl && !comps.includes("ucl")) {
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
    } catch (err: any) {
      console.error("Error creating club:", err);
      setCreateError(err?.message ?? String(err));
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

  const renderClubCard = (club: TeamCard) => {
    const isUclView = selectedLeague === "ucl";
    const playsUcl = club.competitions?.includes("ucl") || club.uclRank !== undefined;

    // UCL Phase Styling
    let phaseBadge = null;
    let borderAccent = "border-surface-container-high/60";
    let rankBadgeColor = "bg-primary text-on-primary";

    if (isUclView && club.rank !== null) {
      if (club.rank <= 8) {
        borderAccent = "border-emerald-500/40 shadow-emerald-950/20";
        rankBadgeColor = "bg-emerald-500 text-black font-extrabold shadow-sm shadow-emerald-400/30";
        phaseBadge = (
          <span className="font-mono text-[9px] text-emerald-400 font-bold px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>OCTAVOS DIRECTO</span>
          </span>
        );
      } else if (club.rank <= 24) {
        borderAccent = "border-cyan-500/40 shadow-cyan-950/20";
        rankBadgeColor = "bg-cyan-400 text-black font-extrabold shadow-sm shadow-cyan-400/30";
        const isSeeded = club.rank <= 16;
        phaseBadge = (
          <span className="font-mono text-[9px] text-cyan-300 font-bold px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/40 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
            <span>PLAYOFFS {isSeeded ? "(SIEMBRA)" : "(NO SIEMBRA)"}</span>
          </span>
        );
      } else {
        borderAccent = "border-rose-950/40 bg-surface-container-low/80";
        rankBadgeColor = "bg-surface-container-highest text-on-surface-variant";
        phaseBadge = (
          <span className="font-mono text-[9px] text-rose-400 font-bold px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-900/40">
            ELIMINADO
          </span>
        );
      }
    }

    return (
      <div
        key={club.id}
        onClick={() => onSelectTeam(club.id)}
        className={`bg-surface-container-low hover:bg-surface-container rounded-xl p-space-md border ${borderAccent} transition-all cursor-pointer relative overflow-hidden group shadow-md`}
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
                <span
                  className={`absolute -bottom-1 -right-1 min-w-5 h-5 px-1 rounded-full flex items-center justify-center font-mono text-[10px] font-bold ${rankBadgeColor}`}
                >
                  {club.rank}º
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
                {/* Champions League Phase or Linked Badge */}
                {isUclView ? phaseBadge : playsUcl && (
                  <span className="font-mono text-[10px] text-cyan-300 font-bold px-1.5 py-0.2 rounded bg-cyan-950/70 border border-cyan-800/60 flex items-center gap-0.5">
                    <span>🏆 UCL</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-on-surface-variant mt-0.5 font-mono">
                <span className="text-primary font-semibold text-sm">{club.points} Pts</span>
                <span>•</span>
                <span>{club.played} PJ</span>
                <span>•</span>
                <span className={club.goalDifference > 0 ? "text-emerald-400 font-semibold" : club.goalDifference < 0 ? "text-rose-400 font-semibold" : ""}>
                  DG {signed(club.goalDifference)}
                </span>
                {isUclView && club.uclWins !== undefined && (
                  <>
                    <span>•</span>
                    <span className="text-on-surface-variant">
                      {club.uclWins}V-{club.uclDraws}E-{club.uclLosses}D
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            <span className="font-mono text-[10px] text-on-surface-variant uppercase">
              {isUclView ? "Forma UCL" : "Forma"}
            </span>
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
            <span className="font-mono text-[9px] text-on-surface-variant uppercase">Goles Favor / Contra</span>
            <span className="font-mono text-xs font-bold text-primary mt-0.5">
              {isUclView && club.uclGoalsFor !== undefined
                ? `${club.uclGoalsFor} : ${club.uclGoalsAgainst}`
                : club.goalsForPg !== null
                ? `${club.goalsForPg.toFixed(2)} : ${club.goalsAgainstPg!.toFixed(2)}`
                : "—"}
            </span>
          </div>
          <div className="bg-surface-container/60 rounded-lg p-1.5 flex flex-col">
            <span className="font-mono text-[9px] text-on-surface-variant uppercase">
              {isUclView ? "Estatus de Fase" : "Ataque"}
            </span>
            <span className="font-mono text-xs font-bold text-secondary mt-0.5 truncate">
              {isUclView
                ? club.rank !== null && club.rank <= 8
                  ? "Top 8 Directo"
                  : club.rank !== null && club.rank <= 24
                  ? "Playoff Access"
                  : "Eliminado"
                : club.attack?.toFixed(2) ?? "—"}
            </span>
          </div>
          <div className="bg-surface-container/60 rounded-lg p-1.5 flex flex-col">
            <span className="font-mono text-[9px] text-on-surface-variant uppercase">
              {isUclView ? "Liga Local" : "Defensa"}
            </span>
            <span className="font-mono text-xs font-bold text-on-surface mt-0.5 truncate">
              {isUclView ? club.leagueName : club.defense?.toFixed(2) ?? "—"}
            </span>
          </div>
        </div>

        <div className="mt-2.5 flex items-center justify-between">
          <span className="font-mono text-[10px] text-on-surface-variant flex items-center gap-1 group-hover:text-primary transition-colors">
            Ver plantilla y simular partido
            <span className="material-symbols-outlined text-[13px]">chevron_right</span>
          </span>

          <div className="flex items-center gap-1.5">
            {!playsUcl && !isUclView && (
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
  };

  return (
    <div className="flex flex-col w-full gap-space-md">
      {/* Cambio de temporada: la tabla solo cuenta la temporada actual */}
      {((seasonStatus?.staleLeagues.length ?? 0) > 0 || seasonState) && (
        <div className="p-2.5 rounded-xl border border-secondary/40 bg-secondary/10 flex items-center justify-between gap-2 font-mono text-[11px]">
          <span className="text-on-surface">
            {seasonState ??
              `Las tablas aún mezclan temporadas. Actualízalas a la ${seasonStatus?.season}: el histórico queda solo para entrenar los modelos.`}
          </span>
          {(seasonStatus?.staleLeagues.length ?? 0) > 0 && seasonState !== "Actualizando…" && (
            <button
              onClick={async () => {
                setSeasonState("Actualizando…");
                try {
                  const r = await recomputeSeason({});
                  setSeasonState(`Tablas de la temporada ${r.season} listas (${r.leagues} ligas). Fuerza de equipos y modelo de nota re-entrenados con ${r.matches} partidos.`);
                } catch (err: any) {
                  setSeasonState(`Error: ${err?.message ?? err}`);
                }
              }}
              className="shrink-0 px-2.5 py-1 rounded bg-secondary text-black font-bold text-[10px] hover:opacity-90"
            >
              Actualizar
            </button>
          )}
        </div>
      )}

      {/* Partidos de jugadores anteriores a los partidos de equipo */}
      {((unlinkedLogs ?? 0) > 0 || linkState) && (
        <div className="p-2.5 rounded-xl border border-primary/40 bg-primary/10 flex items-center justify-between gap-2 font-mono text-[11px]">
          <span className="text-on-surface">
            {linkState ??
              `${unlinkedLogs} partidos de jugadores no están en el perfil de su equipo. Vincúlalos por rival y fecha.`}
          </span>
          {(unlinkedLogs ?? 0) > 0 && linkState !== "Vinculando…" && (
            <button
              onClick={runLinkLogs}
              className="shrink-0 px-2.5 py-1 rounded bg-primary text-on-primary font-bold text-[10px] hover:opacity-90"
            >
              Vincular
            </button>
          )}
        </div>
      )}

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
              Fusionar y Recalcular
            </button>
          )}
        </div>
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
        <div className="flex flex-wrap items-center gap-2 pb-1 w-full">
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
                    FASE 36
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* SPECIAL UCL ROUND 4 DASHBOARD & PHASE SELECTOR */}
      {selectedLeague === "ucl" && (
        <div className="flex flex-col gap-3 p-4 rounded-2xl bg-gradient-to-br from-cyan-950/40 via-surface-container-low to-surface-container-lowest border border-cyan-800/40 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-3 border-b border-cyan-800/30">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">🏆</span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-base text-on-surface tracking-wide">
                    UEFA Champions League 2024/25
                  </h2>
                  <span className="px-2 py-0.5 rounded-full font-mono text-[10px] font-bold bg-cyan-400 text-black shadow-sm">
                    RONDA 4 / 8
                  </span>
                </div>
                <p className="font-mono text-xs text-on-surface-variant mt-0.5">
                  Tabla única de 36 clubes · Formato Suizo con clasificación por fases hacia Octavos
                </p>
              </div>
            </div>

            <button
              onClick={handleSyncUclRound4}
              disabled={isSyncingUcl}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-black font-mono text-xs font-bold transition-all active:scale-95 shadow-md shadow-cyan-400/20 shrink-0"
            >
              <span className={`material-symbols-outlined text-[15px] ${isSyncingUcl ? "animate-spin" : ""}`}>
                sync
              </span>
              <span>{isSyncingUcl ? "Inscribiendo…" : "Inscribir los 36 clubes"}</span>
            </button>
          </div>

          {uclSyncMessage && (
            <div className="p-2.5 rounded-lg bg-cyan-950/80 border border-cyan-500/30 font-mono text-xs text-cyan-200">
              {uclSyncMessage}
            </div>
          )}

          {/* Phase Summary Metric Indicators */}
          <div className="grid grid-cols-3 gap-2">
            <div
              onClick={() => setUclFilter("top8")}
              className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                uclFilter === "top8"
                  ? "bg-emerald-950/80 border-emerald-500 text-emerald-300 shadow-lg shadow-emerald-950/50"
                  : "bg-surface-container/70 border-emerald-800/30 hover:border-emerald-500/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-emerald-400 font-bold uppercase">1º - 8º Directo</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              </div>
              <div className="font-mono text-lg font-extrabold text-on-surface mt-1">
                8 <span className="text-xs font-normal text-on-surface-variant">Clubes</span>
              </div>
              <p className="font-mono text-[10px] text-emerald-400/80 mt-0.5">Octavos de Final</p>
            </div>

            <div
              onClick={() => setUclFilter("playoffs")}
              className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                uclFilter === "playoffs"
                  ? "bg-cyan-950/80 border-cyan-500 text-cyan-300 shadow-lg shadow-cyan-950/50"
                  : "bg-surface-container/70 border-cyan-800/30 hover:border-cyan-500/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-cyan-400 font-bold uppercase">9º - 24º Playoffs</span>
                <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
              </div>
              <div className="font-mono text-lg font-extrabold text-on-surface mt-1">
                16 <span className="text-xs font-normal text-on-surface-variant">Clubes</span>
              </div>
              <p className="font-mono text-[10px] text-cyan-300/80 mt-0.5">Qualification Play-offs</p>
            </div>

            <div
              onClick={() => setUclFilter("eliminated")}
              className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                uclFilter === "eliminated"
                  ? "bg-rose-950/80 border-rose-500 text-rose-300 shadow-lg shadow-rose-950/50"
                  : "bg-surface-container/70 border-rose-900/30 hover:border-rose-500/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-rose-400 font-bold uppercase">25º - 36º Eliminados</span>
                <span className="w-2 h-2 rounded-full bg-rose-400"></span>
              </div>
              <div className="font-mono text-lg font-extrabold text-on-surface mt-1">
                12 <span className="text-xs font-normal text-on-surface-variant">Clubes</span>
              </div>
              <p className="font-mono text-[10px] text-rose-400/80 mt-0.5">Zona de Eliminación</p>
            </div>
          </div>

          {/* Sub-tabs inside UCL */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
            <button
              onClick={() => setUclFilter("all")}
              className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold transition-all ${
                uclFilter === "all"
                  ? "bg-cyan-400 text-black shadow-md shadow-cyan-400/20"
                  : "bg-surface-container text-on-surface-variant hover:text-on-surface"
              }`}
            >
              ⭐ Tabla Completa (1-36)
            </button>
            <button
              onClick={() => setUclFilter("top8")}
              className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold transition-all flex items-center gap-1 ${
                uclFilter === "top8"
                  ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
                  : "bg-surface-container text-emerald-400/80 hover:text-emerald-300"
              }`}
            >
              <span>🟢 Octavos Directo (1-8)</span>
            </button>
            <button
              onClick={() => setUclFilter("playoffs")}
              className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold transition-all flex items-center gap-1 ${
                uclFilter === "playoffs"
                  ? "bg-cyan-400 text-black shadow-md shadow-cyan-400/20"
                  : "bg-surface-container text-cyan-300/80 hover:text-cyan-200"
              }`}
            >
              <span>🔵 Qualification Playoffs (9-24)</span>
            </button>
            <button
              onClick={() => setUclFilter("eliminated")}
              className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold transition-all flex items-center gap-1 ${
                uclFilter === "eliminated"
                  ? "bg-rose-500 text-black shadow-md shadow-rose-500/20"
                  : "bg-surface-container text-rose-400/80 hover:text-rose-300"
              }`}
            >
              <span>🔴 Eliminados (25-36)</span>
            </button>
            <button
              onClick={() => setUclFilter("bracket")}
              className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold transition-all flex items-center gap-1 ${
                uclFilter === "bracket"
                  ? "bg-secondary text-black shadow-md shadow-secondary/20"
                  : "bg-surface-container text-secondary hover:text-on-surface border border-secondary/30"
              }`}
            >
              <span>⚔️ Cruces Play-offs (Dieciseisavos)</span>
            </button>
          </div>
        </div>
      )}

      {/* Search & Sorting Filters Toolbar (cuando no estamos en bracket) */}
      {!(selectedLeague === "ucl" && uclFilter === "bracket") && (
        <div className="grid grid-cols-1 gap-2">
          <div className="relative w-full">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-on-surface-variant">
              <span className="material-symbols-outlined text-[18px]">search</span>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={selectedLeague === "ucl" ? "Buscar club en Champions (ej. Liverpool, Real Madrid, Inter...)..." : "Buscar club..."}
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-surface-container-low text-on-surface placeholder:text-outline text-sm focus:bg-surface-container-high focus:outline-none focus:ring-1 focus:ring-primary transition-all border border-surface-container-high"
            />
          </div>

          {selectedLeague !== "ucl" && (
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
          )}
        </div>
      )}

      {/* VIEW: PLAY-OFF BRACKET SIMULATION (CRUCES DE DIECISEISAVOS) */}
      {selectedLeague === "ucl" && uclFilter === "bracket" ? (
        <div className="flex flex-col gap-3">
          <div className="p-4 rounded-xl bg-surface-container-low border border-cyan-800/40">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-cyan-400 text-[20px]">account_tree</span>
              <h3 className="font-bold text-sm text-on-surface">
                Simulador de Cruces: Qualification Playoffs (Dieciseisavos)
              </h3>
            </div>
            <p className="font-mono text-xs text-on-surface-variant mt-1">
              Emparejamientos provisionales según la clasificación actual (con los partidos registrados): Los equipos del 9º al 16º son <strong>cabezas de serie</strong> y jugarán el partido de vuelta en su estadio frente a los del 17º al 24º. Los 8 ganadores avanzan a Octavos de Final.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {playoffBracket.map((tie) => (
              <div
                key={tie.index}
                className="bg-surface-container-low border border-surface-container-high/70 hover:border-cyan-500/50 rounded-xl p-3 shadow-md flex flex-col gap-2 transition-all"
              >
                <div className="flex items-center justify-between border-b border-surface-container-high/50 pb-1.5">
                  <span className="font-mono text-[10px] text-cyan-400 font-bold uppercase">
                    Cruce #{tie.index} de Play-off
                  </span>
                  <span className="font-mono text-[10px] text-on-surface-variant">Ida y Vuelta</span>
                </div>

                {/* Team 1: Seeded (9-16) */}
                <div
                  onClick={() => onSelectTeam(tie.seeded.id)}
                  className="flex items-center justify-between p-2 rounded-lg bg-surface-container/60 hover:bg-surface-container cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-cyan-400 text-black font-mono text-[10px] font-extrabold flex items-center justify-center shrink-0">
                      {tie.seeded.rank}º
                    </span>
                    <span className="font-semibold text-xs text-on-surface truncate">
                      {tie.seeded.name}
                    </span>
                    <span className="font-mono text-[9px] text-cyan-300 font-bold px-1 rounded bg-cyan-950">
                      SIEMBRA
                    </span>
                  </div>
                  <div className="font-mono text-xs font-bold text-primary shrink-0">
                    {tie.seeded.points} pts
                  </div>
                </div>

                <div className="flex items-center justify-center -my-1 text-on-surface-variant text-[10px] font-mono">
                  <span>vs</span>
                </div>

                {/* Team 2: Unseeded (17-24) */}
                <div
                  onClick={() => onSelectTeam(tie.unseeded.id)}
                  className="flex items-center justify-between p-2 rounded-lg bg-surface-container/60 hover:bg-surface-container cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-surface-container-highest text-on-surface font-mono text-[10px] font-bold flex items-center justify-center shrink-0">
                      {tie.unseeded.rank}º
                    </span>
                    <span className="font-semibold text-xs text-on-surface truncate">
                      {tie.unseeded.name}
                    </span>
                    <span className="font-mono text-[9px] text-on-surface-variant px-1 rounded bg-surface-container-highest">
                      NO SIEMBRA
                    </span>
                  </div>
                  <div className="font-mono text-xs font-bold text-on-surface shrink-0">
                    {tie.unseeded.points} pts
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-surface-container-high/40 font-mono text-[10px] text-on-surface-variant">
                  <span>Vuelta en casa de: {tie.seeded.shortName}</span>
                  <span className="text-primary hover:underline cursor-pointer" onClick={() => onSelectTeam(tie.seeded.id)}>
                    Simular cruce →
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* STANDARD & UCL PHASE VIEW CARDS LIST */
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
              {selectedLeague === "ucl" ? (
                <button
                  onClick={handleSyncUclRound4}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-cyan-400 text-black font-mono text-xs font-bold shadow-md hover:bg-cyan-300"
                >
                  ⚡ Inscribir los 36 clubes de la fase liga
                </button>
              ) : (
                <button
                  onClick={() => setIsAddTeamOpen(true)}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-primary text-on-primary font-mono text-xs font-bold"
                >
                  + Agregar Club y Vincular
                </button>
              )}
            </div>
          ) : selectedLeague === "ucl" && uclFilter === "all" ? (
            /* ORGANIZED 3 PHASES CONTAINER */
            <div className="flex flex-col gap-6">
              {/* FASE 1: OCTAVOS DE FINAL DIRECTO */}
              <div className="flex flex-col gap-2.5">
                <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span className="font-bold text-xs text-emerald-300 font-mono uppercase tracking-wide">
                      Octavos de Final Directo (Puestos 1 al 8)
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-emerald-400/80">Clasifican directo a Octavos</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {filteredClubs.filter((c) => c.rank !== null && c.rank <= 8).map(renderClubCard)}
                </div>
              </div>

              {/* FASE 2: QUALIFICATION PLAYOFFS */}
              <div className="flex flex-col gap-2.5">
                <div className="p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-500/40 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
                    <span className="font-bold text-xs text-cyan-300 font-mono uppercase tracking-wide">
                      Qualification Playoffs (Puestos 9 al 24)
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-cyan-300/80">Dieciseisavos (9-16 vs 17-24)</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {filteredClubs.filter((c) => c.rank !== null && c.rank >= 9 && c.rank <= 24).map(renderClubCard)}
                </div>
              </div>

              {/* FASE 3: ZONA DE ELIMINACIÓN */}
              <div className="flex flex-col gap-2.5">
                <div className="p-2.5 rounded-xl bg-rose-950/30 border border-rose-900/40 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-400"></span>
                    <span className="font-bold text-xs text-rose-300 font-mono uppercase tracking-wide">
                      Zona de Eliminación (Puestos 25 al 36)
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-rose-400/80">Eliminados de competencias europeas</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {filteredClubs.filter((c) => c.rank !== null && c.rank >= 25).map(renderClubCard)}
                </div>
              </div>
            </div>
          ) : (
            filteredClubs.map(renderClubCard)
          )}
        </div>
      )}

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
                    <option value="ligue1">🇫🇷 Ligue 1</option>
                    <option value="primeira_liga">🇵🇹 Primeira Liga</option>
                    <option value="eredivisie">🇳🇱 Eredivisie</option>
                    <option value="intl">🌍 Ninguna (solo competición europea)</option>
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

              {noLeague ? (
                <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-800/50 mt-1 flex flex-col gap-2">
                  <label className="block text-[10px] font-mono text-cyan-300 uppercase">Inscrito solo en</label>
                  <select
                    value={teamIntlComp}
                    onChange={(e) => setTeamIntlComp(e.target.value)}
                    className="w-full h-9 px-2 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high"
                  >
                    <option value="ucl">🏆 Champions League</option>
                    <option value="uel">🏆 Europa League</option>
                    <option value="uecl">🏆 Conference League</option>
                  </select>
                  <p className="text-[10px] text-cyan-200/70 font-mono">
                    No se registra su liga. Aparece en esta competición solo durante la temporada actual; la próxima
                    puedes volver a inscribirlo con "Vincular". Sin partidos de liga no tiene fuerza calculada: en el
                    simulador y en la nota esperada cuenta como un equipo medio.
                  </p>
                </div>
              ) : (
              <>
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
              </>
              )}

              <p className="font-mono text-[10px] text-on-surface-variant">
                Puntos, forma y fuerza se calculan solos con los resultados que registres en su perfil.
              </p>
              {createError && <p className="font-mono text-[11px] text-error">{createError}</p>}

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
