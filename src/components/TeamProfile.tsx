"use client";

import React, { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { TeamMatchSheet } from "./TeamMatchSheet";
import { TeamNarrativeTrends } from "./NarrativePanel";
import { RivalPicker } from "./RivalPicker";
import { COMPETITIONS, competitionLabel } from "@/lib/competitions";

interface TeamProfileProps {
  teamId: Id<"teams">;
  onBack: () => void;
  onOpenTeam: (teamId: Id<"teams">) => void;
  onOpenPlayer: (playerId: Id<"players">, teamId?: Id<"teams">) => void;
}

const POSITION_GROUPS: Array<{ key: string; label: string; test: (p: string) => boolean }> = [
  { key: "GK", label: "Porteros", test: (p) => /^GK|PORTER|GOALK/i.test(p) },
  { key: "DF", label: "Defensas", test: (p) => /^DF|DEF|BACK|LATERAL|CENTRAL/i.test(p) },
  { key: "FW", label: "Delanteros", test: (p) => /^FW|STRIK|DELANT|FORW|WING|EXTREM/i.test(p) },
  { key: "MF", label: "Centrocampistas", test: () => true },
];

const LEAGUE_LABEL: Record<string, string> = {
  laliga: "LaLiga",
  premier: "Premier League",
  seriea: "Serie A",
  bundesliga: "Bundesliga",
  ligue1: "Ligue 1",
  ucl: "Champions League",
};

const card = "bg-surface-container-low rounded-xl p-space-md border border-surface-container-high/60 shadow-md";
const input =
  "w-full h-9 px-2.5 rounded-lg bg-surface-container text-on-surface font-mono text-xs border border-surface-container-high focus:outline-none focus:border-primary";
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const pct = (x: number) => `${Math.round(x * 100)}%`;

function FormChip({ r }: { r: string | null }) {
  if (!r) {
    return (
      <span className="w-5 h-5 rounded flex items-center justify-center font-mono text-[10px] font-bold border border-outline-variant/40 text-on-surface-variant">
        ?
      </span>
    );
  }
  const cls =
    r === "W"
      ? "bg-primary/20 text-primary border-primary/30"
      : r === "D"
      ? "bg-secondary/20 text-secondary border-secondary/30"
      : "bg-error/20 text-error border-error/30";
  return (
    <span className={`w-5 h-5 rounded flex items-center justify-center font-mono text-[10px] font-bold border ${cls}`}>
      {r === "W" ? "G" : r === "D" ? "E" : "P"}
    </span>
  );
}

function StrengthBar({ label, value, invert, hint }: { label: string; value?: number; invert?: boolean; hint: string }) {
  if (!value) {
    return (
      <div className="font-mono text-[10px] text-on-surface-variant">
        {label}: sin datos (registra resultados o importa el histórico)
      </div>
    );
  }
  // 1.0 = media. Para defensa, menos es mejor.
  const good = invert ? value < 1 : value > 1;
  const width = Math.max(4, Math.min(100, (value / 2) * 100));
  return (
    <div>
      <div className="flex justify-between font-mono text-[11px]">
        <span className="text-on-surface-variant">{label}</span>
        <span className={good ? "text-primary font-bold" : "text-tertiary font-bold"}>
          {value.toFixed(2)} · {signed(Math.round((value - 1) * 100))}%
        </span>
      </div>
      <div className="relative w-full bg-surface-container-highest h-2 rounded-full overflow-hidden mt-1">
        <div className={`h-full rounded-full ${good ? "bg-primary" : "bg-tertiary"}`} style={{ width: `${width}%` }} />
        <div className="absolute top-0 bottom-0 w-px bg-on-surface/60" style={{ left: "50%" }} title="media de la liga" />
      </div>
      <p className="font-mono text-[9px] text-on-surface-variant mt-0.5">{hint}</p>
    </div>
  );
}

export function TeamProfile({ teamId, onBack, onOpenTeam, onOpenPlayer }: TeamProfileProps) {
  const data = useQuery(api.teams.getTeamProfile, { teamId });
  const allTeams = useQuery(api.teams.getTeams, {}) ?? [];
  const addResult = useMutation(api.teams.addMatchResult);
  const deleteResult = useMutation(api.teams.deleteMatchResult);
  const createPlayer = useMutation(api.players.createPlayer);
  const scheduleMatch = useMutation(api.teams.scheduleMatch);
  const [scheduleModal, setScheduleModal] = useState(false);
  const [sched, setSched] = useState({ rival: "", isHome: true, date: "", competition: "" });

  const [simRival, setSimRival] = useState<string>("");
  const [simAway, setSimAway] = useState(false);
  const [showAllResults, setShowAllResults] = useState(false);
  const [openMatchId, setOpenMatchId] = useState<Id<"matches"> | null>(null);
  const [resultsScope, setResultsScope] = useState<"season" | "all">("season");
  const [tableScope, setTableScope] = useState<"current" | "last">("current");
  const [resultModal, setResultModal] = useState(false);
  const [playerModal, setPlayerModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState({
    rival: "",
    isHome: true,
    gf: "",
    ga: "",
    date: new Date().toISOString().split("T")[0],
    competition: "",
  });
  const [np, setNp] = useState({ name: "", position: "MF", number: "", age: "" });


  // Competiciones del equipo (su liga primero) para filtrar rivales
  const teamScopes = useMemo(() => {
    const t = data?.team;
    if (!t) return [] as string[];
    const own = t.league === "intl" ? [] : [t.league];
    return Array.from(new Set([...own, ...(t.competitions ?? []).filter((c) => c !== "intl")]));
  }, [data?.team]);
  const competitionOptions = useMemo(
    () => [...teamScopes, ...COMPETITIONS.map((c) => c.code).filter((c) => !teamScopes.includes(c))],
    [teamScopes]
  );

  const simulation = useQuery(
    api.teams.predictMatch,
    simRival
      ? simAway
        ? { homeTeamId: simRival as Id<"teams">, awayTeamId: teamId }
        : { homeTeamId: teamId, awayTeamId: simRival as Id<"teams"> }
      : "skip"
  );

  const squadGroups = useMemo(() => {
    const groups = POSITION_GROUPS.map((g) => ({ ...g, players: [] as any[] }));
    for (const p of data?.squad ?? []) {
      const g = groups.find((x) => x.test(p.position || "")) ?? groups[3];
      g.players.push(p);
    }
    return [groups[0], groups[1], groups[3], groups[2]].filter((g) => g.players.length);
  }, [data?.squad]);

  if (data === undefined) {
    return <div className={`${card} font-mono text-xs text-on-surface-variant`}>Cargando equipo…</div>;
  }
  if (data === null) {
    return (
      <div className={`${card} font-mono text-xs text-on-surface-variant flex flex-col gap-2`}>
        Este equipo ya no existe (quizá se fusionó con un duplicado).
        <button onClick={onBack} className="self-start px-3 py-1.5 rounded-lg bg-primary text-on-primary font-bold">
          Volver a Ligas
        </button>
      </div>
    );
  }

  const { team, record, results: allResults, squad } = data;
  const season = data.season;
  const noLeague = team.league === "intl";
  const ownComp = noLeague ? (team.competitions ?? []).find((c) => c !== "intl") ?? "ucl" : team.league;
  const leagueName = noLeague
    ? `Solo ${LEAGUE_LABEL[ownComp] ?? ownComp.toUpperCase()}`
    : LEAGUE_LABEL[team.league] ?? data.league?.name ?? team.league;
  // Sin liga no hay tabla: los puntos se cuentan con sus partidos de la competición
  const points = noLeague ? record.total.wins * 3 + record.total.draws : team.points ?? 0;
  const seasonResults = allResults.filter((r) => r.season === season);
  const results = resultsScope === "season" ? seasonResults : allResults;
  const visibleResults = showAllResults ? results : results.slice(0, 8);
  const showingLast = tableScope === "last" || (data.table.length === 0 && data.lastTable.length > 0);
  const table = showingLast ? data.lastTable : data.table;
  const tableIdx = table.findIndex((t) => t._id === teamId);
  const tableSlice = table.length <= 7 ? table : table.slice(Math.max(0, Math.min(tableIdx - 3, table.length - 7)), Math.max(0, Math.min(tableIdx - 3, table.length - 7)) + 7);

  const submitResult = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!res.rival || res.gf === "" || res.ga === "") return setError("Completa rival y goles.");
    setBusy(true);
    try {
      const gf = Number(res.gf);
      const ga = Number(res.ga);
      await addResult({
        homeTeamId: res.isHome ? teamId : (res.rival as Id<"teams">),
        awayTeamId: res.isHome ? (res.rival as Id<"teams">) : teamId,
        homeGoals: res.isHome ? gf : ga,
        awayGoals: res.isHome ? ga : gf,
        date: res.date,
        competition: res.competition || teamScopes[0],
      });
      setResultModal(false);
      setRes({ ...res, gf: "", ga: "" });
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const id = await createPlayer({
        teamId,
        name: np.name,
        position: np.position,
        number: np.number ? Number(np.number) : undefined,
        age: np.age ? Number(np.age) : undefined,
      });
      setPlayerModal(false);
      setNp({ name: "", position: "MF", number: "", age: "" });
      onOpenPlayer(id);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col w-full gap-space-md">
      {/* Migas */}
      <div className="flex items-center gap-1.5 px-space-xs font-mono text-[11px] text-on-surface-variant truncate">
        <button onClick={onBack} className="flex items-center hover:text-primary" aria-label="Volver a Ligas">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        </button>
        <button onClick={onBack} className="hover:text-primary uppercase">Ligas</button>
        <span className="material-symbols-outlined text-[12px]">chevron_right</span>
        <span className="uppercase">{leagueName}</span>
        <span className="material-symbols-outlined text-[12px]">chevron_right</span>
        <span className="text-primary font-semibold uppercase truncate">{team.name}</span>
      </div>

      {/* Cabecera */}
      <div className={`${card} relative overflow-hidden`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-14 h-14 rounded-xl bg-surface-container-highest flex items-center justify-center border border-primary/30 shrink-0">
              {team.crestUrl ? (
                <img src={team.crestUrl} alt={team.name} className="w-full h-full object-contain p-2" />
              ) : (
                <span className="font-mono font-bold text-secondary">{team.shortName ?? team.name.slice(0, 3).toUpperCase()}</span>
              )}
              {team.rank && (
                <span className="absolute -bottom-1 -right-1 min-w-5 h-5 px-1 bg-primary text-on-primary rounded-full flex items-center justify-center font-mono text-[10px] font-bold">
                  {team.rank}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-on-surface truncate">{team.name}</h1>
              <p className="font-mono text-xs text-on-surface-variant">
                {team.rank ? `${team.rank}º en ${leagueName}` : leagueName}
                {(team.competitions ?? []).includes("ucl") && " · UCL"}
              </p>
            </div>
          </div>
          <div className="flex gap-0.5 shrink-0">
            {(team.form ?? []).map((r, i) => (
              <FormChip key={i} r={r} />
            ))}
          </div>
        </div>

        <p className="mt-3 font-mono text-[10px] uppercase text-on-surface-variant">
          Temporada {season} · {noLeague ? `${LEAGUE_LABEL[ownComp] ?? ownComp.toUpperCase()} (sin liga doméstica)` : "liga"}
          {team.lastSeason && (
            <span className="normal-case">
              {" "}
              · {team.lastSeason.season}: {team.lastSeason.rank}º, {team.lastSeason.points} pts en {team.lastSeason.played} PJ
            </span>
          )}
        </p>
        <div className="grid grid-cols-4 gap-2 mt-1 font-mono text-center">
          {[
            ["Pts", points],
            ["PJ", record.total.played],
            ["G-E-P", `${record.total.wins}-${record.total.draws}-${record.total.losses}`],
            ["Goles", `${record.total.goalsFor}:${record.total.goalsAgainst}`],
          ].map(([k, v]) => (
            <div key={k as string} className="bg-surface-container rounded-lg py-1.5">
              <p className="text-[9px] text-on-surface-variant uppercase">{k}</p>
              <p className="text-sm font-bold text-on-surface">{v}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2 font-mono text-[10px] text-on-surface-variant">
          <span>
            Casa: {record.home.wins}-{record.home.draws}-{record.home.losses} ({record.home.goalsFor}:{record.home.goalsAgainst})
          </span>
          <span className="text-right">
            Fuera: {record.away.wins}-{record.away.draws}-{record.away.losses} ({record.away.goalsFor}:{record.away.goalsAgainst})
          </span>
        </div>
      </div>

      <TeamNarrativeTrends teamId={team._id} />

      {/* Fuerza */}
      <div className={`${card} flex flex-col gap-3`}>
        <span className="font-mono text-xs uppercase text-primary font-bold flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">fitness_center</span>
          Fuerza (modelo Poisson con los resultados)
        </span>
        <StrengthBar
          label="Ataque"
          value={team.attackRating}
          hint="Goles que marca frente a la media de su liga, corregido por la calidad de los rivales."
        />
        <StrengthBar
          label="Defensa (goles que concede)"
          value={team.defenseRating}
          invert
          hint="Por debajo de 1.00 concede menos que la media. Se usa como contexto rival en el perfil de los jugadores."
        />
      </div>

      {/* Simulador */}
      <div className={`${card} flex flex-col gap-2`}>
        <span className="font-mono text-xs uppercase text-primary font-bold flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">casino</span>
          Simular partido
        </span>
        <div className="grid grid-cols-3 gap-2">
          <RivalPicker
            teams={allTeams as any[]}
            excludeId={teamId}
            value={simRival}
            onChange={(id) => setSimRival(id)}
            scopes={teamScopes}
            placeholder="— Elige rival —"
            className="col-span-2"
          />
          <select value={simAway ? "a" : "h"} onChange={(e) => setSimAway(e.target.value === "a")} className={input}>
            <option value="h">En casa</option>
            <option value="a">Fuera</option>
          </select>
        </div>
        {simRival && simulation === null && (
          <p className="font-mono text-[10px] text-on-surface-variant">
            Falta fuerza calculada para uno de los equipos (necesita resultados registrados).
          </p>
        )}
        {simulation && (
          <div className="flex flex-col gap-2 font-mono text-[11px]">
            <div className="flex h-6 rounded-lg overflow-hidden text-[10px] font-bold">
              <div className="bg-primary text-on-primary flex items-center justify-center" style={{ width: pct(simulation.probabilities.home) }}>
                {pct(simulation.probabilities.home)}
              </div>
              <div className="bg-secondary/70 text-black flex items-center justify-center" style={{ width: pct(simulation.probabilities.draw) }}>
                {pct(simulation.probabilities.draw)}
              </div>
              <div className="bg-tertiary text-black flex items-center justify-center" style={{ width: pct(simulation.probabilities.away) }}>
                {pct(simulation.probabilities.away)}
              </div>
            </div>
            <div className="flex justify-between text-on-surface-variant text-[10px]">
              <span>{simulation.home} (local)</span>
              <span>empate</span>
              <span>{simulation.away}</span>
            </div>
            <p className="text-on-surface">
              Goles esperados {simulation.expectedGoals.home} – {simulation.expectedGoals.away} · +2.5: {pct(simulation.over25)} · Ambos marcan:{" "}
              {pct(simulation.btts)}
            </p>
            <p className="text-on-surface-variant">
              Marcadores más probables:{" "}
              {simulation.topScores.map((s) => `${s.home}-${s.away} (${pct(s.p)})`).join(" · ")}
            </p>
            {!simulation.sameLeague && (
              <p className="text-[10px] text-tertiary">Equipos de ligas distintas: la fuerza no es del todo comparable.</p>
            )}
          </div>
        )}
      </div>

      {/* Plantilla */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-xs uppercase text-primary font-bold flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">groups</span>
            Plantilla ({squad.length})
          </span>
          <button
            onClick={() => {
              setError(null);
              setPlayerModal(true);
            }}
            className="px-2.5 py-1 rounded-lg bg-primary text-on-primary font-mono text-[11px] font-bold"
          >
            + Jugador
          </button>
        </div>
        {squad.length === 0 && (
          <p className="font-mono text-[11px] text-on-surface-variant">Sin jugadores todavía. Agrega el primero.</p>
        )}
        {squadGroups.map((g) => (
          <div key={g.key} className="mt-2">
            <p className="font-mono text-[10px] uppercase text-on-surface-variant tracking-wider mb-1">{g.label}</p>
            <div className="flex flex-col divide-y divide-surface-container-high/40">
              {g.players.map((p: any) => (
                <button
                  key={p._id}
                  onClick={() => onOpenPlayer(p._id)}
                  className="flex items-center justify-between py-2 px-1 -mx-1 rounded hover:bg-surface-container/70 text-left group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-7 h-7 rounded bg-surface-container-highest flex items-center justify-center font-mono text-[10px] text-secondary shrink-0">
                      {p.number ?? "–"}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-on-surface truncate group-hover:text-primary">{p.name}</p>
                      <p className="font-mono text-[10px] text-on-surface-variant">
                        {p.position}
                        {p.age ? ` · ${p.age} años` : ""}
                        {p.seasonStats?.minutes ? ` · ${p.seasonStats.minutes}' · ${p.seasonStats.goals ?? 0} G · ${p.seasonStats.assists ?? 0} A` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {p.availability?.status === "injured" && (
                      <span
                        className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-error/15 text-error border border-error/40 flex items-center gap-0.5"
                        title={p.availability.expectedReturn ? `Vuelta prevista ${p.availability.expectedReturn}` : "Lesionado"}
                      >
                        <span className="material-symbols-outlined text-[11px]">healing</span>
                        {p.availability.expectedReturn ? p.availability.expectedReturn.slice(5) : "baja"}
                      </span>
                    )}
                    {p.availability?.status === "returning" && (
                      <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40">
                        vuelve
                      </span>
                    )}
                    {p.loggedMatches > 0 && (
                      <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
                        {p.loggedMatches} partidos
                      </span>
                    )}
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant group-hover:text-primary">chevron_right</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Resultados */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-xs uppercase text-primary font-bold flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">scoreboard</span>
            Resultados
          </span>
          <div className="flex gap-1.5">
          <button
            onClick={() => {
              setError(null);
              setSched({ rival: "", isHome: true, date: "", competition: teamScopes[0] ?? team.league });
              setScheduleModal(true);
            }}
            className="px-2.5 py-1 rounded-lg bg-surface-container-high text-primary font-mono text-[11px] border border-primary/30"
          >
            + Próximo
          </button>
          <button
            onClick={() => {
              setError(null);
              setRes((r) => ({ ...r, rival: "", competition: teamScopes[0] ?? "" }));
              setResultModal(true);
            }}
            className="px-2.5 py-1 rounded-lg bg-surface-container-high text-secondary font-mono text-[11px] border border-secondary/30"
          >
            + Resultado
          </button>
          </div>
        </div>
        <div className="flex gap-1 mb-2 font-mono text-[10px]">
          {(
            [
              ["season", `Temporada ${season} (${seasonResults.length})`],
              ["all", `Todo el histórico (${allResults.length})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => {
                setResultsScope(k);
                setShowAllResults(false);
              }}
              className={`px-2 py-0.5 rounded ${resultsScope === k ? "bg-primary text-on-primary font-bold" : "bg-surface-container text-on-surface-variant"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {resultsScope === "season" && seasonResults.length === 0 && allResults.length > 0 && (
          <p className="font-mono text-[10px] text-on-surface-variant mb-1">
            Aún no hay partidos de esta temporada. Los de temporadas anteriores siguen entrenando los modelos (fuerza, simulador, nota esperada).
          </p>
        )}
        {allResults.length === 0 && <p className="font-mono text-[11px] text-on-surface-variant">Sin resultados registrados.</p>}
        <div className="flex flex-col divide-y divide-surface-container-high/40">
          {visibleResults.map((r) => (
            <div
              key={r._id}
              onClick={() => setOpenMatchId(r._id)}
              className="flex items-center justify-between py-1.5 font-mono text-[11px] group cursor-pointer hover:bg-surface-container/60 rounded px-1 -mx-1"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FormChip r={r.result} />
                <span className="text-on-surface-variant w-20 shrink-0">{r.date}</span>
                <span className="text-on-surface-variant w-4">{r.isHome ? "C" : "F"}</span>
                <span className="truncate text-on-surface">{r.opponent}</span>
                {resultsScope === "all" && r.season !== season && (
                  <span className="shrink-0 text-[9px] px-1 rounded bg-surface-container-highest text-on-surface-variant">{r.season}</span>
                )}
                {r.competition !== team.league && (
                  <span className="shrink-0 text-[9px] px-1 rounded bg-cyan-950/70 text-cyan-300 border border-cyan-800/50">
                    {r.competition === "ucl" ? "UCL" : competitionLabel(r.competition)}
                  </span>
                )}
                {r.playersLogged > 0 && (
                  <span className="shrink-0 text-[9px] px-1 rounded bg-primary/15 text-primary" title="Jugadores registrados">
                    {r.playersLogged}👤
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`font-bold ${r.result ? "text-on-surface" : "text-on-surface-variant"}`}>
                  {r.result
                    ? `${r.goalsFor}-${r.goalsAgainst}`
                    : r.date >= new Date().toISOString().split("T")[0]
                    ? "próximo"
                    : "sin marcador"}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMatchId(r._id);
                  }}
                  className="opacity-60 group-hover:opacity-100 text-on-surface-variant hover:text-secondary"
                  aria-label="Editar partido"
                  title="Editar competición, fecha, local/visitante o marcador"
                >
                  <span className="material-symbols-outlined text-[14px]">edit</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const label = r.result ? `${r.goalsFor}-${r.goalsAgainst}` : "(sin marcador)";
                    if (
                      window.confirm(
                        `¿Borrar ${team.name} ${label} ${r.opponent} (${r.date})?${
                          r.playersLogged ? `\nLos ${r.playersLogged} partidos de jugadores se conservan, solo se desvinculan.` : ""
                        }`
                      )
                    ) {
                      deleteResult({ matchId: r._id });
                    }
                  }}
                  className="opacity-40 group-hover:opacity-100 text-on-surface-variant hover:text-error"
                  aria-label="Borrar resultado"
                >
                  <span className="material-symbols-outlined text-[14px]">delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
        {results.length > 8 && (
          <button onClick={() => setShowAllResults(!showAllResults)} className="mt-2 font-mono text-[10px] text-secondary">
            {showAllResults ? "Ver menos" : `Ver los ${results.length}`}
          </button>
        )}
      </div>

      {/* Tabla */}
      {(data.table.length > 0 || data.lastTable.length > 0) && (
        <div className={card}>
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-xs uppercase text-primary font-bold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">leaderboard</span>
              Tabla {leagueName} {showingLast ? data.lastSeason : season}
            </span>
            {data.lastTable.length > 0 && data.table.length > 0 && (
              <button
                onClick={() => setTableScope(tableScope === "current" ? "last" : "current")}
                className="font-mono text-[10px] text-secondary"
              >
                {tableScope === "current" ? `ver ${data.lastSeason}` : `ver ${season}`}
              </button>
            )}
          </div>
          {showingLast && data.table.length === 0 && (
            <p className="font-mono text-[10px] text-on-surface-variant mb-1">
              Sin partidos de liga en {season} todavía: se muestra la tabla final de {data.lastSeason} como referencia.
            </p>
          )}
          <div className="flex flex-col font-mono text-[11px]">
            {tableSlice.map((t) => (
              <button
                key={t._id}
                onClick={() => t._id !== teamId && onOpenTeam(t._id)}
                className={`flex items-center justify-between py-1 px-1.5 rounded text-left ${
                  t._id === teamId ? "bg-primary/15 text-primary font-bold" : "hover:bg-surface-container text-on-surface"
                }`}
              >
                <span className="flex gap-2 min-w-0">
                  <span className="w-5 text-on-surface-variant">{t.rank}</span>
                  <span className="truncate">{t.name}</span>
                </span>
                <span className="flex gap-3 shrink-0">
                  <span className="text-on-surface-variant">{t.played} PJ</span>
                  <span className="w-8 text-right">{signed(t.goalDifference)}</span>
                  <span className="w-7 text-right font-bold">{t.points}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {openMatchId && (
        <TeamMatchSheet
          matchId={openMatchId}
          teamId={teamId}
          onClose={() => setOpenMatchId(null)}
          onOpenPlayer={(pid, tid) => {
            setOpenMatchId(null);
            onOpenPlayer(pid, tid);
          }}
          onOpenTeam={(tid) => {
            setOpenMatchId(null);
            if (tid !== teamId) onOpenTeam(tid);
          }}
        />
      )}

      {/* Modal: resultado */}
      {resultModal && (
        <Modal title={`Resultado de ${team.name}`} onClose={() => setResultModal(false)}>
          <form onSubmit={submitResult} className="flex flex-col gap-2">
            <label className="font-mono text-[10px] text-on-surface-variant uppercase">
              Competición del partido
              <select
                value={res.competition || teamScopes[0] || ""}
                onChange={(e) => setRes({ ...res, competition: e.target.value, rival: "" })}
                className={input}
              >
                {competitionOptions.map((c) => (
                  <option key={c} value={c}>
                    {competitionLabel(c) || c}
                  </option>
                ))}
              </select>
            </label>
            <RivalPicker
              teams={allTeams as any[]}
              excludeId={teamId}
              value={res.rival}
              onChange={(id) => setRes({ ...res, rival: id })}
              competition={res.competition || teamScopes[0]}
              required
            />
            <div className="grid grid-cols-2 gap-2">
              <select value={res.isHome ? "h" : "a"} onChange={(e) => setRes({ ...res, isHome: e.target.value === "h" })} className={input}>
                <option value="h">{team.name} en casa</option>
                <option value="a">{team.name} fuera</option>
              </select>
              <input type="date" value={res.date} onChange={(e) => setRes({ ...res, date: e.target.value })} className={input} required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="font-mono text-[10px] text-on-surface-variant">
                Goles {team.name}
                <input type="number" min="0" value={res.gf} onChange={(e) => setRes({ ...res, gf: e.target.value })} className={input} required />
              </label>
              <label className="font-mono text-[10px] text-on-surface-variant">
                Goles rival
                <input type="number" min="0" value={res.ga} onChange={(e) => setRes({ ...res, ga: e.target.value })} className={input} required />
              </label>
            </div>
            <p className="font-mono text-[10px] text-on-surface-variant">
              {(res.competition || teamScopes[0]) === team.league
                ? "Partido de liga: al guardar se recalculan la tabla y la fuerza de toda la liga."
                : "Partido de copa/europeo: sale en el perfil de los dos equipos, pero no cuenta para la tabla de liga."}
            </p>
            {error && <p className="font-mono text-[11px] text-error">{error}</p>}
            <ModalActions busy={busy} label="Guardar resultado" onCancel={() => setResultModal(false)} />
          </form>
        </Modal>
      )}

      {/* Modal: programar partido */}
      {scheduleModal && (
        <Modal title={`Próximo partido de ${team.name}`} onClose={() => setScheduleModal(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              if (!sched.rival || !sched.date) return setError("Elige rival y fecha.");
              setBusy(true);
              try {
                await scheduleMatch({
                  teamId,
                  opponentTeamId: sched.rival as Id<"teams">,
                  isHome: sched.isHome,
                  date: sched.date,
                  competition: sched.competition || undefined,
                });
                setScheduleModal(false);
              } catch (err: any) {
                setError(err?.message ?? String(err));
              } finally {
                setBusy(false);
              }
            }}
            className="flex flex-col gap-2"
          >
            <select
              value={sched.competition}
              onChange={(e) => setSched({ ...sched, competition: e.target.value, rival: "" })}
              className={input}
              aria-label="Competición"
            >
              {competitionOptions.map((c) => (
                <option key={c} value={c}>
                  {competitionLabel(c) || c}
                </option>
              ))}
            </select>
            <RivalPicker
              teams={allTeams as any[]}
              excludeId={teamId}
              value={sched.rival}
              onChange={(id) => setSched({ ...sched, rival: id })}
              competition={sched.competition}
              required
            />
            <div className="grid grid-cols-2 gap-2">
              <select value={sched.isHome ? "h" : "a"} onChange={(e) => setSched({ ...sched, isHome: e.target.value === "h" })} className={input}>
                <option value="h">{team.name} en casa</option>
                <option value="a">{team.name} fuera</option>
              </select>
              <input type="date" value={sched.date} onChange={(e) => setSched({ ...sched, date: e.target.value })} className={input} required />
            </div>
            <p className="font-mono text-[10px] text-on-surface-variant">
              Aparecerá en el perfil de cada jugador del equipo en "Próximo partido", con su nota esperada contra este rival.
              Después del partido, sus jugadores lo eligen al registrar y le pones el marcador.
            </p>
            {error && <p className="font-mono text-[11px] text-error">{error}</p>}
            <ModalActions busy={busy} label="Programar" onCancel={() => setScheduleModal(false)} />
          </form>
        </Modal>
      )}

      {/* Modal: jugador */}
      {playerModal && (
        <Modal title={`Nuevo jugador de ${team.name}`} onClose={() => setPlayerModal(false)}>
          <form onSubmit={submitPlayer} className="flex flex-col gap-2">
            <input
              value={np.name}
              onChange={(e) => setNp({ ...np, name: e.target.value })}
              placeholder="Nombre"
              className={input}
              required
            />
            <div className="grid grid-cols-3 gap-2">
              <select value={np.position} onChange={(e) => setNp({ ...np, position: e.target.value })} className={input}>
                <option value="GK">Portero</option>
                <option value="DF">Defensa</option>
                <option value="MF">Centrocampista</option>
                <option value="AM">Mediapunta</option>
                <option value="FW">Delantero</option>
              </select>
              <input type="number" min="1" value={np.number} onChange={(e) => setNp({ ...np, number: e.target.value })} placeholder="Dorsal" className={input} />
              <input type="number" min="14" value={np.age} onChange={(e) => setNp({ ...np, age: e.target.value })} placeholder="Edad" className={input} />
            </div>
            <p className="font-mono text-[10px] text-on-surface-variant">
              La posición fija la tasa base del perfil hasta que tenga partidos propios.
            </p>
            {error && <p className="font-mono text-[11px] text-error">{error}</p>}
            <ModalActions busy={busy} label="Crear y abrir perfil" onCancel={() => setPlayerModal(false)} />
          </form>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain flex justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-surface-container-low border border-primary/40 rounded-2xl w-full max-w-md p-5 shadow-2xl my-auto">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-surface-container-high">
          <h3 className="font-bold text-base text-on-surface">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-container text-on-surface-variant hover:text-on-surface">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ busy, label, onCancel }: { busy: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="mt-2 pt-3 pb-1 border-t border-surface-container-high flex justify-end gap-2 sticky bottom-0 bg-surface-container-low z-10">
      <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface-variant font-mono text-xs">
        Cancelar
      </button>
      <button type="submit" disabled={busy} className="px-4 py-1.5 rounded-lg bg-primary text-on-primary font-mono text-xs font-bold disabled:opacity-60">
        {busy ? "Guardando…" : label}
      </button>
    </div>
  );
}
