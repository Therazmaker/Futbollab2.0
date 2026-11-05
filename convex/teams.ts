import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { recomputeLeague } from "./lib/leagueTable";
import { findTeamMatch } from "./lib/teamMatches";
import { refreshRatingModel } from "./lib/ratingStore";

/**
 * Returns all registered leagues and continental tournaments.
 */
export const getLeagues = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("leagues").collect();
  },
});

/**
 * Adds a new league or cup/tournament (e.g. Champions League, Serie A).
 */
export const createLeague = mutation({
  args: {
    code: v.string(),
    name: v.string(),
    country: v.string(),
    isTournament: v.boolean(),
    crestUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("leagues")
      .withIndex("by_code", (q: any) => q.eq("code", args.code.toLowerCase()))
      .first();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("leagues", {
      code: args.code.toLowerCase(),
      name: args.name,
      country: args.country,
      isTournament: args.isTournament,
      crestUrl: args.crestUrl,
    });
  },
});

/**
 * Returns teams. If a league/tournament code is specified:
 * matches either by domestic league OR by tournament participation link (e.g. 'ucl').
 * This ensures no duplicated records!
 */
export const getTeams = query({
  args: { league: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("teams").collect();

    if (!args.league || args.league === "all") {
      return all;
    }

    const code = args.league.toLowerCase();
    return all.filter((t: any) => {
      const isDomestic = t.league?.toLowerCase() === code;
      const isLinkedToCompetition = t.competitions?.some(
        (c: string) => c.toLowerCase() === code
      );
      return isDomestic || isLinkedToCompetition;
    });
  },
});

/**
 * Creates a new team associated with its domestic league
 * and optional linked continental competitions (e.g. Inter -> Serie A + UCL).
 */
export const createTeam = mutation({
  args: {
    name: v.string(),
    shortName: v.optional(v.string()),
    league: v.string(), // Domestic league code, e.g. "seriea"
    competitions: v.optional(v.array(v.string())), // e.g. ["seriea", "ucl"]
    crestUrl: v.optional(v.string()),
    rank: v.optional(v.number()),
    points: v.optional(v.number()),
    goalDifference: v.optional(v.number()),
    formation: v.optional(v.string()),
    meanXg: v.optional(v.number()),
    ppda: v.optional(v.number()),
    tempo: v.optional(v.string()),
    form: v.optional(v.array(v.string())),
    density: v.optional(v.number()),
    predAccuracy: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Ensure domestic league is included in competitions list
    const comps = new Set<string>();
    comps.add(args.league.toLowerCase());
    if (args.competitions) {
      args.competitions.forEach((c) => comps.add(c.toLowerCase()));
    }

    // Solo se guarda lo que el usuario dio: tabla, forma y fuerza salen de los resultados
    return await ctx.db.insert("teams", {
      name: args.name,
      shortName: args.shortName || args.name.slice(0, 3).toUpperCase(),
      league: args.league.toLowerCase(),
      competitions: Array.from(comps),
      crestUrl: args.crestUrl,
      formation: args.formation,
    });
  },
});

/**
 * Links an existing team to an additional competition without duplicating
 * (e.g. adding Champions League 'ucl' to Inter Milan or Real Madrid).
 */
export const linkTeamToCompetition = mutation({
  args: {
    teamId: v.id("teams"),
    competitionCode: v.string(),
  },
  handler: async (ctx, args) => {
    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found");

    const comps = new Set<string>(team.competitions || [team.league]);
    comps.add(args.competitionCode.toLowerCase());

    await ctx.db.patch(args.teamId, {
      competitions: Array.from(comps),
    });

    return { success: true, competitions: Array.from(comps) };
  },
});

/**
 * Seeds initial leagues and teams with non-duplicated cross-competition links.
 */
