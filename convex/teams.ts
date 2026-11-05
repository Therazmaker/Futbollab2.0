import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { recomputeLeague } from "./lib/leagueTable";

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
    const filtered = all.filter((t: any) => {
      const isDomestic = t.league?.toLowerCase() === code;
      const isLinkedToCompetition = t.competitions?.some(
        (c: string) => c.toLowerCase() === code
      );
      const hasUclRank = code === "ucl" && t.uclRank !== undefined;
      return isDomestic || isLinkedToCompetition || hasUclRank;
    });

    if (code === "ucl") {
      return filtered.sort((a: any, b: any) => {
        const ra = a.uclRank ?? 999;
        const rb = b.uclRank ?? 999;
        return ra - rb || (b.uclPoints ?? 0) - (a.uclPoints ?? 0);
      });
    }

    return filtered;
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
      goalsFor: number;
      goalsAgainst: number;
      result: "W" | "D" | "L";
    };
    const results: ResultRow[] = [];
    for (const m of all) {
      const isHome = m.homeTeamId === teamId;
      const gf = isHome ? m.homeGoals : m.awayGoals;
      const ga = isHome ? m.awayGoals : m.homeGoals;
      results.push({
        _id: m._id,
        date: m.date,
        isHome,
        opponentId: isHome ? m.awayTeamId : m.homeTeamId,
        opponent: await nameOf(isHome ? m.awayTeamId : m.homeTeamId),
        goalsFor: gf,
        goalsAgainst: ga,
        result: (gf > ga ? "W" : gf === ga ? "D" : "L") as ResultRow["result"],
      });
    }
    const split = (rows: ResultRow[]) => ({
      played: rows.length,
      wins: rows.filter((r) => r.result === "W").length,
      draws: rows.filter((r) => r.result === "D").length,
      losses: rows.filter((r) => r.result === "L").length,
      goalsFor: rows.reduce((a, r) => a + r.goalsFor, 0),
      goalsAgainst: rows.reduce((a, r) => a + r.goalsAgainst, 0),
    });

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
      record: { total: split(results), home: split(results.filter((r) => r.isHome)), away: split(results.filter((r) => !r.isHome)) },
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
  },
  handler: async (ctx, args) => {
    if (args.homeTeamId === args.awayTeamId) throw new Error("Local y visitante deben ser distintos");
    if (args.homeGoals < 0 || args.awayGoals < 0) throw new Error("Goles no válidos");
    const home = await ctx.db.get(args.homeTeamId);
    if (!home) throw new Error("Equipo local no encontrado");
    const id = await ctx.db.insert("matches", { ...args, league: home.league });
    await recomputeLeague(ctx.db, home.league);
    return id;
  },
});

export const deleteMatchResult = mutation({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const m = await ctx.db.get(matchId);
    if (!m) return null;
    await ctx.db.delete(matchId);
    await recomputeLeague(ctx.db, m.league);
    return matchId;
  },
});



export interface UCLTeamSeed {
  rank: number;
  name: string;
  aliases?: string[];
  shortName: string;
  league: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: string[];
  phase: "direct_round_16" | "qualification_playoff" | "eliminated";
  crestUrl?: string;
}

