/**
 * Fuerza de ataque/defensa de cada equipo a partir de resultados (Poisson tipo
 * Dixon-Coles con decaimiento temporal y prior). 1.0 = media de su liga.
 *   goles_local ~ Poisson(media · local · ataque_L · defensa_V)
 * defensa > 1 significa que el equipo CONCEDE más que la media.
 *
 * En un backtest walk-forward con 1.083 partidos del FutbolLab viejo, este modelo
 * dio log-loss 1.012 frente a 1.060 del motor anterior y 1.177 de "últimos 5".
 */

export interface ResultRow {
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  date: string; // YYYY-MM-DD
}

export interface TeamRating {
  attack: number;
  defense: number;
}

const DAY = 86_400_000;

export function fitTeamRatings(rows: ResultRow[], opts: { now?: number; xi?: number; prior?: number } = {}) {
  const now = opts.now ?? Math.max(...rows.map((r) => Date.parse(r.date) || 0));
  const xi = opts.xi ?? 0.004; // vida media ≈ 170 días
  const PRIOR = opts.prior ?? 8; // "partidos fantasma" en la media (8: mejor validado que 3)
  const teams = new Set<string>();
  rows.forEach((r) => {
    teams.add(r.home);
    teams.add(r.away);
  });
  const att = new Map<string, number>();
  const def = new Map<string, number>();
  teams.forEach((t) => {
    att.set(t, 1);
    def.set(t, 1);
  });
  const w = rows.map((r) => Math.exp((-xi * (now - (Date.parse(r.date) || now))) / DAY));
  const wsum = w.reduce((a, b) => a + b, 0) || 1;
  const avg = rows.reduce((acc, r, i) => acc + w[i] * (r.homeGoals + r.awayGoals), 0) / (2 * wsum) || 1.35;
  let home = 1.15;

  for (let iter = 0; iter < 40; iter++) {
    const num = new Map<string, number>();
    const den = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
    rows.forEach((r, i) => {
      add(num, r.home, w[i] * r.homeGoals);
      add(den, r.home, w[i] * home * def.get(r.away)! * avg);
      add(num, r.away, w[i] * r.awayGoals);
      add(den, r.away, w[i] * def.get(r.home)! * avg);
    });
    teams.forEach((t) => att.set(t, ((num.get(t) ?? 0) + PRIOR) / ((den.get(t) ?? 0) + PRIOR)));
    num.clear();
    den.clear();
    rows.forEach((r, i) => {
      add(num, r.away, w[i] * r.homeGoals);
      add(den, r.away, w[i] * home * att.get(r.home)! * avg);
      add(num, r.home, w[i] * r.awayGoals);
      add(den, r.home, w[i] * att.get(r.away)! * avg);
    });
    teams.forEach((t) => def.set(t, ((num.get(t) ?? 0) + PRIOR) / ((den.get(t) ?? 0) + PRIOR)));
    let hn = 0;
    let hd = 0;
    rows.forEach((r, i) => {
      hn += w[i] * r.homeGoals;
      hd += w[i] * att.get(r.home)! * def.get(r.away)! * avg;
    });
    home = hd > 0 ? hn / hd : home;
  }

  const ratings = new Map<string, TeamRating>();
  teams.forEach((t) => ratings.set(t, { attack: att.get(t)!, defense: def.get(t)! }));
  return { ratings, homeAdvantage: home, goalsPerTeam: avg };
}

export function standings(rows: ResultRow[]) {
  const table = new Map<string, { played: number; w: number; d: number; l: number; gf: number; ga: number; points: number; results: { date: string; r: "W" | "D" | "L" }[] }>();
  const get = (t: string) => {
    if (!table.has(t)) table.set(t, { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, points: 0, results: [] });
    return table.get(t)!;
  };
  for (const r of rows) {
    const h = get(r.home);
    const a = get(r.away);
    h.played++;
    a.played++;
    h.gf += r.homeGoals;
    h.ga += r.awayGoals;
    a.gf += r.awayGoals;
    a.ga += r.homeGoals;
    if (r.homeGoals > r.awayGoals) {
      h.w++; a.l++; h.points += 3;
      h.results.push({ date: r.date, r: "W" }); a.results.push({ date: r.date, r: "L" });
    } else if (r.homeGoals < r.awayGoals) {
      a.w++; h.l++; a.points += 3;
      h.results.push({ date: r.date, r: "L" }); a.results.push({ date: r.date, r: "W" });
    } else {
      h.d++; a.d++; h.points++; a.points++;
      h.results.push({ date: r.date, r: "D" }); a.results.push({ date: r.date, r: "D" });
    }
  }
  const sorted = Array.from(table.entries()).sort(
    ([, x], [, y]) => y.points - x.points || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf
  );
  return sorted.map(([team, s], i) => ({
    team,
    rank: i + 1,
    ...s,
    form: s.results
      .sort((x, y) => (x.date < y.date ? -1 : 1))
      .slice(-5)
      .map((x) => x.r),
  }));
}