export const seedInitialCompetitionsAndTeams = mutation({
  args: {},
  handler: async (ctx) => {
    // 1. Seed Leagues
    const leaguesList = [
      { code: "laliga", name: "LaLiga", country: "España", isTournament: false },
      { code: "premier", name: "Premier League", country: "Inglaterra", isTournament: false },
      { code: "seriea", name: "Serie A", country: "Italia", isTournament: false },
      { code: "bundesliga", name: "Bundesliga", country: "Alemania", isTournament: false },
      { code: "ucl", name: "Champions League", country: "Europa", isTournament: true },
    ];

    for (const lg of leaguesList) {
      const exists = await ctx.db
        .query("leagues")
        .withIndex("by_code", (q: any) => q.eq("code", lg.code))
        .first();
      if (!exists) {
        await ctx.db.insert("leagues", lg);
      }
    }

    // 2. Seed Teams with Multi-Competition Linking (Inter in Serie A + UCL)
    const teamsList = [
      {
        name: "Real Madrid CF",
        shortName: "RMD",
        league: "laliga",
        competitions: ["laliga", "ucl"], // Plays LaLiga and Champions League
        rank: 1,
        points: 68,
        goalDifference: 34,
        formation: "4-3-1-2",
        meanXg: 2.41,
        ppda: 8.6,
        tempo: "18.4 m/s",
        form: ["W", "W", "W", "D", "W"],
        density: 94.2,
        predAccuracy: 96.4,
        crestUrl:
          "https://lh3.googleusercontent.com/aida-public/AB6AXuDIfxcvoBCPvtYy-GIQmSp-Dow-fMvM-g40ZpzX4LW3EprnYvecexSz2jZ1hVGp28kmIVJkIHlBM8OvL0j4qY9Cs-0CFUC6tQwDHoNE2IO7l6B71Slde3MdVfdsLdy4XJkQk7XfmRYoDdnLXb5m2gNvNOS5nxVqDMcu-xA0AzEU2_zM5a_jlavqxMZ5EsSn1iQHslWNjVLOP1Zm1OjeO5XGNT9eCQNvBNY1Qln8xFrU",
      },
      {
        name: "Inter de Milán",
        shortName: "INT",
        league: "seriea", // Domestic Serie A
        competitions: ["seriea", "ucl"], // Also linked to Champions League without duplicating!
        rank: 1,
        points: 66,
        goalDifference: 37,
        formation: "3-5-2",
        meanXg: 2.38,
        ppda: 8.9,
        tempo: "17.6 m/s",
        form: ["W", "W", "W", "D", "W"],
        density: 95.0,
        predAccuracy: 95.2,
        crestUrl:
          "https://lh3.googleusercontent.com/aida-public/AB6AXuCCZxX_RKG9Kw3V_AeffYvAEQZ2O-5SNDJjJEqhkjWP8GPcs1IU8folt_fcjW990glWUrRs9flIwRjiTzynkHsXm5RqkDcE4EQLrOGrNucBcf3IJ9qRXStGoFVJJTa7B5T4xcQhC33v621mQumluyW0ASW341nwt8t57tCU32NG0YQ4gnG3Mlm00Wgo5wvOl3cNDCVAI_Xc8UyMmliSxBJkglldb8klQJ1tOUvVjNnO",
      },
      {
        name: "Manchester City",
        shortName: "MCI",
        league: "premier",
        competitions: ["premier", "ucl"],
        rank: 1,
        points: 67,
        goalDifference: 38,
        formation: "3-2-4-1",
        meanXg: 2.58,
        ppda: 7.9,
        tempo: "16.8 m/s",
        form: ["W", "W", "D", "W", "W"],
        density: 96.1,
        predAccuracy: 95.8,
        crestUrl:
          "https://lh3.googleusercontent.com/aida-public/AB6AXuB0A5-GaExMX0cNCouFyrxKzk5ScShdPQ6A26VEwd6Ni2YtaAp4jUVnSupHxD6m65qdlGGjKrgaIGmta2dx_ncybtv7O-dUDosyF9Qp3VWq3De15Y-MWZUsYgvgtcVVc098gP9C1lLBAwRl4poSTs8cdUlqfZsD4Vpuv-gwbS3DwSdylHf3Kho3fm-KkfaPF3ABN-vb-FsUo-__tFXY5jJMYlnSVa50NF6wixwlI71E",
      },
      {
        name: "FC Barcelona",
        shortName: "BAR",
        league: "laliga",
        competitions: ["laliga", "ucl"],
        rank: 2,
        points: 62,
        goalDifference: 29,
        formation: "4-3-3",
        meanXg: 2.29,
        ppda: 8.2,
        tempo: "17.2 m/s",
        form: ["W", "D", "W", "W", "L"],
        density: 91.5,
        predAccuracy: 93.1,
        crestUrl:
          "https://lh3.googleusercontent.com/aida-public/AB6AXuAKJYvbPUeSnZf54oZrzLQMUQ6QZxo1JxZUX-oO7C1xUN28V7PVBNxt3nlcAOvnE5Rw8A0LTkY0ODrvOoTpP8hZA3_V38oE9Z43AMvv7fSRxAzSf0ka2hjBqfqLRQcfkB3J0czmS-_oD2qk1joeD7lX38uEdLw901OLid8UbL2_slu__TgMo_JstpqJoxWi7xp_6yVo5CHUC0zN0MaRp0WwuS9CjedFv0ixAJvDFnrU",
      },
    ];

    for (const tm of teamsList) {
      const existingTeam = await ctx.db
        .query("teams")
        .filter((q: any) => q.eq(q.field("name"), tm.name))
        .first();

      if (!existingTeam) {
        await ctx.db.insert("teams", tm);
      } else {
        // Ensure competitions are up to date
        await ctx.db.patch(existingTeam._id, {
          competitions: tm.competitions,
          shortName: tm.shortName,
          crestUrl: tm.crestUrl,
        });
      }
    }

    return { seeded: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Perfil de equipo, resultados y simulador (datos reales de la tabla `matches`)
// ─────────────────────────────────────────────────────────────────────────────

const POSITION_ORDER: Record<string, number> = { GK: 0, DF: 1, MF: 2, AM: 3, FW: 4 };
function positionRank(pos = "") {
  const p = pos.toUpperCase();
  for (const k of Object.keys(POSITION_ORDER)) if (p.startsWith(k)) return POSITION_ORDER[k];
  if (/PORTER|GOALK/.test(p)) return 0;
  if (/DEF|BACK|LATERAL|CENTRAL/.test(p)) return 1;
  if (/STRIK|DELANT|FORW|WING|EXTREM/.test(p)) return 4;
  return 2;
}

export const getTeamProfile = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    const team = await ctx.db.get(teamId);
    if (!team) return null;
    const league = await ctx.db
      .query("leagues")
      .withIndex("by_code", (q) => q.eq("code", team.league))
      .first();

    const home = await ctx.db
      .query("matches")
      .withIndex("by_home_and_date", (q) => q.eq("homeTeamId", teamId))
      .collect();
    const away = await ctx.db
      .query("matches")
      .withIndex("by_away_and_date", (q) => q.eq("awayTeamId", teamId))
      .collect();
    const names = new Map<string, string>();
    const nameOf = async (id: Id<"teams">) => {
      if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.name ?? "?");
      return names.get(id)!;
    };
    const all = [...home, ...away].sort((a, b) => (a.date < b.date ? 1 : -1));
    type ResultRow = {
      _id: Id<"matches">;
      date: string;
      isHome: boolean;
      opponentId: Id<"teams">;
      opponent: string;
      goalsFor: number | null;
      goalsAgainst: number | null;
      result: "W" | "D" | "L" | null;
      competition: string;
      playersLogged: number;
    };
    const results: ResultRow[] = [];
    for (const m of all) {
      const isHome = m.homeTeamId === teamId;
      const gf = (isHome ? m.homeGoals : m.awayGoals) ?? null;
      const ga = (isHome ? m.awayGoals : m.homeGoals) ?? null;
      const logs = await ctx.db
        .query("playerMatchLogs")
        .withIndex("by_match", (q) => q.eq("matchId", m._id))
        .collect();
      results.push({
        _id: m._id,
        date: m.date,
        isHome,
        opponentId: isHome ? m.awayTeamId : m.homeTeamId,
        opponent: await nameOf(isHome ? m.awayTeamId : m.homeTeamId),
        goalsFor: gf,
        goalsAgainst: ga,
        result: (gf === null || ga === null ? null : gf > ga ? "W" : gf === ga ? "D" : "L") as ResultRow["result"],
        competition: m.league,
        playersLogged: logs.length,
      });
    }
    const split = (all: ResultRow[]) => {
      const rows = all.filter((r) => r.result !== null) as Array<ResultRow & { goalsFor: number; goalsAgainst: number }>;
      return {
      played: rows.length,
      wins: rows.filter((r) => r.result === "W").length,
      draws: rows.filter((r) => r.result === "D").length,
      losses: rows.filter((r) => r.result === "L").length,
      goalsFor: rows.reduce((a, r) => a + r.goalsFor, 0),
      goalsAgainst: rows.reduce((a, r) => a + r.goalsAgainst, 0),
      };
    };

    const players = await ctx.db
      .query("players")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .collect();
    const squad = [];
    for (const p of players) {
      const logs = await ctx.db
        .query("playerMatchLogs")
        .withIndex("by_player", (q) => q.eq("playerId", p._id))
        .collect();
      squad.push({
        _id: p._id,
        name: p.name,
        position: p.position,
        number: p.number ?? null,
        age: p.age ?? null,
        seasonStats: p.seasonStats ?? null,
        loggedMatches: logs.length,
        lastMatchDate: logs.reduce((acc, l) => (l.matchDate > acc ? l.matchDate : acc), ""),
      });
    }
    squad.sort(
      (a, b) =>
        positionRank(a.position) - positionRank(b.position) ||
        (b.seasonStats?.minutes ?? 0) - (a.seasonStats?.minutes ?? 0) ||
        a.name.localeCompare(b.name)
    );

    const leagueTeams = await ctx.db
      .query("teams")
      .withIndex("by_league", (q) => q.eq("league", team.league))
      .collect();
    const table = leagueTeams
      .filter((t) => t.rank)
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
      .map((t) => ({
        _id: t._id,
        name: t.name,
        rank: t.rank!,
        points: t.points ?? 0,
        played: t.played ?? 0,
        goalDifference: t.goalDifference ?? 0,
      }));

    return {
      team,
      league: league ?? null,
      // Récord de LIGA (igual que los puntos); la lista `results` incluye todas las competiciones
      record: (() => {
        const league = results.filter((r) => r.competition === team.league);
        return { total: split(league), home: split(league.filter((r) => r.isHome)), away: split(league.filter((r) => !r.isHome)) };
      })(),
      results,
      squad,
      table,
    };
  },
});

