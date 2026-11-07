/**
 * Lee una lista de resultados pegada (Sofascore, FlashScore, una tabla, un CSV…).
 *
 * Formatos que entiende (se pueden mezclar):
 *   2026-11-07 Valencia 1-2 Real Madrid
 *   07/11/2026  Valencia 1 - 2 Real Madrid      (también 07.11.2026, 07/11 o sin fecha)
 *   Valencia 1:2 Real Madrid
 *   fecha,local,visitante,gl,gv                   (CSV, con o sin cabecera; football-data también)
 *   Bloques de FlashScore/Sofascore: [fecha] / local / visitante / goles local / goles visitante
 */

export interface ParsedResult {
  date: string; // YYYY-MM-DD
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
}

const pad = (n: number | string) => String(n).padStart(2, "0");

/** Fecha en una línea → YYYY-MM-DD (el año sale de `fallbackYear` si falta). */
export function parseDate(s: string, fallbackYear: number): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = t.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\.?(?:\s|$|,)/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    let year = m[3] ? Number(m[3]) : fallbackYear;
    if (year < 100) year += 2000;
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  return null;
}

const DATE_PREFIX = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\.?)\s*(?:\d{1,2}:\d{2})?\s*/;
const ONE_LINE = /^(.+?)\s+(\d{1,2})\s*[-:–]\s*(\d{1,2})\s+(.+?)$/;
const NOISE = /^(ft|ht|final|finalizado|fin|terminado|ended|aet|pen|\d{1,2}:\d{2}|jornada.*|round.*|matchday.*|\(\d+\))$/i;

export function parseResults(text: string, defaultDate: string): { rows: ParsedResult[]; skipped: string[] } {
  const year = Number(defaultDate.slice(0, 4)) || new Date().getFullYear();
  const rows: ParsedResult[] = [];
  const skipped: string[] = [];
  let date = defaultDate;
  let names: string[] = [];
  let goals: number[] = [];
  let csvCols: { date: number; home: number; away: number; hg: number; ag: number } | null = null;

  const flushBlock = () => {
    if (names.length >= 2 && goals.length >= 2) {
      rows.push({ date, home: names[0], away: names[1], homeGoals: goals[0], awayGoals: goals[1] });
    } else if (names.length || goals.length) {
      skipped.push([...names, ...goals].join(" / "));
    }
    names = [];
    goals = [];
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/ /g, " ").trim();
    if (!line) continue;

    // CSV / tabla con separadores
    const cells = line.includes(",") || line.includes(";") || line.includes("\t") ? line.split(/[,;\t]/).map((c) => c.trim()) : null;
    if (cells && cells.length >= 5) {
      const lower = cells.map((c) => c.toLowerCase());
      const idx = (...names: string[]) => lower.findIndex((c) => names.includes(c));
      if (idx("hometeam", "local", "home") >= 0) {
        csvCols = {
          date: idx("date", "fecha"),
          home: idx("hometeam", "local", "home"),
          away: idx("awayteam", "visitante", "away"),
          hg: idx("fthg", "gl", "goles local", "homegoals", "hg"),
          ag: idx("ftag", "gv", "goles visitante", "awaygoals", "ag"),
        };
        continue;
      }
      const c = csvCols ?? { date: 0, home: 1, away: 2, hg: 3, ag: 4 };
      const d = c.date >= 0 ? parseDate(cells[c.date] ?? "", year) : date;
      const hg = Number(cells[c.hg]);
      const ag = Number(cells[c.ag]);
      if (d && cells[c.home] && cells[c.away] && Number.isInteger(hg) && Number.isInteger(ag) && cells[c.hg] !== "" && cells[c.ag] !== "") {
        rows.push({ date: d, home: cells[c.home], away: cells[c.away], homeGoals: hg, awayGoals: ag });
      } else skipped.push(line);
      continue;
    }

    // Fecha al principio de la línea (sola o seguida de un resultado)
    let rest = line;
    const dm = line.match(DATE_PREFIX);
    if (dm) {
      const d = parseDate(dm[1] + " ", year);
      if (d) {
        flushBlock();
        date = d;
        rest = line.slice(dm[0].length).trim();
        if (!rest) continue;
      }
    }

    const one = rest.match(ONE_LINE);
    if (one && !/^\d+$/.test(one[1]) && !/^\d+$/.test(one[4])) {
      flushBlock();
      rows.push({ date, home: one[1].trim(), away: one[4].trim(), homeGoals: Number(one[2]), awayGoals: Number(one[3]) });
      continue;
    }

    if (NOISE.test(rest)) continue;
    if (/^\d{1,2}$/.test(rest)) {
      goals.push(Number(rest));
      if (names.length >= 2 && goals.length === 2) flushBlock();
      continue;
    }
    // Nombre de equipo (bloques de varias líneas)
    if (names.length >= 2) flushBlock();
    names.push(rest);
  }
  flushBlock();
  return { rows, skipped };
}

export interface ParsedFixture {
  date: string;
  home: string;
  away: string;
}

/**
 * Próximos partidos pegados (sin marcador):
 *   2026-11-25 Real Madrid - Liverpool
 *   25/11 21:00 Inter vs Barcelona
 *   Bloques: [fecha] / local / visitante   (FlashScore, Sofascore)
 */
export function parseFixtures(text: string, defaultDate: string): { rows: ParsedFixture[]; skipped: string[] } {
  const year = Number(defaultDate.slice(0, 4)) || new Date().getFullYear();
  const rows: ParsedFixture[] = [];
  const skipped: string[] = [];
  let date = defaultDate;
  let names: string[] = [];
  const flush = () => {
    if (names.length === 1) skipped.push(names[0]);
    names = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/ /g, " ").trim();
    if (!line) continue;
    let rest = line;
    const dm = line.match(DATE_PREFIX);
    if (dm) {
      const d = parseDate(dm[1] + " ", year);
      if (d) {
        flush();
        date = d;
        rest = line.slice(dm[0].length).trim();
        if (!rest) continue;
      }
    }
    if (NOISE.test(rest) || /^\d{1,2}$/.test(rest) || /^-$/.test(rest)) continue;
    const one = rest.match(/^(.+?)\s+(?:-|–|vs\.?|v)\s+(.+)$/i);
    if (one && !/\d+\s*[-:–]\s*\d+/.test(rest)) {
      flush();
      rows.push({ date, home: one[1].trim(), away: one[2].trim() });
      continue;
    }
    names.push(rest);
    if (names.length === 2) {
      rows.push({ date, home: names[0], away: names[1] });
      names = [];
    }
  }
  flush();
  return { rows, skipped };
}
