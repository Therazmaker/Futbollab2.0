import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { GenericDatabaseWriter } from "convex/server";
import type { DataModel } from "./_generated/dataModel";
import { fitTeamRatings, standings } from "./lib/teamRatings";
import legacyLeagues from "../data/legacy/leagues.json";
import legacyTeams from "../data/legacy/teams.json";
import legacyMatches from "../data/legacy/matches.json";
import legacyPlayers from "../data/legacy/players.json";

/**
 * Importa el histórico del FutbolLab viejo (data/legacy/*.json, generado con
 * scripts/legacy/build_legacy_data.py): 4 ligas, 79 equipos, 1.330 partidos
 * y 1.014 jugadores con sus totales de temporada.
 *
 * Es idempotente: cada fila lleva `legacyId`, así que repetirlo no duplica nada.
 * Al terminar recalcula tablas (puntos, DG, forma) y la fuerza ataque/defensa
 * de cada equipo, que el motor de jugadores usa como contexto del rival.
 */

const LEAGUE_META: Record<string, { name: string; country: string }> = {
  seriea: { name: "Serie A", country: "Italia" },
  premier: { name: "Premier League", country: "Inglaterra" },
  bundesliga: { name: "Bundesliga", country: "Alemania" },
  ligue1: { name: "Ligue 1", country: "Francia" },
  laliga: { name: "LaLiga", country: "España" },
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(fc|cf|ac|as|ss|ssc|afc|sc|de|club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
// Nombres que en la app nueva están escritos distinto
const ALIASES: Record<string, string> = { "inter milan": "inter", napoli: "napoles" };
const canonical = (s: string) => {
  const n = norm(s);
  return ALIASES[n] ?? n;
};

type Db = GenericDatabaseWriter<DataModel>;

async function teamByLegacyId(db: Db, legacyId: string) {
  return await db
    .query("teams")
    .withIndex("by_legacyId", (q) => q.eq("legacyId", legacyId))
    .first();
}

export const importTeamsChunk = internalMutation({
  args: { teams: v.array(v.object({ legacyId: v.string(), name: v.string(), league: v.string() })) },
  handler: async (ctx, { teams }) => {
    for (const code of Array.from(new Set(teams.map((t) => t.league)))) {
      const exists = await ctx.db
        .query("leagues")
        .withIndex("by_code", (q) => q.eq("code", code))
        .first();
      if (!exists) {
        const meta = LEAGUE_META[code] ?? { name: code, country: "" };
        await ctx.db.insert("leagues", { code, name: meta.name, country: meta.country, isTournament: false });
      }
    }
    const all = await ctx.db.query("teams").collect();
    let created = 0;
    let linked = 0;
    for (const t of teams) {
      if (await teamByLegacyId(ctx.db, t.legacyId)) continue;
      // ¿Ya existe con otro nombre parecido (p.ej. "Inter" vs "Inter de Milán")?
      const key = canonical(t.name);
      const match = all.find(
        (x) => !x.legacyId && (canonical(x.name) === key || canonical(x.name).startsWith(key + " ") || key.startsWith(canonical(x.name) + " "))
      );
      if (match) {
        const comps = Array.from(new Set((match.competitions ?? [match.league]).concat(t.league)));
        await ctx.db.patch(match._id, { legacyId: t.legacyId, competitions: comps });
        match.legacyId = t.legacyId; // que otro equipo del lote no se enlace al mismo
        linked++;
      } else {
        await ctx.db.insert("teams", {
          legacyId: t.legacyId,
          name: t.name,
          shortName: t.name.replace(/[^A-Za-zÀ-ÿ]/g, "").slice(0, 3).toUpperCase(),
          league: t.league,
          competitions: [t.league],
        });
        created++;
      }
    }
    return { created, linked };
  },
});

export const importMatchesChunk = internalMutation({
  args: {
    matches: v.array(
      v.object({
        legacyId: v.string(),
        league: v.string(),
        date: v.string(),
        homeLegacyId: v.string(),
        awayLegacyId: v.string(),
        homeGoals: v.number(),
        awayGoals: v.number(),
      })
    ),
  },
  handler: async (ctx, { matches }) => {
    let inserted = 0;
    let skipped = 0;
    const cache = new Map<string, Id<"teams"> | null>();
    const resolve = async (legacyId: string) => {
      if (!cache.has(legacyId)) cache.set(legacyId, (await teamByLegacyId(ctx.db, legacyId))?._id ?? null);
      return cache.get(legacyId)!;
    };
    for (const m of matches) {
      const exists = await ctx.db
        .query("matches")
        .withIndex("by_legacyId", (q) => q.eq("legacyId", m.legacyId))
        .first();
      const home = await resolve(m.homeLegacyId);
      const away = await resolve(m.awayLegacyId);
      if (exists || !home || !away) {
        skipped++;
        continue;
      }
      await ctx.db.insert("matches", {
        legacyId: m.legacyId,
        league: m.league,
        date: m.date,
        homeTeamId: home,
        awayTeamId: away,
        homeGoals: m.homeGoals,
        awayGoals: m.awayGoals,
      });
      inserted++;
    }
    return { inserted, skipped };
  },
});

const seasonStatsValidator = v.optional(
  v.object({
    appearances: v.optional(v.number()),
    minutes: v.optional(v.number()),
    goals: v.optional(v.number()),
    assists: v.optional(v.number()),
    yellowCards: v.optional(v.number()),
    redCards: v.optional(v.number()),
  })
);

export const importPlayersChunk = internalMutation({
  args: {
    players: v.array(
      v.object({
        legacyId: v.string(),
        teamLegacyId: v.string(),
        name: v.string(),
        position: v.string(),
        age: v.optional(v.number()),
        number: v.optional(v.number()),
        seasonStats: seasonStatsValidator,
      })
    ),
  },
  handler: async (ctx, { players }) => {
    let inserted = 0;
    let skipped = 0;
    for (const p of players) {
      const exists = await ctx.db
        .query("players")
        .withIndex("by_legacyId", (q) => q.eq("legacyId", p.legacyId))
        .first();
      const team = await teamByLegacyId(ctx.db, p.teamLegacyId);
      if (exists || !team) {
        skipped++;
        continue;
      }
      const { teamLegacyId, ...rest } = p;
      await ctx.db.insert("players", { ...rest, teamId: team._id });
      inserted++;
    }
    return { inserted, skipped };
  },
});

async function recomputeLeague(db: Db, league: string) {
  const rows = await db
    .query("matches")
    .withIndex("by_league_and_date", (q) => q.eq("league", league))
    .collect();
  if (!rows.length) return 0;
  const results = rows.map((r) => ({
    home: r.homeTeamId as string,
    away: r.awayTeamId as string,
    homeGoals: r.homeGoals,
    awayGoals: r.awayGoals,
    date: r.date,
  }));
  const { ratings } = fitTeamRatings(results);
  for (const row of standings(results)) {
    const rating = ratings.get(row.team);
    await db.patch(row.team as Id<"teams">, {
      rank: row.rank,
      points: row.points,
      played: row.played,
      goalsFor: row.gf,
      goalsAgainst: row.ga,
      goalDifference: row.gf - row.ga,
      form: row.form,
      attackRating: rating ? +rating.attack.toFixed(3) : undefined,
      defenseRating: rating ? +rating.defense.toFixed(3) : undefined,
    });
  }
  return rows.length;
}

/** Recalcula tablas y fuerza de equipos (llámalo tras añadir resultados). */
export const recomputeTeamStrength = mutation({
  args: { league: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const leagues = args.league ? [args.league] : (await ctx.db.query("leagues").collect()).map((l) => l.code);
    const out: Record<string, number> = {};
    for (const code of leagues) out[code] = await recomputeLeague(ctx.db, code);
    return out;
  },
});

export const recomputeTeamStrengthInternal = internalMutation({
  args: { league: v.string() },
  handler: async (ctx, { league }) => recomputeLeague(ctx.db, league),
});

export const legacyStatus = query({
  args: {},
  handler: async (ctx) => {
    const imported = await ctx.db
      .query("matches")
      .withIndex("by_legacyId", (q) => q.gt("legacyId", ""))
      .take(legacyMatches.length + 1);
    return { importedMatches: imported.length, availableMatches: legacyMatches.length };
  },
});

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Botón "Importar histórico": trae todo y recalcula. Seguro de repetir. */
export const importLegacyData = action({
  args: {},
  handler: async (ctx) => {
    const report = { teamsCreated: 0, teamsLinked: 0, matches: 0, players: 0, leagues: legacyLeagues.length };
    for (const part of chunks(legacyTeams, 100)) {
      const r = await ctx.runMutation(internal.legacy.importTeamsChunk, { teams: part });
      report.teamsCreated += r.created;
      report.teamsLinked += r.linked;
    }
    for (const part of chunks(legacyMatches, 200)) {
      const r = await ctx.runMutation(internal.legacy.importMatchesChunk, { matches: part });
      report.matches += r.inserted;
    }
    for (const part of chunks(legacyPlayers, 150)) {
      const r = await ctx.runMutation(internal.legacy.importPlayersChunk, { players: part });
      report.players += r.inserted;
    }
    for (const code of Array.from(new Set(legacyMatches.map((m) => m.league)))) {
      await ctx.runMutation(internal.legacy.recomputeTeamStrengthInternal, { league: code });
    }
    return report;
  },
});