function pois(k: number, l: number) {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-l) * Math.pow(l, k)) / f;
}

/**
 * Simulación de un partido con el modelo Poisson (Dixon-Coles) de la liga:
 * goles esperados = media de la liga × ventaja local × ataque × defensa rival.
 */
export const predictMatch = query({
  args: { homeTeamId: v.id("teams"), awayTeamId: v.id("teams") },
  handler: async (ctx, { homeTeamId, awayTeamId }) => {
    const home = await ctx.db.get(homeTeamId);
    const away = await ctx.db.get(awayTeamId);
    if (!home || !away || !home.attackRating || !away.attackRating || !home.defenseRating || !away.defenseRating) {
      return null;
    }
    const league = await ctx.db
      .query("leagues")
      .withIndex("by_code", (q) => q.eq("code", home.league))
      .first();
    const avg = league?.goalsPerTeam ?? 1.4;
    const homeAdv = league?.homeAdvantage ?? 1.15;
    const lh = avg * homeAdv * home.attackRating * away.defenseRating;
    const la = avg * away.attackRating * home.defenseRating;
    const rho = -0.1;
    let pH = 0, pD = 0, pA = 0, over25 = 0, btts = 0, total = 0;
    const scores: Array<{ home: number; away: number; p: number }> = [];
    for (let i = 0; i <= 10; i++) {
      for (let j = 0; j <= 10; j++) {
        let p = pois(i, lh) * pois(j, la);
        if (i === 0 && j === 0) p *= 1 - lh * la * rho;
        else if (i === 0 && j === 1) p *= 1 + lh * rho;
        else if (i === 1 && j === 0) p *= 1 + la * rho;
        else if (i === 1 && j === 1) p *= 1 - rho;
        total += p;
        if (i > j) pH += p;
        else if (i === j) pD += p;
        else pA += p;
        if (i + j > 2) over25 += p;
        if (i > 0 && j > 0) btts += p;
        scores.push({ home: i, away: j, p });
      }
    }
    scores.sort((a, b) => b.p - a.p);
    const r = (x: number) => +(x / total).toFixed(3);
    return {
      home: home.name,
      away: away.name,
      expectedGoals: { home: +lh.toFixed(2), away: +la.toFixed(2) },
      probabilities: { home: r(pH), draw: r(pD), away: r(pA) },
      over25: r(over25),
      btts: r(btts),
      topScores: scores.slice(0, 5).map((s) => ({ ...s, p: r(s.p) })),
      sameLeague: home.league === away.league,
    };
  },
});

