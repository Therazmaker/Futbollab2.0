import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { GenericDatabaseWriter } from "convex/server";
import type { DataModel } from "./_generated/dataModel";
import { recomputeLeague } from "./lib/leagueTable";
import { refreshRatingModel } from "./lib/ratingStore";
import { currentSeason } from "./lib/season";
import { ensureSnapshotBeforeScore, upsertSnapshot } from "./lib/radarSnapshot";
import legacyLeagues from "../data/legacy/leagues.json";
import legacyTeams from "../data/legacy/teams.json";
import legacyMatches from "../data/legacy/matches.json";
import legacyPlayers from "../data/legacy/players.json";
import fdTeams from "../data/legacy/fd_teams.json";
import fdMatches from "../data/legacy/fd_matches.json";

// football-data.co.uk (scripts/legacy/build_footballdata.py): 5 ligas desde 2023-24
// hasta la jornada más reciente, con tiros, xG y cuotas de cierre. Los partidos
// que ya estaban en el histórico viejo llevan su mismo legacyId: se enriquecen.
type TeamRow = { legacyId: string; name: string; league: string; mergedLegacyIds?: string[]; aliases?: string[] };
type MatchRow = {
  legacyId: string;
  league: string;
  date: string;
  homeLegacyId: string;
  awayLegacyId: string;
  homeGoals: number;
  awayGoals: number;
  stats?: { hs: number; as: number; hst: number; ast: number; hxg?: number; axg?: number };
  halfTime?: { home: number; away: number };
  cards?: { hy: number; ay: number; hr: number; ar: number };
  closingOdds?: { home: number; draw: number; away: number; over25?: number; under25?: number };
};
const ALL_TEAMS: TeamRow[] = [...legacyTeams, ...(fdTeams as TeamRow[])];
const ALL_MATCHES: MatchRow[] = Array.from(
  new Map<string, MatchRow>([...(legacyMatches as MatchRow[]), ...(fdMatches as MatchRow[])].map((m) => [m.legacyId, m])).values()
);
const WITH_STATS = ALL_MATCHES.filter((m) => m.stats).length;
const TEAM_NAME = new Map(ALL_TEAMS.map((t) => [t.legacyId, t.name]));

/**
 * Importa el histórico del FutbolLab viejo (data/legacy/*.json, generado con
 * scripts/legacy/build_legacy_data.py): 4 ligas, 76 equipos, 1.324 partidos
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

/**
 * El histórico tenía equipos duplicados ("Napoli" y "Nápoles", dos "Aston Villa"...).
 * Si una importación anterior los creó por separado, se fusionan: partidos,
 * jugadores y referencias pasan al equipo bueno y el duplicado se borra.
 */
async function mergeDuplicates(db: Db, keepLegacyId: string, dupLegacyIds: string[]) {
  if (!dupLegacyIds.length) return 0;
  const dups = [];
  for (const id of dupLegacyIds) {
    const d = await teamByLegacyId(db, id);
    if (d) dups.push(d);
  }
  if (!dups.length) return 0;
  let keep = await teamByLegacyId(db, keepLegacyId);
  if (!keep) {
    // El bueno no existe todavía: el primer duplicado pasa a ser el bueno
    await db.patch(dups[0]._id, { legacyId: keepLegacyId });
    keep = (await db.get(dups[0]._id))!;
    dups.shift();
  }
  for (const d of dups) {
    const leagueMatches = await db
      .query("matches")
      .withIndex("by_league_and_date", (q) => q.eq("league", d.league))
      .collect();
    for (const m of leagueMatches) {
      if (m.homeTeamId === d._id) await db.patch(m._id, { homeTeamId: keep._id });
      if (m.awayTeamId === d._id) await db.patch(m._id, { awayTeamId: keep._id });
    }
    const players = await db
      .query("players")
      .withIndex("by_team", (q) => q.eq("teamId", d._id))
      .collect();
    for (const p of players) await db.patch(p._id, { teamId: keep._id });
    const logs = await db
      .query("playerMatchLogs")
      .filter((q) => q.eq(q.field("opponentTeamId"), d._id))
      .collect();
    for (const l of logs) await db.patch(l._id, { opponentTeamId: keep._id });
    await db.delete(d._id);
  }
  return dups.length;
}