export const UCL_ROUND_4_DATA: UCLTeamSeed[] = [
  // 1-8: Direct Round of 16 (Octavos de Final Directo)
  {
    rank: 1,
    name: "Liverpool",
    aliases: ["Liverpool FC"],
    shortName: "LIV",
    league: "premier",
    played: 4,
    wins: 4,
    draws: 0,
    losses: 0,
    goalsFor: 10,
    goalsAgainst: 1,
    goalDifference: 9,
    points: 12,
    form: ["W", "W", "W", "W"],
    phase: "direct_round_16",
    crestUrl: "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=256&q=80",
  },
  {
    rank: 2,
    name: "Sporting CP",
    aliases: ["Sporting de Portugal", "Sporting Lisbon"],
    shortName: "SCP",
    league: "primeira_liga",
    played: 4,
    wins: 3,
    draws: 1,
    losses: 0,
    goalsFor: 9,
    goalsAgainst: 2,
    goalDifference: 7,
    points: 10,
    form: ["W", "D", "W", "W"],
    phase: "direct_round_16",
  },
  {
    rank: 3,
    name: "AS Mónaco",
    aliases: ["Monaco", "AS Monaco"],
    shortName: "ASM",
    league: "ligue1",
    played: 4,
    wins: 3,
    draws: 1,
    losses: 0,
    goalsFor: 10,
    goalsAgainst: 4,
    goalDifference: 6,
    points: 10,
    form: ["W", "D", "W", "W"],
    phase: "direct_round_16",
  },
  {
    rank: 4,
    name: "Stade Brestois",
    aliases: ["Brest", "Stade Brestois 29"],
    shortName: "BRE",
    league: "ligue1",
    played: 4,
    wins: 3,
    draws: 1,
    losses: 0,
    goalsFor: 9,
    goalsAgainst: 3,
    goalDifference: 6,
    points: 10,
    form: ["W", "W", "D", "W"],
    phase: "direct_round_16",
  },
  {
    rank: 5,
    name: "Inter de Milán",
    aliases: ["Inter", "Inter Milan", "FC Internazionale"],
    shortName: "INT",
    league: "seriea",
    played: 4,
    wins: 3,
    draws: 1,
    losses: 0,
    goalsFor: 6,
    goalsAgainst: 0,
    goalDifference: 6,
    points: 10,
    form: ["D", "W", "W", "W"],
    phase: "direct_round_16",
    crestUrl:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuCCZxX_RKG9Kw3V_AeffYvAEQZ2O-5SNDJjJEqhkjWP8GPcs1IU8folt_fcjW990glWUrRs9flIwRjiTzynkHsXm5RqkDcE4EQLrOGrNucBcf3IJ9qRXStGoFVJJTa7B5T4xcQhC33v621mQumluyW0ASW341nwt8t57tCU32NG0YQ4gnG3Mlm00Wgo5wvOl3cNDCVAI_Xc8UyMmliSxBJkglldb8klQJ1tOUvVjNnO",
  },
  {
    rank: 6,
    name: "FC Barcelona",
    aliases: ["Barcelona", "Barça"],
    shortName: "BAR",
    league: "laliga",
    played: 4,
    wins: 3,
    draws: 0,
    losses: 1,
    goalsFor: 15,
    goalsAgainst: 5,
    goalDifference: 10,
    points: 9,
    form: ["L", "W", "W", "W"],
    phase: "direct_round_16",
    crestUrl:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuAKJYvbPUeSnZf54oZrzLQMUQ6QZxo1JxZUX-oO7C1xUN28V7PVBNxt3nlcAOvnE5Rw8A0LTkY0ODrvOoTpP8hZA3_V38oE9Z43AMvv7fSRxAzSf0ka2hjBqfqLRQcfkB3J0czmS-_oD2qk1joeD7lX38uEdLw901OLid8UbL2_slu__TgMo_JstpqJoxWi7xp_6yVo5CHUC0zN0MaRp0WwuS9CjedFv0ixAJvDFnrU",
  },
  {
    rank: 7,
    name: "Borussia Dortmund",
    aliases: ["Dortmund", "BVB"],
    shortName: "BVB",
    league: "bundesliga",
    played: 4,
    wins: 3,
    draws: 0,
    losses: 1,
    goalsFor: 13,
    goalsAgainst: 6,
    goalDifference: 7,
    points: 9,
    form: ["W", "W", "L", "W"],
    phase: "direct_round_16",
  },
  {
    rank: 8,
    name: "Aston Villa",
    aliases: ["Villa"],
    shortName: "AVL",
    league: "premier",
    played: 4,
    wins: 3,
    draws: 0,
    losses: 1,
    goalsFor: 6,
    goalsAgainst: 1,
    goalDifference: 5,
    points: 9,
    form: ["W", "W", "W", "L"],
    phase: "direct_round_16",
  },

  // 9-24: Qualification Playoffs (Dieciseisavos de Final)
  {
    rank: 9,
    name: "Atalanta",
    aliases: ["Atalanta BC"],
    shortName: "ATA",
    league: "seriea",
    played: 4,
    wins: 2,
    draws: 2,
    losses: 0,
    goalsFor: 5,
    goalsAgainst: 0,
    goalDifference: 5,
    points: 8,
    form: ["D", "W", "D", "W"],
    phase: "qualification_playoff",
  },
  {
    rank: 10,
    name: "Manchester City",
    aliases: ["Man City", "City"],
    shortName: "MCI",
    league: "premier",
    played: 4,
    wins: 2,
    draws: 1,
    losses: 1,
    goalsFor: 10,
    goalsAgainst: 4,
    goalDifference: 6,
    points: 7,
    form: ["D", "W", "W", "L"],
    phase: "qualification_playoff",
    crestUrl:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuB0A5-GaExMX0cNCouFyrxKzk5ScShdPQ6A26VEwd6Ni2YtaAp4jUVnSupHxD6m65qdlGGjKrgaIGmta2dx_ncybtv7O-dUDosyF9Qp3VWq3De15Y-MWZUsYgvgtcVVc098gP9C1lLBAwRl4poSTs8cdUlqfZsD4Vpuv-gwbS3DwSdylHf3Kho3fm-KkfaPF3ABN-vb-FsUo-__tFXY5jJMYlnSVa50NF6wixwlI71E",
  },
  {
    rank: 11,
    name: "Juventus",
    aliases: ["Juventus FC", "Juve"],
    shortName: "JUV",
    league: "seriea",
    played: 4,
    wins: 2,
    draws: 1,
    losses: 1,
    goalsFor: 7,
    goalsAgainst: 5,
    goalDifference: 2,
    points: 7,
    form: ["W", "W", "L", "D"],
    phase: "qualification_playoff",
  },
  {
    rank: 12,
    name: "Arsenal",
    aliases: ["Arsenal FC"],
    shortName: "ARS",
    league: "premier",
    played: 4,
    wins: 2,
    draws: 1,
    losses: 1,
    goalsFor: 3,
    goalsAgainst: 1,
    goalDifference: 2,
    points: 7,
    form: ["D", "W", "W", "L"],
    phase: "qualification_playoff",
  },
  {
    rank: 13,
    name: "Bayer Leverkusen",
    aliases: ["Leverkusen", "Bayer 04 Leverkusen"],
    shortName: "B04",
    league: "bundesliga",
    played: 4,
    wins: 2,
    draws: 1,
    losses: 1,
    goalsFor: 6,
    goalsAgainst: 5,
    goalDifference: 1,
    points: 7,
    form: ["W", "W", "D", "L"],
    phase: "qualification_playoff",
  },
  {
    rank: 14,
    name: "Lille",
    aliases: ["Lille OSC", "LOSC Lille"],
    shortName: "LIL",
    league: "ligue1",
    played: 4,
    wins: 2,
    draws: 1,
    losses: 1,
    goalsFor: 5,
    goalsAgainst: 4,
    goalDifference: 1,
    points: 7,
    form: ["L", "W", "W", "D"],
    phase: "qualification_playoff",
  },
  {
    rank: 15,
    name: "Celtic",
    aliases: ["Celtic FC"],
    shortName: "CEL",
    league: "scottish_premiership",
    played: 4,
    wins: 2,
    draws: 1,
    losses: 1,
    goalsFor: 9,
    goalsAgainst: 9,
    goalDifference: 0,
    points: 7,
    form: ["W", "L", "D", "W"],
    phase: "qualification_playoff",
  },
  {
    rank: 16,
    name: "Dinamo Zagreb",
    aliases: ["GNK Dinamo Zagreb"],
    shortName: "DZG",
    league: "hnl",
    played: 4,
    wins: 2,
    draws: 1,
    losses: 1,
    goalsFor: 10,
    goalsAgainst: 12,
    goalDifference: -2,
    points: 7,
    form: ["L", "D", "W", "W"],
    phase: "qualification_playoff",
  },
  {
    rank: 17,
    name: "Bayern Múnich",
    aliases: ["Bayern Munich", "FC Bayern München", "Bayern"],
    shortName: "BAY",
    league: "bundesliga",
    played: 4,
    wins: 2,
    draws: 0,
    losses: 2,
    goalsFor: 13,
    goalsAgainst: 7,
    goalDifference: 6,
    points: 6,
    form: ["W", "L", "L", "W"],
    phase: "qualification_playoff",
  },
  {
    rank: 18,
    name: "Real Madrid CF",
    aliases: ["Real Madrid", "Madrid"],
    shortName: "RMD",
    league: "laliga",
    played: 4,
    wins: 2,
    draws: 0,
    losses: 2,
    goalsFor: 9,
    goalsAgainst: 7,
    goalDifference: 2,
    points: 6,
    form: ["W", "L", "W", "L"],
    phase: "qualification_playoff",
    crestUrl:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuDIfxcvoBCPvtYy-GIQmSp-Dow-fMvM-g40ZpzX4LW3EprnYvecexSz2jZ1hVGp28kmIVJkIHlBM8OvL0j4qY9Cs-0CFUC6tQwDHoNE2IO7l6B71Slde3MdVfdsLdy4XJkQk7XfmRYoDdnLXb5m2gNvNOS5nxVqDMcu-xA0AzEU2_zM5a_jlavqxMZ5EsSn1iQHslWNjVLOP1Zm1OjeO5XGNT9eCQNvBNY1Qln8xFrU",
  },
  {
    rank: 19,
    name: "Benfica",
    aliases: ["SL Benfica"],
    shortName: "SLB",
    league: "primeira_liga",
    played: 4,
    wins: 2,
    draws: 0,
    losses: 2,
    goalsFor: 7,
    goalsAgainst: 5,
    goalDifference: 2,
    points: 6,
    form: ["W", "W", "L", "L"],
    phase: "qualification_playoff",
  },
  {
    rank: 20,
    name: "AC Milan",
    aliases: ["Milan"],
    shortName: "ACM",
    league: "seriea",
    played: 4,
    wins: 2,
    draws: 0,
    losses: 2,
    goalsFor: 7,
    goalsAgainst: 6,
    goalDifference: 1,
    points: 6,
    form: ["L", "L", "W", "W"],
    phase: "qualification_playoff",
  },
  {
    rank: 21,
    name: "Feyenoord",
    aliases: ["Feyenoord Rotterdam"],
    shortName: "FEY",
    league: "eredivisie",
    played: 4,
    wins: 2,
    draws: 0,
    losses: 2,
    goalsFor: 7,
    goalsAgainst: 10,
    goalDifference: -3,
    points: 6,
    form: ["L", "W", "W", "L"],
    phase: "qualification_playoff",
  },
  {
    rank: 22,
    name: "Club Brugge",
    aliases: ["Brujas", "Club Brugge KV"],
    shortName: "CLU",
    league: "pro_league",
    played: 4,
    wins: 2,
    draws: 0,
    losses: 2,
    goalsFor: 3,
    goalsAgainst: 6,
    goalDifference: -3,
    points: 6,
    form: ["L", "W", "L", "W"],
    phase: "qualification_playoff",
  },
  {
    rank: 23,
    name: "Atlético de Madrid",
    aliases: ["Atletico Madrid", "Atlético Madrid", "Atleti"],
    shortName: "ATM",
    league: "laliga",
    played: 4,
    wins: 2,
    draws: 0,
    losses: 2,
    goalsFor: 5,
    goalsAgainst: 9,
    goalDifference: -4,
    points: 6,
    form: ["W", "L", "L", "W"],
    phase: "qualification_playoff",
  },
  {
    rank: 24,
    name: "PSV Eindhoven",
    aliases: ["PSV"],
    shortName: "PSV",
    league: "eredivisie",
    played: 4,
    wins: 1,
    draws: 2,
    losses: 1,
    goalsFor: 7,
    goalsAgainst: 5,
    goalDifference: 2,
    points: 5,
    form: ["L", "D", "D", "W"],
    phase: "qualification_playoff",
  },

  // 25-36: Eliminated Zone (Zona de Eliminación)
  {
    rank: 25,
    name: "Paris Saint-Germain",
    aliases: ["PSG"],
    shortName: "PSG",
    league: "ligue1",
    played: 4,
    wins: 1,
    draws: 1,
    losses: 2,
    goalsFor: 3,
    goalsAgainst: 5,
    goalDifference: -2,
    points: 4,
    form: ["W", "L", "D", "L"],
    phase: "eliminated",
  },
  {
    rank: 26,
    name: "Sparta Praga",
    aliases: ["Sparta Prague", "AC Sparta Praha"],
    shortName: "SPA",
    league: "czech_liga",
    played: 4,
    wins: 1,
    draws: 1,
    losses: 2,
    goalsFor: 5,
    goalsAgainst: 8,
    goalDifference: -3,
    points: 4,
    form: ["W", "D", "L", "L"],
    phase: "eliminated",
  },
  {
    rank: 27,
    name: "VfB Stuttgart",
    aliases: ["Stuttgart"],
    shortName: "VFB",
    league: "bundesliga",
    played: 4,
    wins: 1,
    draws: 1,
    losses: 2,
    goalsFor: 3,
    goalsAgainst: 6,
    goalDifference: -3,
    points: 4,
    form: ["L", "D", "W", "L"],
    phase: "eliminated",
  },
  {
    rank: 28,
    name: "Shakhtar Donetsk",
    aliases: ["Shakhtar", "FC Shakhtar Donetsk"],
    shortName: "SHK",
    league: "premier_liga",
    played: 4,
    wins: 1,
    draws: 1,
    losses: 2,
    goalsFor: 2,
    goalsAgainst: 5,
    goalDifference: -3,
    points: 4,
    form: ["D", "L", "L", "W"],
    phase: "eliminated",
  },
  {
    rank: 29,
    name: "Girona FC",
    aliases: ["Girona"],
    shortName: "GIR",
    league: "laliga",
    played: 4,
    wins: 1,
    draws: 0,
    losses: 3,
    goalsFor: 4,
    goalsAgainst: 8,
    goalDifference: -4,
    points: 3,
    form: ["L", "L", "W", "L"],
    phase: "eliminated",
  },
  {
    rank: 30,
    name: "FC Salzburg",
    aliases: ["Red Bull Salzburg", "Salzburg"],
    shortName: "RBS",
    league: "austrian_bundesliga",
    played: 4,
    wins: 1,
    draws: 0,
    losses: 3,
    goalsFor: 3,
    goalsAgainst: 10,
    goalDifference: -7,
    points: 3,
    form: ["L", "L", "L", "W"],
    phase: "eliminated",
  },
  {
    rank: 31,
    name: "Bologna",
    aliases: ["Bologna FC 1909"],
    shortName: "BOS",
    league: "seriea",
    played: 4,
    wins: 0,
    draws: 1,
    losses: 3,
    goalsFor: 0,
    goalsAgainst: 5,
    goalDifference: -5,
    points: 1,
    form: ["D", "L", "L", "L"],
    phase: "eliminated",
  },
  {
    rank: 32,
    name: "RB Leipzig",
    aliases: ["Leipzig"],
    shortName: "RBL",
    league: "bundesliga",
    played: 4,
    wins: 0,
    draws: 0,
    losses: 4,
    goalsFor: 4,
    goalsAgainst: 9,
    goalDifference: -5,
    points: 0,
    form: ["L", "L", "L", "L"],
    phase: "eliminated",
  },
  {
    rank: 33,
    name: "Sturm Graz",
    aliases: ["SK Sturm Graz"],
    shortName: "STU",
    league: "austrian_bundesliga",
    played: 4,
    wins: 0,
    draws: 0,
    losses: 4,
    goalsFor: 1,
    goalsAgainst: 6,
    goalDifference: -5,
    points: 0,
    form: ["L", "L", "L", "L"],
    phase: "eliminated",
  },
  {
    rank: 34,
    name: "BSC Young Boys",
    aliases: ["Young Boys"],
    shortName: "YBO",
    league: "super_league",
    played: 4,
    wins: 0,
    draws: 0,
    losses: 4,
    goalsFor: 1,
    goalsAgainst: 11,
    goalDifference: -10,
    points: 0,
    form: ["L", "L", "L", "L"],
    phase: "eliminated",
  },
  {
    rank: 35,
    name: "Estrella Roja",
    aliases: ["Red Star Belgrade", "FK Crvena zvezda"],
    shortName: "RSB",
    league: "superliga_srb",
    played: 4,
    wins: 0,
    draws: 0,
    losses: 4,
    goalsFor: 4,
    goalsAgainst: 16,
    goalDifference: -12,
    points: 0,
    form: ["L", "L", "L", "L"],
    phase: "eliminated",
  },
  {
    rank: 36,
    name: "Slovan Bratislava",
    aliases: ["SK Slovan Bratislava"],
    shortName: "SLO",
    league: "super_liga_svk",
    played: 4,
    wins: 0,
    draws: 0,
    losses: 4,
    goalsFor: 2,
    goalsAgainst: 15,
    goalDifference: -13,
    points: 0,
    form: ["L", "L", "L", "L"],
    phase: "eliminated",
  },
];