/** Registra un resultado de equipo y recalcula la tabla y la fuerza de la liga. */
export const addMatchResult = mutation({
  args: {
    homeTeamId: v.id("teams"),
    awayTeamId: v.id("teams"),
    homeGoals: v.number(),
    awayGoals: v.number(),
    date: v.string(),
    competition: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.homeTeamId === args.awayTeamId) throw new Error("Local y visitante deben ser distintos");
    if (args.homeGoals < 0 || args.awayGoals < 0) throw new Error("Goles no válidos");
    const home = await ctx.db.get(args.homeTeamId);
    if (!home) throw new Error("Equipo local no encontrado");
    // Si ya existe (p. ej. creado al registrar un jugador), solo se pone el marcador
    const existing = await findTeamMatch(ctx.db, args.homeTeamId, args.awayTeamId, args.date);
    if (existing) {
      await ctx.db.patch(existing._id, { homeGoals: args.homeGoals, awayGoals: args.awayGoals });
      await recomputeLeague(ctx.db, existing.league);
      await refreshRatingModel(ctx.db);
      return existing._id;
    }
    const league = args.competition || home.league;
    const id = await ctx.db.insert("matches", {
      homeTeamId: args.homeTeamId,
      awayTeamId: args.awayTeamId,
      homeGoals: args.homeGoals,
      awayGoals: args.awayGoals,
      date: args.date,
      league,
    });
    await recomputeLeague(ctx.db, league);
    await refreshRatingModel(ctx.db);
    return id;
  },
});