export const importTeamsChunk = internalMutation({
  args: {
    teams: v.array(
      v.object({
        legacyId: v.string(),
        name: v.string(),
        league: v.string(),
        mergedLegacyIds: v.optional(v.array(v.string())),
        aliases: v.optional(v.array(v.string())),
      })
    ),
  },
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
    let merged = 0;
    for (const t of teams) {
      merged += await mergeDuplicates(ctx.db, t.legacyId, t.mergedLegacyIds ?? []);
      if (await teamByLegacyId(ctx.db, t.legacyId)) continue;
      // ¿Ya existe con otro nombre parecido (p.ej. "Inter" vs "Inter de Milán")?
      const key = canonical(t.name);
      const keys = new Set([key, ...(t.aliases ?? []).map(canonical)]);
      // Primero nombre exacto (o alias); si no, "empieza por" solo con el nombre principal
      const match =
        all.find((x) => !x.legacyId && keys.has(canonical(x.name))) ??
        all.find(
          (x) => !x.legacyId && (canonical(x.name).startsWith(key + " ") || key.startsWith(canonical(x.name) + " "))
        );
      if (match) {
        const comps = Array.from(new Set((match.competitions ?? [match.league]).concat(t.league)));
        // Un equipo creado solo para la Champions pasa a tener su liga doméstica
        const league = match.league === "intl" ? t.league : match.league;
        await ctx.db.patch(match._id, { legacyId: t.legacyId, competitions: comps, league });
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
    return { created, linked, merged };
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
        stats: v.optional(
          v.object({ hs: v.number(), as: v.number(), hst: v.number(), ast: v.number(), hxg: v.optional(v.number()), axg: v.optional(v.number()) })
        ),
        closingOdds: v.optional(
          v.object({ home: v.number(), draw: v.number(), away: v.number(), over25: v.optional(v.number()), under25: v.optional(v.number()) })
        ),
        halfTime: v.optional(v.object({ home: v.number(), away: v.number() })),
        cards: v.optional(v.object({ hy: v.number(), ay: v.number(), hr: v.number(), ar: v.number() })),
      })
    ),
  },
  handler: async (ctx, { matches }) => {
    let inserted = 0;
    let skipped = 0;
    let enriched = 0;
    let noTeam = 0;
    const missingTeams = new Set<string>();
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
      const extra = {
        ...(m.stats ? { stats: m.stats } : {}),
        ...(m.closingOdds ? { closingOdds: m.closingOdds } : {}),
        ...(m.halfTime ? { halfTime: m.halfTime } : {}),
        ...(m.cards ? { cards: m.cards } : {}),
      };
      if (exists) {
        // Ya importado: solo se le añaden las estadísticas si le faltan
        if ((m.stats && !exists.stats) || (m.closingOdds && !exists.closingOdds) || (m.halfTime && !exists.halfTime) || (m.cards && !exists.cards)) {
          await ctx.db.patch(exists._id, extra);
          enriched++;
        } else skipped++;
        continue;
      }
      if (!home || !away) {
        skipped++;
        if (!home) missingTeams.add(m.homeLegacyId);
        if (!away) missingTeams.add(m.awayLegacyId);
        noTeam++;
        continue;
      }
      // ¿Ya lo registraste a mano (mismo cruce, ±1 día)? Se enlaza en vez de duplicarlo.
      const day = 86_400_000;
      const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
      const t0 = Date.parse(m.date);
      const manual = (
        await ctx.db
          .query("matches")
          .withIndex("by_home_and_date", (q) => q.eq("homeTeamId", home).gte("date", iso(t0 - day)).lte("date", iso(t0 + day)))
          .collect()
      ).find((x) => x.awayTeamId === away && !x.legacyId);
      if (manual) {
        const noScore = manual.homeGoals === undefined || manual.awayGoals === undefined;
        // Partido que programaste: foto previa del Radar antes de ponerle el marcador
        if (noScore) await ensureSnapshotBeforeScore(ctx.db, manual._id);
        await ctx.db.patch(manual._id, {
          legacyId: m.legacyId,
          league: m.league,
          ...extra,
          ...(noScore ? { homeGoals: m.homeGoals, awayGoals: m.awayGoals } : {}),
        });
        inserted++;
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
        ...extra,
      });
      inserted++;
    }
    return { inserted, skipped, enriched, noTeam, missingTeams: Array.from(missingTeams) };
  },
});