/**
 * Returns structured UEFA Champions League League Phase standings (Round 4)
 * split cleanly into 3 official phases:
 * 1. Direct Round of 16 (Top 8)
 * 2. Qualification Playoffs (Positions 9-24)
 * 3. Eliminated Zone (Positions 25-36)
 */
export const getChampionsLeagueStandings = query({
  args: {},
  handler: async (ctx) => {
    const allTeams = await ctx.db.query("teams").collect();
    const uclTeams = allTeams.filter((t: any) => {
      return (
        t.league?.toLowerCase() === "ucl" ||
        t.competitions?.some((c: string) => c.toLowerCase() === "ucl") ||
        t.uclRank !== undefined
      );
    });

    // If Convex already has seeded UCL teams with uclRank, use them:
    const sorted = [...uclTeams].sort((a: any, b: any) => {
      const rankA = a.uclRank ?? 999;
      const rankB = b.uclRank ?? 999;
      return rankA - rankB;
    });

    const directRound16 = sorted.filter((t: any) => t.uclPhase === "direct_round_16" || (t.uclRank && t.uclRank <= 8));
    const qualificationPlayoffs = sorted.filter(
      (t: any) => t.uclPhase === "qualification_playoff" || (t.uclRank && t.uclRank >= 9 && t.uclRank <= 24)
    );
    const eliminated = sorted.filter((t: any) => t.uclPhase === "eliminated" || (t.uclRank && t.uclRank >= 25));

    return {
      round: 4,
      totalRounds: 8,
      totalTeams: sorted.length,
      isSeeded: sorted.some((t: any) => t.uclRank !== undefined),
      all: sorted,
      directRound16,
      qualificationPlayoffs,
      eliminated,
    };
  },
});