export const deleteMatchResult = mutation({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const m = await ctx.db.get(matchId);
    if (!m) return null;
    // Los partidos de jugadores no se borran: solo se desvinculan
    const logs = await ctx.db
      .query("playerMatchLogs")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
    for (const l of logs) await ctx.db.patch(l._id, { matchId: undefined });
    await ctx.db.delete(matchId);
    await recomputeLeague(ctx.db, m.league);
    await refreshRatingModel(ctx.db);
    return matchId;
  },
});

/** Pone o cambia el marcador de un partido del equipo. */
export const setMatchScore = mutation({
  args: { matchId: v.id("matches"), homeGoals: v.number(), awayGoals: v.number() },
  handler: async (ctx, { matchId, homeGoals, awayGoals }) => {
    const m = await ctx.db.get(matchId);
    if (!m) throw new Error("Partido no encontrado");
    if (homeGoals < 0 || awayGoals < 0) throw new Error("Goles no válidos");
    await ctx.db.patch(matchId, { homeGoals, awayGoals });
    await recomputeLeague(ctx.db, m.league);
    await refreshRatingModel(ctx.db);
    return matchId;
  },
});

/** Partidos recientes de un equipo (para elegirlos al registrar un jugador). */
export const recentMatches = query({
  args: { teamId: v.id("teams"), playerId: v.optional(v.id("players")), limit: v.optional(v.number()) },
  handler: async (ctx, { teamId, playerId, limit }) => {
    const take = Math.min(30, limit ?? 12);
    const home = await ctx.db
      .query("matches")
      .withIndex("by_home_and_date", (q) => q.eq("homeTeamId", teamId))
      .order("desc")
      .take(take);
    const away = await ctx.db
      .query("matches")
      .withIndex("by_away_and_date", (q) => q.eq("awayTeamId", teamId))
      .order("desc")
      .take(take);
    const rows = [...home, ...away].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, take);
    const out = [];
    for (const m of rows) {
      const isHome = m.homeTeamId === teamId;
      const opponentId = isHome ? m.awayTeamId : m.homeTeamId;
      const logs = await ctx.db
        .query("playerMatchLogs")
        .withIndex("by_match", (q) => q.eq("matchId", m._id))
        .collect();
      out.push({
        _id: m._id,
        date: m.date,
        isHome,
        opponentId,
        opponent: (await ctx.db.get(opponentId))?.name ?? "?",
        competition: m.league,
        goalsFor: (isHome ? m.homeGoals : m.awayGoals) ?? null,
        goalsAgainst: (isHome ? m.awayGoals : m.homeGoals) ?? null,
        playersLogged: logs.length,
        loggedByPlayer: playerId ? logs.some((l) => l.playerId === playerId) : false,
      });
    }
    return out;
  },
});