/**
 * Próximos partidos (fixtures.csv de football-data): los crea sin marcador, o
 * reutiliza el que ya exista (mismo cruce, ±1 día). Pone la cuota media solo si
 * no tienes cuotas tuyas, y toma la foto previa del Radar.
 */
export const scheduleFixturesChunk = internalMutation({
  args: {
    fixtures: v.array(
      v.object({
        league: v.string(),
        date: v.string(),
        homeLegacyId: v.string(),
        awayLegacyId: v.string(),
        odds: v.optional(v.object({ home: v.number(), draw: v.number(), away: v.number() })),
      })
    ),
  },
  handler: async (ctx, { fixtures }) => {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const day = 86_400_000;
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
    for (const f of fixtures) {
      const home = await teamByLegacyId(ctx.db, f.homeLegacyId);
      const away = await teamByLegacyId(ctx.db, f.awayLegacyId);
      if (!home || !away) {
        skipped++;
        continue;
      }
      const t0 = Date.parse(f.date);
      const existing = (
        await ctx.db
          .query("matches")
          .withIndex("by_home_and_date", (q) => q.eq("homeTeamId", home._id).gte("date", iso(t0 - day)).lte("date", iso(t0 + day)))
          .collect()
      ).find((x) => x.awayTeamId === away._id);
      const odds = f.odds ? { ...f.odds, updatedAt: Date.now(), source: "football-data" } : undefined;
      if (existing) {
        if (existing.homeGoals !== undefined) {
          skipped++;
          continue;
        }
        // Solo se rellenan las cuotas si no hay o si las anteriores también eran de football-data
        if (odds && (!existing.odds || existing.odds.source === "football-data")) {
          await ctx.db.patch(existing._id, { odds });
          await upsertSnapshot(ctx.db, existing._id);
          updated++;
        } else skipped++;
        continue;
      }
      const id = await ctx.db.insert("matches", {
        league: f.league,
        date: f.date,
        homeTeamId: home._id,
        awayTeamId: away._id,
        ...(odds ? { odds } : {}),
      });
      await upsertSnapshot(ctx.db, id);
      created++;
    }
    return { created, updated, skipped };
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
      .take(ALL_MATCHES.length * 2);
    // ¿Quedan equipos duplicados de una importación anterior?
    let duplicateTeams = 0;
    for (const t of ALL_TEAMS) {
      for (const id of t.mergedLegacyIds ?? []) {
        const dup = await ctx.db
          .query("teams")
          .withIndex("by_legacyId", (q) => q.eq("legacyId", id))
          .first();
        if (dup) duplicateTeams++;
      }
    }
    const withStats = imported.filter((m) => m.stats).length;
    // Diagnóstico: qué partidos faltan o siguen sin estadísticas, y por qué
    const byId = new Map(imported.map((m) => [m.legacyId as string, m]));
    const missingRows = ALL_MATCHES.filter((m) => !byId.has(m.legacyId));
    // Sin estadísticas o sin tarjetas (las tarjetas llegaron después: se completan al importar de nuevo)
    const noStatsRows = ALL_MATCHES.filter(
      (m) => byId.has(m.legacyId) && ((m.stats && !byId.get(m.legacyId)!.stats) || (m.cards && !byId.get(m.legacyId)!.cards))
    );
    const teamExists = new Map<string, boolean>();
    const exists = async (id: string) => {
      if (!teamExists.has(id)) {
        teamExists.set(id, !!(await ctx.db.query("teams").withIndex("by_legacyId", (q) => q.eq("legacyId", id)).first()));
      }
      return teamExists.get(id)!;
    };
    const missingTeams = new Set<string>();
    for (const m of missingRows.slice(0, 400)) {
      if (!(await exists(m.homeLegacyId))) missingTeams.add(TEAM_NAME.get(m.homeLegacyId) ?? m.homeLegacyId);
      if (!(await exists(m.awayLegacyId))) missingTeams.add(TEAM_NAME.get(m.awayLegacyId) ?? m.awayLegacyId);
    }
    const sample = (rows: MatchRow[]) =>
      rows.slice(0, 3).map((m) => `${m.date} ${TEAM_NAME.get(m.homeLegacyId) ?? m.homeLegacyId} - ${TEAM_NAME.get(m.awayLegacyId) ?? m.awayLegacyId}`);
    return {
      missingMatches: missingRows.length,
      missingSample: sample(missingRows),
      missingTeams: Array.from(missingTeams).slice(0, 10),
      statsPending: noStatsRows.length,
      statsPendingSample: sample(noStatsRows),
      importedMatches: imported.length,
      availableMatches: ALL_MATCHES.length,
      matchesWithStats: withStats,
      availableWithStats: WITH_STATS,
      duplicateTeams,
      needsImport: missingRows.length > 0 || noStatsRows.length > 0 || duplicateTeams > 0,
    };
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
    const report = {
      teamsCreated: 0, teamsLinked: 0, teamsMerged: 0, matches: 0, enriched: 0, players: 0, leagues: legacyLeagues.length,
      skippedNoTeam: 0, missingTeams: [] as string[],
    };
    const missing = new Set<string>();
    for (const part of chunks(ALL_TEAMS, 100)) {
      const r = await ctx.runMutation(internal.legacy.importTeamsChunk, { teams: part });
      report.teamsCreated += r.created;
      report.teamsLinked += r.linked;
      report.teamsMerged += r.merged;
    }
    for (const part of chunks(ALL_MATCHES, 200)) {
      const r = await ctx.runMutation(internal.legacy.importMatchesChunk, { matches: part });
      report.matches += r.inserted;
      report.enriched += r.enriched;
      report.skippedNoTeam += r.noTeam;
      r.missingTeams.forEach((x) => missing.add(x));
    }
    for (const part of chunks(legacyPlayers, 150)) {
      const r = await ctx.runMutation(internal.legacy.importPlayersChunk, { players: part });
      report.players += r.inserted;
    }
    for (const code of Array.from(new Set(ALL_MATCHES.map((m) => m.league)))) {
      await ctx.runMutation(internal.legacy.recomputeTeamStrengthInternal, { league: code });
    }
    await ctx.runMutation(internal.legacy.refreshRatingModelInternal, {});
    report.missingTeams = Array.from(missing).map((id) => TEAM_NAME.get(id) ?? id);
    return report;
  },
});

export const refreshRatingModelInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    await refreshRatingModel(ctx.db);
    return null;
  },
});

/** ¿Hay ligas cuya tabla no está calculada para la temporada actual? */
export const seasonStatus = query({
  args: {},
  handler: async (ctx) => {
    const season = currentSeason();
    const leagues = await ctx.db.query("leagues").collect();
    const stale = [];
    for (const lg of leagues) {
      const anyMatch = await ctx.db
        .query("matches")
        .withIndex("by_league_and_date", (q) => q.eq("league", lg.code))
        .first();
      // La UCL también, aunque no tenga partidos: así se limpian datos sembrados a mano
      if ((anyMatch || lg.code === "ucl") && lg.currentSeason !== season) stale.push(lg.code);
    }
    return { season, staleLeagues: stale };
  },
});

/** Recalcula todas las ligas para la temporada actual y re-entrena el modelo de nota. */
export const recomputeSeason = mutation({
  args: {},
  handler: async (ctx) => {
    const leagues = await ctx.db.query("leagues").collect();
    let matches = 0;
    for (const lg of leagues) matches += await recomputeLeague(ctx.db, lg.code);
    await refreshRatingModel(ctx.db);
    return { season: currentSeason(), leagues: leagues.length, matches };
  },
});