/**
 * Seeds or synchronizes the 36 Champions League clubs for Round 4.
 * Uses zero-duplication logic: matching existing teams by name/alias,
 * adding "ucl" to competitions, and setting their official UCL table metrics.
 */
export const seedChampionsLeagueRound4 = mutation({
  args: {},
  handler: async (ctx) => {
    // 1. Ensure UCL exists in leagues
    const uclLeague = await ctx.db
      .query("leagues")
      .withIndex("by_code", (q: any) => q.eq("code", "ucl"))
      .first();

    if (!uclLeague) {
      await ctx.db.insert("leagues", {
        code: "ucl",
        name: "Champions League",
        country: "Europa",
        isTournament: true,
      });
    }

    const allTeams = await ctx.db.query("teams").collect();

    let updatedCount = 0;
    let createdCount = 0;

    for (const seed of UCL_ROUND_4_DATA) {
      // Find matching existing team without duplicating
      const searchNames = [seed.name.toLowerCase(), ...(seed.aliases || []).map((a) => a.toLowerCase())];

      const existing = allTeams.find((t: any) => {
        const teamNameLower = t.name.toLowerCase().trim();
        if (seed.name === "Bayer Leverkusen" && teamNameLower.includes("bayern")) return false;
        if (seed.name === "Bayern Múnich" && (teamNameLower.includes("leverkusen") || !teamNameLower.includes("bayern"))) return false;

        const exactMatch = searchNames.some((sn) => teamNameLower === sn.trim());
        if (exactMatch) return true;

        if (t.shortName && t.shortName.toLowerCase() === seed.shortName.toLowerCase()) return true;

        return searchNames.some((sn) => {
          if (sn === "bayer" || sn === "bayern") return teamNameLower === sn;
          return teamNameLower.includes(sn) || sn.includes(teamNameLower);
        });
      });

      if (existing) {
        // Link to UCL without duplicating domestic league!
        const comps = new Set<string>(existing.competitions || [existing.league]);
        comps.add("ucl");

        await ctx.db.patch(existing._id, {
          competitions: Array.from(comps),
          uclRank: seed.rank,
          uclPoints: seed.points,
          uclPlayed: seed.played,
          uclWins: seed.wins,
          uclDraws: seed.draws,
          uclLosses: seed.losses,
          uclGoalsFor: seed.goalsFor,
          uclGoalsAgainst: seed.goalsAgainst,
          uclGoalDifference: seed.goalDifference,
          uclForm: seed.form,
          uclPhase: seed.phase,
          crestUrl: existing.crestUrl || seed.crestUrl,
        });
        updatedCount++;
      } else {
        // Insert new team
        await ctx.db.insert("teams", {
          name: seed.name,
          shortName: seed.shortName,
          league: seed.league,
          competitions: [seed.league, "ucl"],
          crestUrl: seed.crestUrl,
          formation: "4-3-3",
          uclRank: seed.rank,
          uclPoints: seed.points,
          uclPlayed: seed.played,
          uclWins: seed.wins,
          uclDraws: seed.draws,
          uclLosses: seed.losses,
          uclGoalsFor: seed.goalsFor,
          uclGoalsAgainst: seed.goalsAgainst,
          uclGoalDifference: seed.goalDifference,
          uclForm: seed.form,
          uclPhase: seed.phase,
        });
        createdCount++;
      }
    }

    return {
      success: true,
      updatedCount,
      createdCount,
      total: UCL_ROUND_4_DATA.length,
    };
  },
});