/** Claves que no tiene sentido sumar entre jugadores. */
const NON_ADDITIVE = /(Pct|^rating$|^topSpeedKmh$|^longestProgressiveCarryM$)/;

/** Detalle de un partido de equipo: marcador, quién jugó, sus stats y los totales. */
export const getMatchDetail = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const m = await ctx.db.get(matchId);
    if (!m) return null;
    const home = await ctx.db.get(m.homeTeamId);
    const away = await ctx.db.get(m.awayTeamId);
    const logs = await ctx.db
      .query("playerMatchLogs")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
    const side = (teamId: Id<"teams">) => ({ teamId, players: [] as any[], totals: {} as Record<string, number>, ratingAvg: null as number | null });
    const sides = { home: side(m.homeTeamId), away: side(m.awayTeamId) };
    for (const l of logs) {
      const p = await ctx.db.get(l.playerId);
      if (!p) continue;
      const s = p.teamId === m.homeTeamId ? sides.home : p.teamId === m.awayTeamId ? sides.away : null;
      if (!s) continue;
      s.players.push({
        logId: l._id,
        playerId: p._id,
        name: p.name,
        position: p.position,
        number: p.number ?? null,
        minutesPlayed: l.minutesPlayed,
        rawStats: l.rawStats ?? {},
      });
    }
    for (const s of [sides.home, sides.away]) {
      s.players.sort((a, b) => b.minutesPlayed - a.minutesPlayed || a.name.localeCompare(b.name));
      const ratings: number[] = [];
      for (const pl of s.players) {
        for (const [k, val] of Object.entries(pl.rawStats as Record<string, unknown>)) {
          const n = Number(val);
          if (!Number.isFinite(n)) continue;
          if (k === "rating") ratings.push(n);
          if (NON_ADDITIVE.test(k)) continue;
          s.totals[k] = +((s.totals[k] ?? 0) + n).toFixed(2);
        }
      }
      s.ratingAvg = ratings.length ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : null;
      if (s.totals.totalPasses) s.totals.accuratePassesPct = Math.round(((s.totals.accuratePasses ?? 0) / s.totals.totalPasses) * 100);
    }
    return {
      match: m,
      competition: m.league,
      home: { name: home?.name ?? "?", ...sides.home },
      away: { name: away?.name ?? "?", ...sides.away },
    };
  },
});

/** Programa un partido futuro (sin marcador) para un equipo. */
export const scheduleMatch = mutation({
  args: {
    teamId: v.id("teams"),
    opponentTeamId: v.id("teams"),
    isHome: v.boolean(),
    date: v.string(),
    competition: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.teamId === args.opponentTeamId) throw new Error("El rival debe ser otro equipo");
    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Equipo no encontrado");
    const homeTeamId = args.isHome ? args.teamId : args.opponentTeamId;
    const awayTeamId = args.isHome ? args.opponentTeamId : args.teamId;
    const existing = await findTeamMatch(ctx.db, homeTeamId, awayTeamId, args.date);
    if (existing) return existing._id;
    return await ctx.db.insert("matches", {
      homeTeamId,
      awayTeamId,
      date: args.date,
      league: args.competition || team.league,
    });
  },
});

/** Próximos partidos (desde `fromDate`, sin marcador) de un equipo. */
export const upcomingMatches = query({
  args: { teamId: v.id("teams"), fromDate: v.string() },
  handler: async (ctx, { teamId, fromDate }) => {
    const home = await ctx.db
      .query("matches")
      .withIndex("by_home_and_date", (q) => q.eq("homeTeamId", teamId).gte("date", fromDate))
      .collect();
    const away = await ctx.db
      .query("matches")
      .withIndex("by_away_and_date", (q) => q.eq("awayTeamId", teamId).gte("date", fromDate))
      .collect();
    const rows = [...home, ...away]
      .filter((m) => m.homeGoals === undefined)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(0, 10);
    const out = [];
    for (const m of rows) {
      const isHome = m.homeTeamId === teamId;
      const opponentId = isHome ? m.awayTeamId : m.homeTeamId;
      out.push({
        _id: m._id,
        date: m.date,
        isHome,
        opponentId,
        opponent: (await ctx.db.get(opponentId))?.name ?? "?",
        competition: m.league,
      });
    }
    return out;
  },
});
