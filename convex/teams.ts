import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

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

    return await ctx.db.insert("teams", {
      name: args.name,
      shortName: args.shortName || args.name.slice(0, 3).toUpperCase(),
      league: args.league.toLowerCase(),
      competitions: Array.from(comps),
      crestUrl: args.crestUrl,
      rank: args.rank ?? 1,
      points: args.points ?? 0,
      goalDifference: args.goalDifference ?? 0,
      formation: args.formation ?? "4-3-3",
      meanXg: args.meanXg ?? 2.1,
      ppda: args.ppda ?? 8.5,
      tempo: args.tempo ?? "18.0 m/s",
      form: args.form ?? ["W", "W", "D", "W", "W"],
      density: args.density ?? 92.0,
      predAccuracy: args.predAccuracy ?? 94.0,
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
