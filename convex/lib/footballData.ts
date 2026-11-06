import fdNames from "../../data/legacy/fd_names.json";

/** Ligas de football-data.co.uk → código de la app */
export const DIVS: Record<string, string> = { SP1: "laliga", E0: "premier", I1: "seriea", D1: "bundesliga", F1: "ligue1" };
const NAMES = fdNames as Record<string, Record<string, string>>;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(fc|cf|ac|as|ss|ssc|afc|sc|de|club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export const fdSlug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export type FdRow = {
  legacyId: string;
  league: string;
  date: string;
  homeLegacyId: string;
  awayLegacyId: string;
  homeGoals: number;
  awayGoals: number;
  stats?: { hs: number; as: number; hst: number; ast: number; hxg?: number; axg?: number };
  closingOdds?: { home: number; draw: number; away: number; over25?: number; under25?: number };
};

/** CSV de football-data → filas listas para importar (puro, para poder probarlo). */
export function parseFootballDataCsv(text: string, div: string, seasonCode: string) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0]?.split(",") ?? [];
  const ix = (k: string) => head.indexOf(k);
  const rows: FdRow[] = [];
  const unknown = new Set<string>();
  const names = NAMES[div] ?? {};
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    const g = (k: string) => (ix(k) >= 0 ? (c[ix(k)] ?? "").trim() : "");
    const num = (k: string) => (g(k) === "" ? undefined : Number(g(k)));
    const home = g("HomeTeam");
    const away = g("AwayTeam");
    if (!home || !away || g("FTHG") === "" || g("FTAG") === "") continue;
    const h = names[home];
    const a = names[away];
    if (!h) unknown.add(home);
    if (!a) unknown.add(away);
    if (!h || !a) continue;
    const [dd, mm, yy] = g("Date").split("/");
    const date = `${yy.length === 2 ? "20" + yy : yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    const row: FdRow = {
      legacyId: `${div.toLowerCase()}_${seasonCode}_${date}_${fdSlug(home)}_${fdSlug(away)}`,
      league: DIVS[div],
      date,
      homeLegacyId: h,
      awayLegacyId: a,
      homeGoals: Number(g("FTHG")),
      awayGoals: Number(g("FTAG")),
    };
    const [hs, as, hst, ast] = [num("HS"), num("AS"), num("HST"), num("AST")];
    if ([hs, as, hst, ast].every((x) => x !== undefined && Number.isFinite(x))) {
      row.stats = { hs: hs!, as: as!, hst: hst!, ast: ast! };
      const [hxg, axg] = [num("HxG"), num("AxG")];
      if (hxg !== undefined && axg !== undefined && Number.isFinite(hxg) && Number.isFinite(axg)) Object.assign(row.stats, { hxg, axg });
    }
    const [ch, cd, ca, o25, u25] = [num("AvgCH"), num("AvgCD"), num("AvgCA"), num("AvgC>2.5"), num("AvgC<2.5")];
    if (ch! > 1 && cd! > 1 && ca! > 1) {
      row.closingOdds = { home: ch!, draw: cd!, away: ca!, ...(o25! > 1 ? { over25: o25! } : {}), ...(u25! > 1 ? { under25: u25! } : {}) };
    }
    rows.push(row);
  }
  return { rows, unknown: Array.from(unknown) };
}

